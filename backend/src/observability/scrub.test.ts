import { describe, expect, it } from 'vitest';
import { scrubText, scrubValue } from './scrub.js';

const CLE = `mf_${'A'.repeat(43)}`;
const JETON = `cm_${'b'.repeat(43)}`;

describe('masquage des journaux et de Sentry (S-03)', () => {
  it('masque les adresses, ou qu elles soient dans le texte', () => {
    expect(scrubText('refus de rh@acme.fr par le serveur')).toBe(
      'refus de [adresse] par le serveur',
    );
    expect(scrubText('Key (lower(email))=(Jean.Dupont+cv@sous.domaine.fr) existe')).toBe(
      'Key (lower(email))=([adresse]) existe',
    );
  });

  it('masque les secrets de l application et des tiers', () => {
    const texte = [
      CLE,
      JETON,
      `whsec_${'c'.repeat(43)}`,
      'v1.0a1b2c3d.aXY.dGFn.Y29udGVudQ',
      'Authorization: Bearer abc.def-ghi',
      'ya29.a0AfH6SM',
    ].join(' | ');

    const masque = scrubText(texte);

    expect(masque).toBe(
      '[cle-api] | [jeton-campaign-mailer] | [secret-webhook] | [chiffre] | Authorization: Bearer [coupe] | [jeton-google]',
    );
  });

  it('masque le code et l etat d une URL de retour', () => {
    expect(scrubText('/api/auth/campaign-mailer/callback?code=abc123&state=xyz')).toBe(
      '/api/auth/campaign-mailer/callback?code=[coupe]&state=[coupe]',
    );
  });

  it('laisse intact ce qui n identifie personne', () => {
    const texte = 'import 0199a1b2-c3d4 : 42 lignes, acme.fr explore en 3 s';
    expect(scrubText(texte)).toBe(texte);
  });

  it('parcourt les objets, les listes et survit a un cycle', () => {
    const erreur: Record<string, unknown> = {
      message: 'contact@beta.io refuse',
      details: [{ adresse: 'x@y.fr' }],
      date: new Date(0),
    };
    erreur.self = erreur;

    const masque = scrubValue(erreur);

    expect(masque.message).toBe('[adresse] refuse');
    expect(masque.details).toEqual([{ adresse: '[adresse]' }]);
    expect(masque.date).toEqual(new Date(0));
    expect(erreur.message).toBe('contact@beta.io refuse');
  });
});
