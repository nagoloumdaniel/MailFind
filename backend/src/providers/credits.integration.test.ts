import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { readCache, reserveCall, settleCall, writeCache } from './credits.js';

let userId: string;
const LARGE = { perUserMonthly: 100, globalMonthly: 1000 };

beforeEach(async () => {
  await resetData();
  await query('truncate provider_calls, provider_cache');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

const scope = (cle: string, utilisateur = userId) => ({
  provider: 'brave',
  operation: 'web_search',
  userId: utilisateur,
  idempotencyKey: cle,
});

describe('reserveCall et settleCall', () => {
  it('une tache rejouee apres un appel regle ne paie pas deux fois', async () => {
    const premiere = await reserveCall(scope('import-1:acme'), LARGE);
    expect(premiere.kind).toBe('reserved');
    if (premiere.kind !== 'reserved') return;
    await settleCall(premiere.id, 'confirmed');

    expect(await reserveCall(scope('import-1:acme'), LARGE)).toEqual({
      kind: 'already_settled',
      status: 'confirmed',
    });
  });

  it('une tache coupee entre la reservation et le reglement ne rappelle pas le fournisseur (A5)', async () => {
    await reserveCall(scope('import-1:acme'), LARGE);
    expect(await reserveCall(scope('import-1:acme'), LARGE)).toEqual({ kind: 'interrupted' });
    const lignes = await query<{ n: number }>('select count(*)::int as n from provider_calls');
    expect(lignes.rows[0]?.n).toBe(1);
  });

  it('arrete un utilisateur a son plafond du mois, sans gener les autres (D-14)', async () => {
    const limites = { perUserMonthly: 2, globalMonthly: 1000 };
    expect((await reserveCall(scope('a'), limites)).kind).toBe('reserved');
    expect((await reserveCall(scope('b'), limites)).kind).toBe('reserved');
    expect((await reserveCall(scope('c'), limites)).kind).toBe('user_quota_reached');

    const autre = await createUser();
    expect((await reserveCall(scope('d', autre), limites)).kind).toBe('reserved');
  });

  it('arrete tout le monde au bout des credits offerts du mois (D-13)', async () => {
    const limites = { perUserMonthly: 100, globalMonthly: 1 };
    expect((await reserveCall(scope('a'), limites)).kind).toBe('reserved');
    const autre = await createUser();
    expect((await reserveCall(scope('b', autre), limites)).kind).toBe('global_quota_reached');
  });

  it('ne compte pas un appel refuse par le fournisseur', async () => {
    const limites = { perUserMonthly: 1, globalMonthly: 1000 };
    const refuse = await reserveCall(scope('a'), limites);
    if (refuse.kind !== 'reserved') throw new Error('reservation attendue');
    await settleCall(refuse.id, 'failed', 'Brave a repondu 503');
    expect((await reserveCall(scope('b'), limites)).kind).toBe('reserved');
  });

  it('ne compte pas les appels du mois precedent', async () => {
    const limites = { perUserMonthly: 1, globalMonthly: 1000 };
    await reserveCall(scope('ancien'), limites);
    await query(`update provider_calls set created_at = now() - interval '40 days'`);
    expect((await reserveCall(scope('nouveau'), limites)).kind).toBe('reserved');
  });

  it('ne depasse pas le plafond sous des reservations simultanees', async () => {
    const limites = { perUserMonthly: 100, globalMonthly: 3 };
    const issues = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reserveCall(scope(`k${String(i)}`), limites)),
    );
    expect(issues.filter((issue) => issue.kind === 'reserved')).toHaveLength(3);
  });

  it('garde le compteur du mois quand un compte est supprime', async () => {
    const limites = { perUserMonthly: 100, globalMonthly: 1 };
    await reserveCall(scope('a'), limites);
    await query('delete from users where id = $1', [userId]);
    const autre = await createUser();
    expect((await reserveCall(scope('b', autre), limites)).kind).toBe('global_quota_reached');
  });
});

describe('cache des fournisseurs', () => {
  it('rend ce qui a ete ecrit, jusqu a expiration', async () => {
    await writeCache('brave', 'web_search', 'doctolib|', { domain: 'doctolib.fr' }, 30);
    expect(await readCache('brave', 'web_search', 'doctolib|')).toEqual({ domain: 'doctolib.fr' });

    await query(`update provider_cache set expires_at = now() - interval '1 second'`);
    expect(await readCache('brave', 'web_search', 'doctolib|')).toBeUndefined();
  });
});
