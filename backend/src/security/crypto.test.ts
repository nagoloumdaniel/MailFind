import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher, EncryptionError } from './crypto.js';

const cle = () => randomBytes(32).toString('hex');

describe('createCipher (S-01)', () => {
  it('rend ce qui a ete chiffre, texte et JSON', () => {
    const chiffreur = createCipher(cle());
    expect(chiffreur.decrypt(chiffreur.encrypt('contact@acme.fr'))).toBe('contact@acme.fr');
    expect(chiffreur.decryptJson(chiffreur.encryptJson({ emails: ['rh@acme.fr'] }))).toEqual({
      emails: ['rh@acme.fr'],
    });
  });

  it('ne laisse rien lire en clair', () => {
    const chiffre = createCipher(cle()).encrypt('jean.dupont@acme.fr');
    expect(chiffre).not.toContain('dupont');
    expect(chiffre).not.toContain('acme');
  });

  it('chiffre deux fois la meme valeur differemment', () => {
    const chiffreur = createCipher(cle());
    expect(chiffreur.encrypt('x')).not.toBe(chiffreur.encrypt('x'));
  });

  it('refuse une valeur alteree', () => {
    const chiffreur = createCipher(cle());
    const parties = chiffreur.encrypt('contact@acme.fr').split('.');
    const contenu = Buffer.from(parties[4] ?? '', 'base64url');
    contenu[0] = (contenu[0] ?? 0) ^ 1;
    parties[4] = contenu.toString('base64url');
    expect(() => chiffreur.decrypt(parties.join('.'))).toThrow(EncryptionError);
  });

  it('refuse une valeur chiffree avec une autre cle', () => {
    expect(() => createCipher(cle()).decrypt(createCipher(cle()).encrypt('x'))).toThrow(/inconnue/);
  });

  it('dechiffre encore avec l ancienne cle apres une rotation', () => {
    const ancienne = cle();
    const avant = createCipher(ancienne).encrypt('contact@acme.fr');
    const apres = createCipher(cle(), ancienne);
    expect(apres.decrypt(avant)).toBe('contact@acme.fr');
    // Ce qui est chiffre desormais l'est avec la nouvelle cle.
    expect(apres.encrypt('x').split('.')[1]).not.toBe(avant.split('.')[1]);
  });

  it('refuse une cle mal formee', () => {
    expect(() => createCipher('trop-courte')).toThrow(/64 caracteres/);
  });

  it('refuse une valeur illisible', () => {
    expect(() => createCipher(cle()).decrypt('pas.une.valeur')).toThrow(EncryptionError);
  });
});
