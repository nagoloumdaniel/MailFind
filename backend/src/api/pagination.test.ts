import { describe, expect, it } from 'vitest';
import { AppError } from '../http/problem.js';
import { DEFAULT_LIMIT, encodeCursor, parsePageParams, toPage } from './pagination.js';

const ID = '01a0ede9-57d4-71e3-b0c4-d359a183d46b';

describe('parsePageParams (F-1307)', () => {
  it('prend 25 lignes par defaut, et relit un curseur qu elle a produit', () => {
    expect(parsePageParams({})).toEqual({ limit: DEFAULT_LIMIT, cursor: undefined });
    const curseur = encodeCursor({ createdAt: '2026-09-29T10:00:00.000Z', id: ID });
    expect(parsePageParams({ limit: '50', cursor: curseur })).toEqual({
      limit: 50,
      cursor: { createdAt: '2026-09-29T10:00:00.000Z', id: ID },
    });
  });

  it('refuse une limite hors bornes et un curseur fabrique', () => {
    for (const limit of ['0', '101', 'dix']) {
      expect(() => parsePageParams({ limit })).toThrow(AppError);
    }
    for (const cursor of ['abc', Buffer.from('{"id":"x"}').toString('base64url')]) {
      expect(() => parsePageParams({ cursor })).toThrowError(
        expect.objectContaining({ code: 'invalid_cursor' }),
      );
    }
  });
});

describe('toPage', () => {
  const lignes = [1, 2, 3].map((n) => ({
    id: `${ID.slice(0, -1)}${String(n)}`,
    createdAt: new Date(`2026-09-2${String(n)}T00:00:00Z`),
  }));

  it('rend un curseur sur la derniere ligne gardee quand il y a une suite', () => {
    const page = toPage(lignes, 2, (l) => l);
    expect(page.data).toHaveLength(2);
    expect(parsePageParams({ cursor: page.next_cursor }).cursor).toEqual({
      createdAt: '2026-09-22T00:00:00.000Z',
      id: lignes[1]?.id,
    });
  });

  it('ne rend pas de curseur sur la derniere page', () => {
    expect(toPage(lignes, 3, (l) => l).next_cursor).toBeNull();
  });
});
