import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { markEmailsUsed, purgeExpiredData } from './purge.js';

let userId: string;
let companyId: string;

beforeEach(async () => {
  await resetData();
  await query('delete from provider_calls');
  userId = await createUser();
  const entreprise = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain)
     values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
    [userId],
  );
  companyId = entreprise.rows[0]?.id ?? '';
});

afterAll(async () => {
  await closePool();
});

/**
 * Une adresse avec sa source, dont on choisit la date de dernier usage. Les
 * deux dans la meme instruction : la base refuse une adresse sans source.
 */
async function adresse(local: string, utiliseeIlYa: string): Promise<string> {
  const email = await query<{ id: string }>(
    `with creee as (
       insert into emails
         (company_id, user_id, address, normalized_address, local_part, origin, last_used_at)
       values ($1, $2, $3, $3, $4, 'found', now() - $5::interval)
       returning id
     ), source as (
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/contact', 'mailto' from creee
     )
     select id from creee`,
    [companyId, userId, `${local}@acme.fr`, local, utiliseeIlYa],
  );
  return email.rows[0]?.id ?? '';
}

const compter = async (table: string): Promise<number> => {
  const issue = await query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(issue.rows[0]?.n ?? 0);
};

describe('conservation et purge automatique (R-06)', () => {
  it('efface une adresse qui n a pas servi depuis douze mois, sa source avec', async () => {
    const vieille = await adresse('vieille', '13 months');
    await adresse('recente', '11 months');

    const rapport = await purgeExpiredData();

    expect(rapport.emails).toBe(1);
    const restantes = await query<{ local_part: string }>('select local_part from emails');
    expect(restantes.rows.map((l) => l.local_part)).toEqual(['recente']);
    const sources = await query<{ n: string }>(
      'select count(*)::text as n from email_sources where email_id = $1',
      [vieille],
    );
    expect(sources.rows[0]?.n).toBe('0');
  });

  it('repart de zero quand l adresse sert : un export la sauve', async () => {
    const id = await adresse('exportee', '13 months');

    await markEmailsUsed([id]);
    const rapport = await purgeExpiredData();

    expect(rapport.emails).toBe(0);
    expect(await compter('emails')).toBe(1);
  });

  it('garde le journal d audit un an, et pas plus', async () => {
    for (const age of ['13 months', '11 months']) {
      await query(
        `insert into audit_events (user_id, action, entity, created_at)
         values ($1, 'user.signed_in', 'user', now() - $2::interval)`,
        [userId, age],
      );
    }

    const rapport = await purgeExpiredData();

    expect(rapport.auditEvents).toBe(1);
    expect(await compter('audit_events')).toBe(1);
  });

  it('garde les traces techniques quatre-vingt-dix jours, et pas plus', async () => {
    for (const [cle, age] of [
      ['vieux', '100 days'],
      ['recent', '80 days'],
    ]) {
      await query(
        `insert into provider_calls
           (user_id, provider, operation, idempotency_key, credits, status, created_at)
         values ($1, 'hunter', 'domain_search', $2, 1, 'confirmed', now() - $3::interval)`,
        [userId, cle, age],
      );
    }
    const id = await adresse('verifiee', '1 day');
    for (const age of ['100 days', '80 days']) {
      await query(
        `insert into verifications (email_id, level, status, reason, verified_at)
         values ($1, 1, 'valid', 'syntaxe', now() - $2::interval)`,
        [id, age],
      );
    }

    const rapport = await purgeExpiredData();

    expect(rapport.providerCalls).toBe(1);
    expect(rapport.verifications).toBe(1);
    expect(await compter('provider_calls')).toBe(1);
    expect(await compter('verifications')).toBe(1);
  });

  it('ne touche a rien quand rien n a expire', async () => {
    await adresse('fraiche', '1 day');

    const rapport = await purgeExpiredData();

    expect(rapport).toEqual({
      emails: 0,
      auditEvents: 0,
      providerCalls: 0,
      verifications: 0,
      webhookDeliveries: 0,
    });
  });

  it('ne fait rien sur une liste vide, sans requete inutile', async () => {
    await expect(markEmailsUsed([])).resolves.toBeUndefined();
  });
});
