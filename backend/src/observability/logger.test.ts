import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, scrubbedRequest } from './logger.js';

function journal() {
  const lignes: string[] = [];
  const sortie = new Writable({
    write(morceau: Buffer, _encodage, fin) {
      lignes.push(morceau.toString());
      fin();
    },
  });
  return { logger: createLogger(sortie, 'info'), texte: () => lignes.join('') };
}

describe('journaux sans adresse ni secret (S-03)', () => {
  it('masque une adresse dans le message, dans un champ et dans une erreur', () => {
    const { logger, texte } = journal();

    logger.info('refus de %s', 'rh@acme.fr');
    logger.warn({ contact: { email: 'jean@beta.io' }, domaine: 'beta.io' }, 'champ libre');
    logger.error({ err: new Error('duplicate key (lower(email))=(x@y.fr)') }, 'echec');

    const sortie = texte();
    expect(sortie).not.toMatch(/@acme\.fr|jean@|x@y\.fr/);
    expect(sortie).toContain('[adresse]');
    expect(sortie).toContain('beta.io');
    // L'erreur reste lisible : seul ce qui identifie est masque.
    expect(sortie).toContain('duplicate key (lower(email))=([adresse])');
    expect(sortie).toContain('"stack"');
  });

  it('masque un jeton cite dans un message d erreur', () => {
    const { logger, texte } = journal();

    logger.error({ err: new Error(`jeton cm_${'Z'.repeat(43)} refuse`) }, 'appel');

    expect(texte()).not.toContain('Z'.repeat(43));
    expect(texte()).toContain('[jeton-campaign-mailer]');
  });

  it('masque le code d une URL de retour, telle que pino-http la journalise', () => {
    const code = 'Q'.repeat(43);
    // La forme que pino-http passe a son serialiseur de requete.
    const requete = {
      id: '1',
      method: 'GET',
      url: `/api/auth/campaign-mailer/callback?code=${code}&state=s`,
      headers: { host: 'mailfind.app' },
      socket: { remoteAddress: '203.0.113.1', remotePort: 443 },
      raw: {},
    } as unknown as Parameters<typeof scrubbedRequest>[0];

    const masquee = JSON.stringify(scrubbedRequest(requete));

    expect(masquee).toContain('/api/auth/campaign-mailer/callback');
    expect(masquee).not.toContain(code);
    expect(masquee).toContain('code=[coupe]');
  });

  it('garde les chemins connus coupes par leur nom', () => {
    const { logger, texte } = journal();

    logger.info({ token: 'nimporte-quoi', nested: { secret: 'chut' } }, 'secrets');

    expect(texte()).not.toMatch(/nimporte-quoi|chut/);
  });
});
