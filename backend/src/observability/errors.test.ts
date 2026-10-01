import { describe, expect, it } from 'vitest';
import { scrubEvent } from './errors.js';

type Evenement = Parameters<typeof scrubEvent>[0];

describe('rapports Sentry sans adresse ni jeton (S-03)', () => {
  it('reduit la requete a sa methode et son chemin', () => {
    const evenement = scrubEvent({
      request: {
        url: `https://mailfind.app/api/auth/campaign-mailer/callback?code=${'Q'.repeat(43)}`,
        method: 'GET',
        query_string: 'code=secret',
        cookies: { 'mailfind.sid': 's:abc' },
        headers: { authorization: 'Bearer abc' },
        data: { email: 'rh@acme.fr' },
      },
    } as unknown as Evenement);

    expect(evenement.request).toEqual({
      url: 'https://mailfind.app/api/auth/campaign-mailer/callback',
      method: 'GET',
    });
  });

  it('ne garde du compte que son identifiant', () => {
    const evenement = scrubEvent({
      user: { id: 'u-1', email: 'rh@acme.fr', ip_address: '203.0.113.1' },
    } as unknown as Evenement);

    expect(evenement.user).toEqual({ id: 'u-1' });
  });

  it('masque adresses et jetons dans le message, l exception et les extras', () => {
    const evenement = scrubEvent({
      message: 'refus de rh@acme.fr',
      exception: { values: [{ value: `jeton cm_${'Z'.repeat(43)} refuse` }] },
      extra: { derniere: 'contact@beta.io' },
    } as unknown as Evenement);

    expect(evenement.message).toBe('refus de [adresse]');
    expect(evenement.exception?.values?.[0]?.value).toBe('jeton [jeton-campaign-mailer] refuse');
    expect(evenement.extra?.derniere).toBe('[adresse]');
  });

  it('laisse passer ce qui n identifie personne', () => {
    const evenement = scrubEvent({
      message: 'crawl de acme.fr interrompu apres 3 pages',
    } as unknown as Evenement);

    expect(evenement.message).toBe('crawl de acme.fr interrompu apres 3 pages');
  });
});
