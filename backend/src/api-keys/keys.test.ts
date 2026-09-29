import { describe, expect, it } from 'vitest';
import { API_SCOPES, generateApiKey, hashApiKey, looksLikeApiKey } from './keys.js';

describe('generateApiKey (S-02)', () => {
  it('rend une cle, son prefixe affichable et son empreinte, jamais la meme deux fois', () => {
    const une = generateApiKey();
    const autre = generateApiKey();
    expect(une.secret).toMatch(/^mf_[A-Za-z0-9_-]{43}$/);
    expect(une.prefix).toBe(une.secret.slice(0, 11));
    expect(une.hash).toBe(hashApiKey(une.secret));
    expect(une.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(autre.secret).not.toBe(une.secret);
  });

  it('ne laisse pas l empreinte reveler la cle', () => {
    const { secret, hash } = generateApiKey();
    expect(hash).not.toContain(secret.slice(3, 20));
  });
});

describe('looksLikeApiKey', () => {
  it('reconnait la forme d une cle sans rien chercher en base', () => {
    expect(looksLikeApiKey(generateApiKey().secret)).toBe(true);
    expect(looksLikeApiKey('mf_court')).toBe(false);
    expect(looksLikeApiKey('sk_' + 'a'.repeat(43))).toBe(false);
  });
});

describe('API_SCOPES (F-1303)', () => {
  it('liste les sept portees du cahier des charges', () => {
    expect(API_SCOPES).toEqual([
      'companies:read',
      'companies:write',
      'emails:read',
      'imports:write',
      'verify',
      'exports:write',
      'integrations:write',
    ]);
  });
});
