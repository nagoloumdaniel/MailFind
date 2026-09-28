import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { randomBytes } from 'node:crypto';
import { createCipher } from '../security/crypto.js';
import { paidCall, readCache, reserveCall, settleCall, writeCache } from './credits.js';

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

describe('paidCall, la regle des appels payants de bout en bout', () => {
  const chiffreur = createCipher(randomBytes(32).toString('hex'));
  const hunter = (cle: string, utilisateur = userId) => ({
    provider: 'hunter',
    operation: 'domain_search',
    userId: utilisateur,
    idempotencyKey: cle,
  });

  it('une seconde recherche sur le meme domaine dans les 30 jours ne coute rien (DoD Phase 4)', async () => {
    let appels = 0;
    const appel = () => {
      appels += 1;
      return Promise.resolve({ emails: ['jean.dupont@acme.fr'] });
    };
    const autre = await createUser();

    const premiere = await paidCall({
      scope: hunter('import-1:acme'),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: appel,
    });
    const seconde = await paidCall({
      scope: hunter('import-2:acme', autre),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: appel,
    });

    expect(premiere).toMatchObject({ kind: 'ok', paid: true });
    expect(seconde).toEqual({
      kind: 'ok',
      value: { emails: ['jean.dupont@acme.fr'] },
      paid: false,
    });
    expect(appels).toBe(1);
    const lignes = await query<{ status: string; credits: string }>(
      'select status::text as status, credits::text as credits from provider_calls',
    );
    expect(lignes.rows).toEqual([{ status: 'confirmed', credits: '1.00' }]);
  });

  it('un import rejoue apres une coupure ne paie pas deux fois (A5, DoD Phase 4)', async () => {
    // Premiere execution : credit reserve, puis le processus meurt avant
    // d'avoir regle l'appel.
    await reserveCall(hunter('import-1:acme'), LARGE);

    let appels = 0;
    const rejeu = await paidCall({
      scope: hunter('import-1:acme'),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: () => {
        appels += 1;
        return Promise.resolve({});
      },
    });

    expect(rejeu).toEqual({ kind: 'skipped', reason: 'interrupted' });
    expect(appels).toBe(0);
  });

  it('ne garde au cache aucune adresse en clair (F-604)', async () => {
    await paidCall({
      scope: hunter('import-1:acme'),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: () => Promise.resolve({ emails: ['jean.dupont@acme.fr'] }),
    });
    const brut = await query<{ texte: string }>(
      'select response::text as texte from provider_cache',
    );
    expect(brut.rows[0]?.texte).not.toContain('dupont');
    expect(brut.rows[0]?.texte).toContain('chiffre');
  });

  it('traite comme absente une entree chiffree avec une cle retiree', async () => {
    await paidCall({
      scope: hunter('import-1:acme'),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: createCipher(randomBytes(32).toString('hex')),
      call: () => Promise.resolve({ emails: [] }),
    });
    let appels = 0;
    const apres = await paidCall({
      scope: hunter('import-2:acme'),
      limits: LARGE,
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: () => {
        appels += 1;
        return Promise.resolve({ emails: [] });
      },
    });
    expect(apres).toMatchObject({ kind: 'ok', paid: true });
    expect(appels).toBe(1);
  });

  it('note un appel refuse sans le compter, et ne le retente pas pour la meme cle', async () => {
    const echec = await paidCall({
      scope: hunter('import-1:acme'),
      limits: { perUserMonthly: 1, globalMonthly: 30 },
      cacheKey: 'acme.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: () => Promise.reject(new Error('Hunter a repondu 503')),
    });
    expect(echec.kind).toBe('failed');

    const ligne = await query<{ status: string; credits: string; error: string }>(
      'select status::text as status, credits::text as credits, error from provider_calls',
    );
    expect(ligne.rows[0]).toEqual({
      status: 'failed',
      credits: '0.00',
      error: 'Hunter a repondu 503',
    });

    // Le plafond d'une recherche par mois n'est pas consomme par l'echec.
    const suivante = await paidCall({
      scope: hunter('import-1:globex'),
      limits: { perUserMonthly: 1, globalMonthly: 30 },
      cacheKey: 'globex.fr',
      ttlDays: 30,
      cipher: chiffreur,
      call: () => Promise.resolve({ emails: [] }),
    });
    expect(suivante).toMatchObject({ kind: 'ok', paid: true });
  });

  it('compte les plafonds par operation : la recherche ne mange pas la verification (D-14)', async () => {
    const limites = { perUserMonthly: 1, globalMonthly: 30 };
    expect((await reserveCall(hunter('a'), limites)).kind).toBe('reserved');
    expect((await reserveCall(hunter('b'), limites)).kind).toBe('user_quota_reached');
    expect(
      (
        await reserveCall(
          { provider: 'hunter', operation: 'verification', userId, idempotencyKey: 'c' },
          limites,
        )
      ).kind,
    ).toBe('reserved');
  });
});
