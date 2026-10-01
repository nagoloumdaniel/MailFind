import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { eraseAddressEverywhere, loadErasedHashes } from './erasure.js';
import { hashAddress, isSuppressed, loadSuppressedHashes } from './repository.js';

let app: Express;
let premier: string;
let second: string;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const { createMemoryRateLimitStore } = await import('../api/rate-limit.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    v1: { rateLimitStore: createMemoryRateLimitStore() },
  });
});

beforeEach(async () => {
  await resetData();
  await query('delete from erased_addresses');
  premier = await createUser();
  second = await createUser();
});

afterAll(async () => {
  await closePool();
});

/** La meme adresse chez deux comptes differents, avec sa source. */
async function chezTous(adresse: string): Promise<void> {
  for (const userId of [premier, second]) {
    const entreprise = await query<{ id: string }>(
      `insert into companies (user_id, name, normalized_name, domain)
       values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
      [userId],
    );
    await query(
      `with creee as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, origin)
         values ($1, $2, $3, $3, split_part($3, '@', 1), 'found')
         returning id
       )
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/contact', 'mailto' from creee`,
      [entreprise.rows[0]?.id, userId, adresse],
    );
  }
}

const compterEmails = async (): Promise<number> => {
  const issue = await query<{ n: string }>('select count(*)::text as n from emails');
  return Number(issue.rows[0]?.n ?? 0);
};

describe('effacement a la demande de la personne (A9)', () => {
  it('efface l adresse de tous les comptes, pas seulement d un', async () => {
    await chezTous('rh@acme.fr');
    expect(await compterEmails()).toBe(2);

    const issue = await eraseAddressEverywhere('RH@Acme.fr');

    expect(issue).toEqual({ erased: 2, alreadyKnown: false });
    expect(await compterEmails()).toBe(0);
  });

  it('interdit la recollecte, pour tous les comptes', async () => {
    await eraseAddressEverywhere('rh@acme.fr');

    // Le pipeline charge la liste du compte : l'interdiction globale doit y
    // etre, sans que le compte ait rien demande.
    for (const userId of [premier, second]) {
      const interdites = await loadSuppressedHashes(userId);
      expect(isSuppressed(interdites, 'rh@acme.fr')).toBe(true);
    }
    expect(await loadErasedHashes()).toContain(hashAddress('rh@acme.fr'));
  });

  it('ne garde que l empreinte, jamais l adresse', async () => {
    await eraseAddressEverywhere('rh@acme.fr');

    const ligne = await query<{ contenu: string }>(
      'select row_to_json(e)::text as contenu from erased_addresses e',
    );
    expect(ligne.rows[0]?.contenu).not.toContain('rh@acme.fr');
    expect(ligne.rows[0]?.contenu).toContain(hashAddress('rh@acme.fr'));
  });

  it('se redemande sans effet, et le dit', async () => {
    await chezTous('rh@acme.fr');
    await eraseAddressEverywhere('rh@acme.fr');

    const seconde = await eraseAddressEverywhere('rh@acme.fr');

    expect(seconde).toEqual({ erased: 0, alreadyKnown: true });
  });

  it('prend la demande sans session, depuis la page publique', async () => {
    await chezTous('contact@acme.fr');

    const reponse = await request(app)
      .post('/api/bot/effacement')
      .send({ address: 'contact@acme.fr' });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ erased: 2 });
    expect(await compterEmails()).toBe(0);
  });

  it('refuse ce qui n est pas une adresse', async () => {
    const reponse = await request(app).post('/api/bot/effacement').send({ address: 'pas-une' });

    expect(reponse.status).toBe(400);
    expect(reponse.body).toMatchObject({ code: 'invalid_address' });
  });

  it('accepte une adresse inconnue : elle ne pourra plus entrer', async () => {
    const issue = await eraseAddressEverywhere('jamais-vue@acme.fr');

    expect(issue).toEqual({ erased: 0, alreadyKnown: false });
    expect(await loadErasedHashes()).toContain(hashAddress('jamais-vue@acme.fr'));
  });
});
