import { describe, expect, it } from 'vitest';
import { formatPoints, readBreakdown, scoreTone } from './score';

describe('readBreakdown', () => {
  it('rend les lignes du serveur, dans son ordre, et dit que leur somme est le score', () => {
    const detail = {
      score: 45,
      criteria: [
        { criterion: 'official_site', points: 40 },
        { criterion: 'relevant_role', points: 5 },
      ],
    };
    expect(readBreakdown(detail, 45)).toEqual({
      lines: [
        { criterion: 'official_site', points: 40 },
        { criterion: 'relevant_role', points: 5 },
      ],
      complete: true,
    });
  });

  it('signale un detail qui ne tombe pas juste plutot que de l afficher comme exact', () => {
    const detail = {
      criteria: [
        { criterion: 'official_site', points: 40 },
        { criterion: 'x', points: 5 },
      ],
    };
    expect(readBreakdown(detail, 45)?.complete).toBe(false);
  });

  it('ne rend rien sans score ou sans detail', () => {
    expect(readBreakdown(null, 10)).toBeUndefined();
    expect(readBreakdown({ criteria: [] }, null)).toBeUndefined();
    expect(readBreakdown({ criteria: 'non' }, 10)).toBeUndefined();
  });
});

describe('formatPoints et scoreTone', () => {
  it('ecrit le signe', () => {
    expect(formatPoints(40)).toBe('+40');
    expect(formatPoints(-15)).toBe('-15');
    expect(formatPoints(0)).toBe('0');
  });

  it('range le score en trois paliers', () => {
    expect(scoreTone(85)).toBe('high');
    expect(scoreTone(45)).toBe('medium');
    expect(scoreTone(0)).toBe('low');
  });
});
