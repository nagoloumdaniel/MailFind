import { describe, expect, it } from 'vitest';
import { isDisposableIn, parseDomainList } from './disposable.js';

describe('isDisposableIn', () => {
  const liste = new Set(['yopmail.com', 'mailinator.com']);

  it('reconnait un domaine jetable et ses sous-domaines', () => {
    expect(isDisposableIn(liste, 'yopmail.com')).toBe(true);
    expect(isDisposableIn(liste, 'x.mailinator.com')).toBe(true);
  });

  it('ne se trompe pas de domaine', () => {
    expect(isDisposableIn(liste, 'acme.fr')).toBe(false);
    expect(isDisposableIn(liste, 'notyopmail.com')).toBe(false);
    expect(isDisposableIn(liste, 'com')).toBe(false);
  });
});

describe('parseDomainList', () => {
  it('lit un domaine par ligne, sans commentaires ni doublons', () => {
    expect(
      parseDomainList('# en-tete\nYopmail.com\n\nmailinator.com # courant\nyopmail.com\n'),
    ).toEqual(['yopmail.com', 'mailinator.com']);
  });

  it('ignore ce qui n est pas un domaine', () => {
    expect(parseDomainList('pas un domaine\n<html>\nlocalhost\n-x.com\n')).toEqual([]);
  });
});
