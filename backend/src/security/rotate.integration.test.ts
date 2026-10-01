import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createCipher } from './crypto.js';
import { ENCRYPTED_COLUMNS, rotateEncryption } from './rotate.js';

const ANCIENNE = randomBytes(32).toString('hex');
const NOUVELLE = randomBytes(32).toString('hex');
const PERDUE = randomBytes(32).toString('hex');

const avant = createCipher(ANCIENNE);
const pendant = createCipher(NOUVELLE, ANCIENNE);
const apres = createCipher(NOUVELLE);

let userId: string;

beforeEach(async () => {
  await resetData();
  await query('delete from provider_cache');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

async function webhook(chiffre: string): Promise<string> {
  const ligne = await query<{ id: string }>(
    `insert into webhooks (user_id, url, events, secret_encrypted, secret_prefix)
     values ($1, 'https://exemple.test/hook', array['import.completed'], $2, 'whsec_ab')
     returning id`,
    [userId, chiffre],
  );
  return ligne.rows[0]?.id ?? '';
}

async function cache(key: string, response: unknown): Promise<void> {
  await query(
    `insert into provider_cache (provider, operation, key, response, expires_at)
     values ('hunter', 'domain_search', $1, $2, now() + interval '1 day')`,
    [key, JSON.stringify(response)],
  );
}

describe('rotation de la cle de chiffrement (S-01)', () => {
  it('reecrit avec la nouvelle cle tout ce que l ancienne a chiffre', async () => {
    const id = await webhook(avant.encrypt('secret-de-webhook'));
    await query(
      `insert into campaign_mailer_connections (user_id, token_encrypted, token_prefix)
       values ($1, $2, 'cm_AAAAAAAA')`,
      [userId, avant.encrypt('cm_jeton')],
    );
    await cache('acme.fr', { chiffre: avant.encryptJson({ emails: ['a@acme.fr'] }) });
    await cache('clair.fr', { domaine: 'clair.fr' });

    const rapport = await rotateEncryption(pendant);

    expect(rapport.rewritten).toEqual({
      webhooks: 1,
      campaign_mailer_connections: 1,
      provider_cache: 1,
    });
    expect(rapport.unreadable).toEqual({ webhooks: 0, campaign_mailer_connections: 0 });

    // Sans l'ancienne cle, tout se relit encore.
    const secret = await query<{ s: string }>(
      'select secret_encrypted as s from webhooks where id = $1',
      [id],
    );
    expect(apres.decrypt(secret.rows[0]?.s ?? '')).toBe('secret-de-webhook');
    const jeton = await query<{ t: string }>(
      'select token_encrypted as t from campaign_mailer_connections',
    );
    expect(apres.decrypt(jeton.rows[0]?.t ?? '')).toBe('cm_jeton');
    const entree = await query<{ c: string }>(
      `select response->>'chiffre' as c from provider_cache where key = 'acme.fr'`,
    );
    expect(apres.decryptJson(entree.rows[0]?.c ?? '')).toEqual({ emails: ['a@acme.fr'] });
    const clair = await query<{ r: unknown }>(
      `select response as r from provider_cache where key = 'clair.fr'`,
    );
    expect(clair.rows[0]?.r).toEqual({ domaine: 'clair.fr' });

    // Une deuxieme passe n'a plus rien a faire.
    const encore = await rotateEncryption(pendant);
    expect(Object.values(encore.rewritten).every((n) => n === 0)).toBe(true);
  });

  it('signale un secret illisible sans y toucher, et supprime le cache illisible', async () => {
    const perdue = createCipher(PERDUE);
    const chiffre = perdue.encrypt('secret-perdu');
    await webhook(chiffre);
    await cache('perdu.fr', { chiffre: perdue.encryptJson({ emails: [] }) });

    const rapport = await rotateEncryption(pendant);

    expect(rapport.unreadable.webhooks).toBe(1);
    expect(rapport.droppedCache).toBe(1);
    const reste = await query<{ s: string }>('select secret_encrypted as s from webhooks');
    expect(reste.rows[0]?.s).toBe(chiffre);
  });

  it('connait toutes les colonnes chiffrees du schema', async () => {
    const colonnes = await query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = current_schema() and column_name like '%\\_encrypted'`,
    );
    const connues = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.colonne}`).sort();
    expect(colonnes.rows.map((c) => `${c.table_name}.${c.column_name}`).sort()).toEqual(connues);
  });
});
