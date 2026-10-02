import { describe, expect, it } from 'vitest';
import {
  evaluateAlerts,
  PROVIDER_FAILURE_RATE,
  PROVIDER_MIN_CALLS,
  QUEUE_STUCK_WAITING,
  type AlertInput,
} from './alerts.js';
import type { ReadinessReport } from './readiness.js';

const SAIN: ReadinessReport = {
  ready: true,
  checks: [
    { name: 'database', status: 'ok', ms: 3 },
    { name: 'redis', status: 'ok', ms: 1 },
  ],
  queues: [{ name: 'company', waiting: 2, active: 1, failed: 0 }],
  workerSeenAt: '2026-10-02T10:00:00.000Z',
};

const entree = (modifications: Partial<AlertInput> = {}): AlertInput => ({
  readiness: SAIN,
  providers: [],
  spentCents: {},
  budgetCents: 0,
  ...modifications,
});

const genres = (input: AlertInput) => evaluateAlerts(input).map((alerte) => alerte.kind);

describe('alertes (section 12)', () => {
  it('ne dit rien quand tout va bien', () => {
    expect(evaluateAlerts(entree())).toEqual([]);
  });

  it('signale une dependance muette', () => {
    const readiness = {
      ...SAIN,
      ready: false,
      checks: [{ name: 'database', status: 'failed' as const, detail: 'delai', ms: 3000 }],
    };

    expect(genres(entree({ readiness }))).toEqual(['dependency_down']);
  });

  it('signale une file qui attend sans que rien ne tourne', () => {
    const readiness = {
      ...SAIN,
      queues: [{ name: 'company', waiting: QUEUE_STUCK_WAITING, active: 0, failed: 3 }],
    };

    expect(genres(entree({ readiness }))).toEqual(['queue_stuck']);
  });

  it('ne crie pas sur une file qui avance, meme chargee', () => {
    const readiness = {
      ...SAIN,
      queues: [{ name: 'company', waiting: QUEUE_STUCK_WAITING * 10, active: 4, failed: 0 }],
    };

    expect(genres(entree({ readiness }))).toEqual([]);
  });

  it('signale un processus de traitement silencieux', () => {
    expect(genres(entree({ readiness: { ...SAIN, workerSeenAt: null } }))).toEqual([
      'worker_silent',
    ]);
  });

  it('signale un fournisseur qui echoue souvent', () => {
    const providers = [
      { provider: 'hunter', calls: 20, failures: Math.ceil(20 * PROVIDER_FAILURE_RATE) },
    ];

    const alertes = evaluateAlerts(entree({ providers }));

    expect(alertes).toHaveLength(1);
    expect(alertes[0]?.facts).toMatchObject({ fournisseur: 'hunter' });
  });

  it('se tait quand les appels sont trop peu nombreux pour conclure', () => {
    // Un echec sur trois appels fait 33 %, et ne veut rien dire.
    const providers = [{ provider: 'hunter', calls: PROVIDER_MIN_CALLS - 1, failures: 3 }];

    expect(genres(entree({ providers }))).toEqual([]);
  });

  it('previent avant le mur du budget, pas seulement au mur', () => {
    const alertes = evaluateAlerts(
      entree({ budgetCents: 1000, spentCents: { hunter: 800, brave: 100 } }),
    );

    expect(alertes.map((a) => a.kind)).toEqual(['spend_near_budget']);
    expect(alertes[0]?.facts).toMatchObject({ fournisseur: 'hunter', centimes: 800 });
  });

  it('ne parle pas de budget quand il n y en a pas', () => {
    expect(genres(entree({ budgetCents: 0, spentCents: { hunter: 5000 } }))).toEqual([]);
  });

  it('rend plusieurs alertes a la fois, sans en perdre', () => {
    const readiness = {
      ...SAIN,
      workerSeenAt: null,
      queues: [{ name: 'import', waiting: QUEUE_STUCK_WAITING, active: 0, failed: 0 }],
    };

    expect(genres(entree({ readiness })).sort()).toEqual(['queue_stuck', 'worker_silent']);
  });
});
