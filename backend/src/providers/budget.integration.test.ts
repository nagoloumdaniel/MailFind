import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { callCostCents, creditPrices, type SpendPolicy } from './budget.js';
import { reserveCall, settleCall } from './credits.js';

const LARGE = { perUserMonthly: 1000, globalMonthly: 1000 };
/** Deux centimes l'appel, un euro de budget pour le mois. */
const POLITIQUE: SpendPolicy = { budgetCents: 100, costCents: 2 };

let userId: string;

beforeEach(async () => {
  await resetData();
  await query('delete from provider_calls');
  await query('delete from provider_budget_alerts');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

const reserver = (cle: string, spend: SpendPolicy = POLITIQUE, compte = () => userId) =>
  reserveCall(
    {
      provider: 'hunter',
      operation: 'domain_search',
      userId: compte(),
      idempotencyKey: cle,
      credits: 1,
    },
    LARGE,
    spend,
  );

/** Remplit la depense du mois chez hunter, sans passer par la reservation. */
async function depenser(centimes: number): Promise<void> {
  await query(
    `insert into provider_calls
       (user_id, provider, operation, idempotency_key, credits, cost_cents, status)
     values ($1, 'hunter', 'domain_search', $2, 1, $3, 'confirmed')`,
    [userId, `depense-${String(centimes)}`, centimes],
  );
}

describe('tarifs des fournisseurs (F-1405)', () => {
  it('lit les tarifs, et traite un fournisseur sans tarif comme gratuit', () => {
    const tarifs = creditPrices('hunter:2, autre:5');

    expect(tarifs).toEqual({ hunter: 2, autre: 5 });
    expect(callCostCents('hunter', 1, tarifs)).toBe(2);
    // Une demi-verification coute un demi-credit : arrondi au centime.
    expect(callCostCents('hunter', 0.5, tarifs)).toBe(1);
    expect(callCostCents('brave', 10, tarifs)).toBe(0);
  });

  it('ignore une entree mal ecrite plutot que de deviner un tarif', () => {
    expect(creditPrices('hunter:deux,:3,brave')).toEqual({});
  });
});

describe('plafond de depense par fournisseur (F-1405)', () => {
  it('fige le cout sur la ligne, pour que le tarif du jour fasse foi', async () => {
    expect((await reserver('appel-1')).kind).toBe('reserved');

    const ligne = await query<{ cost_cents: number }>(
      'select cost_cents from provider_calls where idempotency_key = $1',
      ['appel-1'],
    );
    expect(ligne.rows[0]?.cost_cents).toBe(2);
  });

  it('refuse l appel qui ferait depasser le budget, et ne le reserve pas', async () => {
    await depenser(99);

    const refus = await reserver('appel-de-trop');

    expect(refus.kind).toBe('budget_reached');
    const lignes = await query<{ n: string }>(
      `select count(*)::text as n from provider_calls where idempotency_key = $1`,
      ['appel-de-trop'],
    );
    expect(lignes.rows[0]?.n).toBe('0');
  });

  it('suspend pour tout le monde, pas seulement pour celui qui a depense', async () => {
    await depenser(100);
    const autre = await createUser();

    const refus = await reserver('appel-autre-compte', POLITIQUE, () => autre);

    expect(refus.kind).toBe('budget_reached');
  });

  it('n alerte qu une fois par fournisseur et par mois', async () => {
    await depenser(100);

    await reserver('refus-1');
    await reserver('refus-2');
    await reserver('refus-3');

    const alertes = await query<{ n: string; spent_cents: number }>(
      `select count(*)::text as n, max(spent_cents) as spent_cents
         from provider_budget_alerts where provider = 'hunter'`,
    );
    expect(alertes.rows[0]?.n).toBe('1');
    expect(alertes.rows[0]?.spent_cents).toBe(100);
  });

  it('laisse passer un appel gratuit, meme sans budget', async () => {
    await depenser(500);

    const gratuit = await reserver('appel-gratuit', { budgetCents: 0, costCents: 0 });

    expect(gratuit.kind).toBe('reserved');
  });

  it('ne compte pas une depense d un autre fournisseur', async () => {
    await query(
      `insert into provider_calls
         (user_id, provider, operation, idempotency_key, credits, cost_cents, status)
       values ($1, 'autre', 'domain_search', 'ailleurs', 1, 500, 'confirmed')`,
      [userId],
    );

    expect((await reserver('appel-hunter')).kind).toBe('reserved');
  });

  it('ne fait peser sur le budget que ce que le fournisseur a facture', async () => {
    const reservation = await reserver('appel-non-facture');
    if (reservation.kind !== 'reserved') throw new Error('reservation attendue');

    await settleCall(reservation.id, 'confirmed', undefined, { free: true });

    const ligne = await query<{ credits: string; cost_cents: number }>(
      'select credits::text as credits, cost_cents from provider_calls where idempotency_key = $1',
      ['appel-non-facture'],
    );
    expect(Number(ligne.rows[0]?.credits)).toBe(0);
    expect(ligne.rows[0]?.cost_cents).toBe(0);
  });

  it('ne fait pas peser un appel en echec sur le budget', async () => {
    const reservation = await reserver('appel-en-echec');
    if (reservation.kind !== 'reserved') throw new Error('reservation attendue');

    await settleCall(reservation.id, 'failed', 'le fournisseur a refuse');

    const ligne = await query<{ cost_cents: number }>(
      'select cost_cents from provider_calls where idempotency_key = $1',
      ['appel-en-echec'],
    );
    expect(ligne.rows[0]?.cost_cents).toBe(0);
  });
});
