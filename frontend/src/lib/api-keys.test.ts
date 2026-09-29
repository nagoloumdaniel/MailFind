import { describe, expect, it } from 'vitest';
import { API_SCOPES, lastUsedLabel, scopeLabel } from './api-keys';

describe('portees des cles (F-1303)', () => {
  it('propose les sept portees du serveur, chacune avec un libelle', () => {
    expect(API_SCOPES.map((s) => s.value)).toEqual([
      'companies:read',
      'companies:write',
      'emails:read',
      'imports:write',
      'verify',
      'exports:write',
      'integrations:write',
    ]);
    expect(scopeLabel('verify')).toBe('Verifier des adresses');
  });
});

describe('lastUsedLabel', () => {
  it('dit jamais pour une cle pas encore utilisee, sinon le jour', () => {
    expect(lastUsedLabel({ lastUsedAt: null })).toBe('Jamais utilisee');
    expect(lastUsedLabel({ lastUsedAt: '2026-09-29T10:00:00Z' })).toBe('Utilisee le 29/09/2026');
  });
});
