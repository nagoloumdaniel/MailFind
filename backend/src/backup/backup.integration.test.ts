import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createMemoryStorage } from '../exports/storage.js';
import { createUser, resetData } from '../test/integration/db.js';
import { BACKED_UP_TABLES, createBackup, expiredBackupKeys, restoreBackup } from './dump.js';

/**
 * La sauvegarde et, surtout, la restauration. Une sauvegarde qu'on n'a jamais
 * restauree n'est pas une sauvegarde : c'est un fichier.
 */

/** Ce qui n'est pas sauvegarde, et pourquoi. Le test le relit a chaque passage. */
const ECARTEES_VOLONTAIREMENT = new Set([
  'schema_migrations',
  'provider_cache',
  'disposable_domains',
  'idempotency_keys',
  'sso_codes',
  'verification_runs',
  'provider_budget_alerts',
]);

let userId: string;

beforeEach(async () => {
  await resetData();
  for (const table of ['quota_usage', 'erased_addresses', 'excluded_domains', 'provider_calls']) {
    await query(`delete from ${table}`);
  }
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

/** Une entreprise, une adresse et sa source : le minimum qui ait du sens. */
async function bibliotheque(adresse: string): Promise<string> {
  const entreprise = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain)
     values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
    [userId],
  );
  const id = entreprise.rows[0]?.id ?? '';
  await query(
    `with creee as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, origin, score)
       values ($1, $2, $3, $3, split_part($3, '@', 1), 'found', 72)
       returning id
     )
     insert into email_sources (email_id, kind, url, extraction_method)
     select id, 'website', 'https://acme.fr/contact', 'mailto' from creee`,
    [id, userId, adresse],
  );
  return id;
}

const compter = async (table: string): Promise<number> => {
  const issue = await query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(issue.rows[0]?.n ?? 0);
};

describe('sauvegarde et restauration (Phase 10)', () => {
  it('nomme toutes les tables de la base, ou dit pourquoi elle les ecarte', async () => {
    const presentes = await query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema() and table_type = 'BASE TABLE'`,
    );
    const sauvegardees = new Set<string>(BACKED_UP_TABLES);

    const oubliees = presentes.rows
      .map((ligne) => ligne.table_name)
      .filter((nom) => !sauvegardees.has(nom) && !ECARTEES_VOLONTAIREMENT.has(nom));

    // Une table ajoutee sans decision ne doit pas passer inapercue : soit elle
    // est sauvegardee, soit elle est ecartee en connaissance de cause.
    expect(oubliees).toEqual([]);
  });

  it('rend la base a l identique apres une perte totale', async () => {
    await bibliotheque('rh@acme.fr');
    await query(
      `insert into audit_events (user_id, action, entity) values ($1, 'user.signed_in', 'user')`,
      [userId],
    );
    const stockage = createMemoryStorage();

    const sauvegarde = await createBackup(stockage);
    expect(sauvegarde.key).toMatch(/^backups\/\d{4}-\d{2}-\d{2}\.ndjson\.gz$/);
    expect(sauvegarde.rows.emails).toBe(1);

    // La perte : tout disparait.
    await query('truncate users cascade');
    expect(await compter('emails')).toBe(0);

    const archive = await stockage.get(sauvegarde.key);
    const restauration = await restoreBackup(archive ?? Buffer.alloc(0));

    expect(restauration.rows.users).toBe(1);
    expect(await compter('companies')).toBe(1);
    expect(await compter('email_sources')).toBe(1);
    const email = await query<{ address: string; score: number }>(
      'select address, score from emails',
    );
    expect(email.rows[0]).toMatchObject({ address: 'rh@acme.fr', score: 72 });
  });

  it('restaure une adresse avec sa source, que la base exige', async () => {
    await bibliotheque('contact@acme.fr');
    const stockage = createMemoryStorage();
    const sauvegarde = await createBackup(stockage);
    await query('truncate users cascade');

    await restoreBackup((await stockage.get(sauvegarde.key)) ?? Buffer.alloc(0));

    // La contrainte du depot tient apres restauration : pas d'adresse
    // orpheline passee entre les mailles.
    const orphelines = await query<{ n: string }>(
      `select count(*)::text as n from emails e
        where not exists (select 1 from email_sources s where s.email_id = e.id)`,
    );
    expect(orphelines.rows[0]?.n).toBe('0');
  });

  it('se rejoue sans doubler les lignes', async () => {
    await bibliotheque('rh@acme.fr');
    const stockage = createMemoryStorage();
    const sauvegarde = await createBackup(stockage);
    const archive = (await stockage.get(sauvegarde.key)) ?? Buffer.alloc(0);

    await restoreBackup(archive);
    await restoreBackup(archive);

    expect(await compter('emails')).toBe(1);
    expect(await compter('users')).toBe(1);
  });

  it('refuse un fichier qui n est pas une sauvegarde', async () => {
    const { gzipSync } = await import('node:zlib');

    await expect(restoreBackup(gzipSync(Buffer.from('{"kind":"autre"}')))).rejects.toThrow(
      /sauvegarde MailFind/,
    );
  });

  it('efface les sauvegardes de plus de trente jours, et garde les autres', () => {
    const maintenant = new Date('2026-10-02T00:00:00Z');

    const perimees = expiredBackupKeys(
      [
        'backups/2026-08-01.ndjson.gz',
        'backups/2026-09-25.ndjson.gz',
        'backups/2026-10-01.ndjson.gz',
        'exports/un-export.csv',
      ],
      maintenant,
    );

    expect(perimees).toEqual(['backups/2026-08-01.ndjson.gz']);
  });
});
