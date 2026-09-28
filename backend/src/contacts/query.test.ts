import { describe, expect, it } from 'vitest';
import { contactQuerySchema, likePattern } from './query.js';

describe('contactQuerySchema', () => {
  it('prend des valeurs par defaut raisonnables', () => {
    expect(contactQuerySchema.parse({})).toEqual({
      q: '',
      status: [],
      type: [],
      origin: [],
      sort: 'company',
      dir: 'asc',
      page: 1,
      pageSize: 25,
    });
  });

  it('lit les filtres multiples sous les deux formes', () => {
    const lu = contactQuerySchema.parse({
      status: ['valid', 'risky,valid'],
      type: 'hr,recruitment',
    });
    expect(lu.status).toEqual(['valid', 'risky']);
    expect(lu.type).toEqual(['hr', 'recruitment']);
  });

  it('refuse un tri, un statut ou une taille de page inconnus', () => {
    expect(contactQuerySchema.safeParse({ sort: 'password' }).success).toBe(false);
    expect(contactQuerySchema.safeParse({ status: 'verified' }).success).toBe(false);
    expect(contactQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });
});

describe('likePattern', () => {
  it('cherche le texte tape, sans jokers', () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});
