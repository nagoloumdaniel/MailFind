import { describe, expect, it } from 'vitest';
import { computeScore, type EmailStatus, type ScoreInput, type ScoreSource } from './score.js';

const MAINTENANT = new Date('2026-09-28T12:00:00Z');
const HIER = new Date('2026-09-27T12:00:00Z');

const page = (url: string, discoveredAt = HIER): ScoreSource => ({
  kind: 'website',
  url,
  discoveredAt,
});

function score(partiel: Partial<ScoreInput>) {
  return computeScore({
    status: 'unverified',
    origin: 'found',
    type: 'recruitment',
    wantedTypes: ['recruitment', 'hr', 'generic'],
    officialDomain: 'acme.fr',
    sources: [page('https://www.acme.fr/carrieres')],
    now: MAINTENANT,
    ...partiel,
  });
}

const somme = (resultat: ReturnType<typeof computeScore>) =>
  resultat.criteria.reduce((total, ligne) => total + ligne.points, 0);

describe('computeScore (6.9)', () => {
  it('additionne site officiel et role pertinent pour une adresse trouvee', () => {
    const resultat = score({});
    expect(resultat.score).toBe(45);
    expect(resultat.criteria).toEqual([
      { criterion: 'official_site', points: 40 },
      { criterion: 'relevant_role', points: 5 },
    ]);
  });

  it('ajoute la page contact ou mentions legales, une seconde page et la verification', () => {
    const resultat = score({
      status: 'valid',
      sources: [page('https://acme.fr/carrieres'), page('https://acme.fr/mentions-legales')],
    });
    expect(resultat.criteria.map((l) => l.criterion)).toEqual([
      'official_site',
      'legal_or_contact_page',
      'second_source',
      'valid',
      'relevant_role',
    ]);
    expect(resultat.score).toBe(100);
  });

  it('ne compte pas le site officiel pour une page d un autre domaine', () => {
    const resultat = score({ sources: [page('https://www.welcometothejungle.com/fr/acme')] });
    expect(resultat.criteria.map((l) => l.criterion)).toEqual(['relevant_role']);
  });

  it('compte un second fournisseur, pas une deduction', () => {
    const fournisseurs = score({
      origin: 'provider',
      sources: [
        { kind: 'provider', provider: 'hunter', discoveredAt: HIER },
        { kind: 'provider', provider: 'autre', discoveredAt: HIER },
      ],
    });
    expect(fournisseurs.criteria).toContainEqual({ criterion: 'second_source', points: 15 });

    const deduite = score({
      sources: [page('https://acme.fr/carrieres'), { kind: 'deduction', discoveredAt: HIER }],
    });
    expect(deduite.criteria.map((l) => l.criterion)).not.toContain('second_source');
  });

  it('donne 5 points a accept_all et en retire 10 a unknown', () => {
    expect(score({ status: 'accept_all' }).score).toBe(50);
    expect(score({ status: 'unknown' }).score).toBe(35);
  });

  it('ne compte pas le role quand le type n est pas recherche, ni pour une adresse nominative', () => {
    expect(score({ type: 'sales' }).score).toBe(40);
    expect(score({ type: 'personal', wantedTypes: ['personal'] }).score).toBe(40);
  });

  it('retire 15 points quand la source la plus recente a plus de 12 mois', () => {
    const ancienne = score({
      sources: [page('https://acme.fr/carrieres', new Date('2025-06-01'))],
    });
    expect(ancienne.criteria).toContainEqual({ criterion: 'old_source', points: -15 });
    expect(ancienne.score).toBe(30);
  });

  it('plafonne a 40 une adresse deduite et non confirmee', () => {
    const deduite = score({
      origin: 'deduced',
      status: 'accept_all',
      sources: [{ kind: 'deduction', discoveredAt: HIER }],
    });
    // accept_all + role : 10, sous le plafond.
    expect(deduite.score).toBe(10);
    expect(deduite.criteria.map((l) => l.criterion)).not.toContain('deduced_cap');
  });

  it('ne plafonne pas une deduction que la verification de boite a confirmee', () => {
    const confirmee = score({
      origin: 'deduced',
      status: 'valid',
      sources: [{ kind: 'deduction', discoveredAt: HIER }],
    });
    // valid + role : 35, confirmee par la boite, donc pas de plafond.
    expect(confirmee.score).toBe(35);
  });

  it('met a zero une adresse invalide, jetable ou supprimee, et le dit', () => {
    for (const status of ['invalid', 'disposable', 'suppressed'] as const) {
      const resultat = score({ status });
      expect(resultat.score, status).toBe(0);
      expect(resultat.criteria.at(-1), status).toEqual({
        criterion: 'excluded_status',
        points: -45,
      });
    }
  });

  it('ne descend jamais sous 0', () => {
    const resultat = score({
      status: 'unknown',
      type: 'unknown',
      officialDomain: null,
      sources: [page('https://ailleurs.fr/', new Date('2024-01-01'))],
    });
    expect(resultat.score).toBe(0);
    expect(resultat.criteria.at(-1)).toEqual({ criterion: 'bounds', points: 25 });
  });

  it('rend un detail dont la somme est le score, pour toutes les combinaisons', () => {
    const statuts: EmailStatus[] = [
      'valid',
      'accept_all',
      'risky',
      'unknown',
      'invalid',
      'disposable',
      'suppressed',
      'unverified',
    ];
    const jeux: ScoreSource[][] = [
      [],
      [page('https://acme.fr/contact')],
      [page('https://acme.fr/contact'), page('https://acme.fr/jobs', new Date('2024-01-01'))],
      [{ kind: 'deduction', discoveredAt: HIER }],
      [
        { kind: 'provider', provider: 'hunter', discoveredAt: new Date('2024-01-01') },
        page('https://autre.fr/'),
      ],
    ];
    for (const status of statuts) {
      for (const origin of ['found', 'provider', 'deduced', 'imported'] as const) {
        for (const sources of jeux) {
          for (const type of ['recruitment', 'sales', 'personal', 'unknown'] as const) {
            const resultat = score({ status, origin, sources, type });
            expect(somme(resultat)).toBe(resultat.score);
            expect(resultat.score).toBeGreaterThanOrEqual(0);
            expect(resultat.score).toBeLessThanOrEqual(100);
            if (['invalid', 'disposable', 'suppressed'].includes(status)) {
              expect(resultat.score).toBe(0);
            }
            if (
              origin === 'deduced' &&
              status !== 'valid' &&
              sources.every((s) => s.kind === 'deduction')
            ) {
              expect(resultat.score).toBeLessThanOrEqual(40);
            }
          }
        }
      }
    }
  });
});
