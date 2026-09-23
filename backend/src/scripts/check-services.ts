/**
 * Verifie que les services externes repondent depuis ce poste, avec les
 * identifiants de backend/.env. C'est la preuve exigee par la Definition of
 * Done de la Phase 0, et le premier reflexe quand quelque chose ne demarre pas.
 *
 *   npm run check:services
 *
 * Le script ecrit dans R2 puis efface ce qu'il a ecrit, et pose une cle Redis
 * qui expire en trente secondes. Il ne touche a rien d'autre, et n'affiche
 * jamais une valeur secrete.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
// Import nomme et non par defaut : sous moduleResolution NodeNext, l'export
// par defaut d'ioredis se resout en espace de noms, pas en constructeur.
import { Redis } from 'ioredis';
import pg from 'pg';

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const CONNECT_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} est absent de backend/.env`);
  }
  return value;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 200);
}

async function run(name: string, check: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await check() };
  } catch (error) {
    return { name, ok: false, detail: describeError(error) };
  }
}

async function checkPostgres(variable: string): Promise<string> {
  // rejectUnauthorized impose la verification complete de la chaine de
  // certificats. sslmode=require, lui, chiffre sans verifier a qui il parle.
  const client = new pg.Client({
    connectionString: requireEnv(variable),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  await client.connect();
  try {
    const result = await client.query<{ db: string; usr: string; version: string }>(
      'select current_database() as db, current_user as usr, version() as version',
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('la requete de controle n a rien renvoye');
    }
    return `${row.version.split(' ').slice(0, 2).join(' ')}, base ${row.db}, role ${row.usr}`;
  } finally {
    await client.end();
  }
}

async function checkRedis(): Promise<string> {
  const redis = new Redis(requireEnv('REDIS_URL'), {
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const key = `${requireEnv('BULLMQ_PREFIX')}:check:${Date.now().toString()}`;
    await redis.set(key, 'ping', 'EX', 30);
    const readBack = await redis.get(key);
    await redis.del(key);
    if (readBack !== 'ping') {
      throw new Error('la valeur relue ne correspond pas a la valeur ecrite');
    }
    const info = await redis.info('server');
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? 'version inconnue';
    return `redis ${version}, ecriture, lecture et suppression`;
  } finally {
    redis.disconnect();
  }
}

async function checkR2(): Promise<string> {
  const bucket = requireEnv('R2_BUCKET');
  const client = new S3Client({
    region: 'auto',
    endpoint: requireEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });

  const key = `checks/connectivite-${Date.now().toString()}.txt`;
  const payload = 'controle de connectivite MailFind';

  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload }));
  try {
    const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (stored.Body === undefined) {
      throw new Error('objet relu sans contenu');
    }
    const readBack = await stored.Body.transformToString();
    if (readBack !== payload) {
      throw new Error('le contenu relu ne correspond pas au contenu ecrit');
    }
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  return `${bucket}, ecriture, lecture et suppression`;
}

function checkGoogleCredentials(): string {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error('GOOGLE_CLIENT_ID ne ressemble pas a un identifiant client Google');
  }
  if (!clientSecret.startsWith('GOCSPX-')) {
    throw new Error('GOOGLE_CLIENT_SECRET ne ressemble pas a un secret client Google');
  }
  // Le flux lui-meme demande un navigateur : il est couvert par la Phase 1.
  return 'identifiant et secret bien formes';
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    process.stdout.write('backend/.env est introuvable. Copier backend/.env.example.\n');
    process.exitCode = 1;
    return;
  }

  const results = [
    await run('Postgres groupe', () => checkPostgres('DATABASE_URL')),
    await run('Postgres direct', () => checkPostgres('DIRECT_DATABASE_URL')),
    await run('Redis', checkRedis),
    await run('Cloudflare R2', checkR2),
    await run('Google OAuth', () => Promise.resolve(checkGoogleCredentials())),
  ];

  const width = Math.max(...results.map((result) => result.name.length));
  for (const result of results) {
    const status = result.ok ? 'OK   ' : 'ECHEC';
    process.stdout.write(`${status} ${result.name.padEnd(width)}  ${result.detail}\n`);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

await main();
