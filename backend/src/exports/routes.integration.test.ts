import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { purgeExpiredExports, runExportJob } from './service.js';
import { createMemoryStorage } from './storage.js';

let app: Express;
let userId: string;
const stockage = createMemoryStorage();
const file: string[] = [];

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const base = createTestSession();
  const connecte: RequestHandler = (req, res, next) => {
    base(req, res, (erreur?: unknown) => {
      if (erreur !== undefined) {
        next(erreur);
        return;
      }
      req.session.userId = userId;
      next();
    });
  };
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: connecte,
    exportStorage: stockage,
    enqueueExport: (exportId) => {
      file.push(exportId);
      return Promise.resolve();
    },
  });
});

beforeEach(async () => {
  await resetData();
  await query('truncate exports');
  userId = await createUser();
  file.length = 0;
});

afterAll(async () => {
  await closePool();
});

async function agent() {
  const a = request.agent(app);
  const reponse = await a.get('/api/auth/me');
  const cookies = reponse.headers['set-cookie'] as unknown as string[];
  const jeton =
    cookies
      .find((cookie) => cookie.startsWith('mailfind.csrf='))
      ?.split(';')[0]
      ?.slice('mailfind.csrf='.length) ?? '';
  return {
    exporter: (corps: object) =>
      a
        .post('/api/exports')
        .set('x-csrf-token', jeton)
        .send(corps)
        .buffer(true)
        .parse((res, fin) => {
          const morceaux: Buffer[] = [];
          res.on('data', (m: Buffer) => morceaux.push(m));
          res.on('end', () => {
            fin(null, Buffer.concat(morceaux));
          });
        }),
    get: (url: string) => a.get(url),
  };
}

/** Une entreprise et ses adresses, chacune avec sa source. */
async function semer(): Promise<string> {
  const entreprise = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain) values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
    [userId],
  );
  const id = entreprise.rows[0]?.id ?? '';
  const lignes: [string, string, string, boolean, string][] = [
    ['recrutement@acme.fr', 'recruitment', 'valid', false, 'website'],
    ['rh@acme.fr', 'hr', 'accept_all', false, 'provider'],
    ['contact@acme.fr', 'generic', 'unverified', false, 'deduction'],
    ['faux@acme.fr', 'generic', 'invalid', true, 'deduction'],
    ['exclue@acme.fr', 'sales', 'valid', true, 'website'],
  ];
  for (const [adresse, type, statut, exclue, source] of lignes) {
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                             origin, status, score, excluded)
         values ($1, $2, $3, $3, split_part($3, '@', 1), $4::email_type, 'found',
                 $5::email_status, 60, $6) returning id)
       insert into email_sources (email_id, kind, url, provider, extraction_method)
       select id, $7::email_source_kind,
              case when $7 = 'website' then 'https://acme.fr/contact' end,
              case when $7 = 'provider' then 'hunter' end,
              case when $7 = 'website' then 'mailto'::extraction_method end
         from e`,
      [id, userId, adresse, type, statut, exclue, source],
    );
  }
  return id;
}

/** L'indicateur UTF-8 en tete de fichier. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const lignesCsv = (corps: Buffer) =>
  corps.toString('utf8').replace(BOM, '').trimEnd().split('\r\n');

describe('POST /api/exports (6.11)', () => {
  it('exporte valid et accept_all par defaut, sans exclue, chaque adresse avec sa source (A4)', async () => {
    await semer();
    const { exporter } = await agent();
    const reponse = await exporter({ format: 'csv_emails', scope: { kind: 'library' } });

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toMatch(/text\/csv/);
    expect(reponse.headers['content-disposition']).toMatch(
      /attachment; filename="mailfind-adresses-/,
    );
    const lignes = lignesCsv(reponse.body as Buffer);
    const entete = (lignes[0] ?? '').split(';');
    const colonne = (nom: string) => entete.indexOf(nom);
    const donnees = lignes.slice(1).map((l) => l.split(';'));
    expect(donnees.map((l) => l[colonne('email')])).toEqual(['recrutement@acme.fr', 'rh@acme.fr']);
    for (const ligne of donnees) {
      const source = [ligne[colonne('source_url')], ligne[colonne('provider')]].filter(
        (valeur) => (valeur ?? '') !== '',
      );
      expect(source.length, ligne[colonne('email')]).toBeGreaterThan(0);
    }
    expect(reponse.headers['x-export-rows']).toBe('2');
  });

  it('suit le filtre de statut, sans jamais exporter un statut toujours exclu (F-1102)', async () => {
    await semer();
    const { exporter } = await agent();
    const tous = lignesCsv(
      (await exporter({ format: 'csv_emails', scope: { kind: 'library' }, statuses: 'all' }))
        .body as Buffer,
    );
    expect(tous).toHaveLength(4);
    expect(tous.join('\n')).not.toContain('faux@acme.fr');
    const valides = lignesCsv(
      (await exporter({ format: 'csv_emails', scope: { kind: 'library' }, statuses: 'valid' }))
        .body as Buffer,
    );
    expect(valides).toHaveLength(2);
  });

  it('produit le fichier Campaign Mailer, et le journalise sans une adresse (F-1106)', async () => {
    await semer();
    const { exporter } = await agent();
    const reponse = await exporter({
      format: 'campaign_mailer',
      scope: { kind: 'library' },
      separator: ',',
    });
    expect(lignesCsv(reponse.body as Buffer)).toEqual([
      'email,contact_name,company_name,salutation',
      'recrutement@acme.fr,,Acme,"Madame, Monsieur"',
      'rh@acme.fr,,Acme,"Madame, Monsieur"',
    ]);
    const journal = await query<{ status: string; row_count: number; format: string }>(
      `select status::text as status, row_count, format from exports`,
    );
    expect(journal.rows).toEqual([{ status: 'done', row_count: 2, format: 'campaign_mailer' }]);
    const audit = await query<{ metadata: unknown }>(
      `select metadata from audit_events where action = 'export.created'`,
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      format: 'campaign_mailer',
      rows: 2,
      scope: 'library',
    });
    expect(JSON.stringify(audit.rows)).not.toContain('@acme.fr');
  });

  it('exporte une selection de contacts, et elle seule (F-1101)', async () => {
    await semer();
    const choisie = await query<{ id: string }>(
      `select id from emails where address = 'rh@acme.fr'`,
    );
    const { exporter } = await agent();
    const reponse = await exporter({
      format: 'json',
      scope: { kind: 'contacts', ids: [choisie.rows[0]?.id] },
    });
    const lu = JSON.parse((reponse.body as Buffer).toString('utf8')) as {
      companies: { emails: { address: string; sources: unknown[] }[] }[];
    };
    expect(lu.companies).toHaveLength(1);
    expect(lu.companies[0]?.emails.map((e) => e.address)).toEqual(['rh@acme.fr']);
    expect(lu.companies[0]?.emails[0]?.sources).toHaveLength(1);
  });

  it('produit en arriere-plan au-dela de 2 000 lignes, garde sept jours, puis efface (F-1104)', async () => {
    const entreprise = await semer();
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin, status)
         select $1, $2, 'a' || n || '@acme.fr', 'a' || n || '@acme.fr', 'a' || n, 'generic', 'found', 'valid'
           from generate_series(1, 2000) n returning id)
       insert into email_sources (email_id, kind) select id, 'deduction' from e`,
      [entreprise, userId],
    );
    const { exporter, get } = await agent();
    const reponse = await exporter({ format: 'xlsx', scope: { kind: 'library' } });
    expect(reponse.status).toBe(202);
    const exporte = JSON.parse((reponse.body as Buffer).toString('utf8')) as {
      export: { id: string; status: string };
    };
    expect(exporte.export.status).toBe('pending');
    expect(file).toEqual([exporte.export.id]);

    // Le processus de traitement prend la tache.
    await runExportJob(stockage, exporte.export.id);
    const liste = await get('/api/exports');
    expect(liste.body.exports[0]).toMatchObject({
      id: exporte.export.id,
      status: 'done',
      rowCount: 2002,
      downloadable: true,
    });
    const telechargement = await get(`/api/exports/${exporte.export.id}/download`);
    expect(telechargement.status).toBe(200);
    expect(telechargement.headers['content-type']).toMatch(/spreadsheetml/);

    // Rejouee, la tache ne refait rien.
    await runExportJob(stockage, exporte.export.id);
    expect(stockage.keys()).toHaveLength(1);

    await query(`update exports set expires_at = now() - interval '1 minute'`);
    expect(await purgeExpiredExports(stockage)).toBe(1);
    expect(stockage.keys()).toHaveLength(0);
    expect((await get(`/api/exports/${exporte.export.id}/download`)).status).toBe(404);
  });

  it('ne laisse pas telecharger l export d un autre compte', async () => {
    const autre = await createUser();
    const cree = await query<{ id: string }>(
      `insert into exports (user_id, format, status, storage_key, filename, expires_at)
       values ($1, 'json', 'done', 'exports/x.json', 'x.json', now() + interval '1 day') returning id`,
      [autre],
    );
    await stockage.put('exports/x.json', Buffer.from('{}'), 'application/json');
    const { get } = await agent();
    expect((await get(`/api/exports/${cree.rows[0]?.id ?? ''}/download`)).status).toBe(404);
    expect((await get('/api/exports')).body.exports).toEqual([]);
    await stockage.remove('exports/x.json');
  });

  it('refuse un format ou un perimetre inconnu', async () => {
    const { exporter } = await agent();
    const reponse = await exporter({ format: 'pdf', scope: { kind: 'library' } });
    expect(reponse.status).toBe(400);
  });
});
