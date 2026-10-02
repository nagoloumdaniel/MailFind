import { describe, expect, it, vi } from 'vitest';
import { createMailDns, type DnsResolver } from './local.js';

/**
 * Le cache du resolveur DNS. Il n'y a pas de reseau ici : ce qui est verifie
 * est la logique du cache, qui decide combien de fois une liste de mille
 * adresses interroge le DNS, et ce qu'elle fait d'une panne.
 */

const MX = [{ exchange: 'mx.acme.fr', priority: 10 }];

function resolveur(reponses: Partial<DnsResolver> = {}) {
  const appels = { mx: 0, v4: 0, v6: 0 };
  const faux: DnsResolver = {
    resolveMx: (domaine) => {
      appels.mx += 1;
      return reponses.resolveMx?.(domaine) ?? Promise.resolve(MX);
    },
    resolve4: (domaine) => {
      appels.v4 += 1;
      return reponses.resolve4?.(domaine) ?? Promise.resolve(['203.0.113.1']);
    },
    resolve6: (domaine) => {
      appels.v6 += 1;
      return reponses.resolve6?.(domaine) ?? Promise.resolve([]);
    },
  };
  return { faux, appels };
}

const echec = (code: string) => {
  const erreur: NodeJS.ErrnoException = new Error(code);
  erreur.code = code;
  return Promise.reject(erreur);
};

describe('cache du resolveur de messagerie', () => {
  it('n interroge le DNS qu une fois par domaine', async () => {
    const { faux, appels } = resolveur();
    const dns = createMailDns(60_000, faux);

    expect(await dns.mx('acme.fr')).toEqual(MX);
    expect(await dns.mx('acme.fr')).toEqual(MX);
    expect(await dns.mx('beta.io')).toEqual(MX);

    expect(appels.mx).toBe(2);
  });

  it('reinterroge une fois le cache perime', async () => {
    vi.useFakeTimers();
    try {
      const { faux, appels } = resolveur();
      const dns = createMailDns(1000, faux);

      await dns.mx('acme.fr');
      vi.advanceTimersByTime(1500);
      await dns.mx('acme.fr');

      expect(appels.mx).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne garde pas une panne en cache : la demande suivante retente', async () => {
    let premier = true;
    const { faux, appels } = resolveur({
      resolveMx: () => {
        if (premier) {
          premier = false;
          return echec('ESERVFAIL');
        }
        return Promise.resolve(MX);
      },
    });
    const dns = createMailDns(60_000, faux);

    await expect(dns.mx('acme.fr')).rejects.toThrow('ESERVFAIL');
    expect(await dns.mx('acme.fr')).toEqual(MX);
    expect(appels.mx).toBe(2);
  });

  it('dit qu un domaine a une adresse, en v4 comme en v6', async () => {
    const enV6 = resolveur({
      resolve4: () => Promise.resolve([]),
      resolve6: () => Promise.resolve(['2001:db8::1']),
    });

    expect(await createMailDns(60_000, resolveur().faux).hasAddress('acme.fr')).toBe(true);
    expect(await createMailDns(60_000, enV6.faux).hasAddress('acme.fr')).toBe(true);
  });

  it('repond « pas d adresse » plutot que d echouer quand le domaine n en a pas', async () => {
    const { faux } = resolveur({
      resolve4: () => echec('ENODATA'),
      resolve6: () => echec('ENODATA'),
    });

    expect(await createMailDns(60_000, faux).hasAddress('acme.fr')).toBe(false);
  });

  it('laisse remonter une panne de resolution, qui n est pas une absence', async () => {
    const { faux } = resolveur({
      resolve4: () => echec('ESERVFAIL'),
      resolve6: () => echec('ESERVFAIL'),
    });

    // Confondre « le DNS ne repond pas » avec « le domaine n'existe pas »
    // ferait declarer invalides des adresses valables.
    await expect(createMailDns(60_000, faux).hasAddress('acme.fr')).rejects.toThrow('ESERVFAIL');
  });

  it('vide le cache plutot que de grossir sans fin', async () => {
    const { faux, appels } = resolveur();
    const dns = createMailDns(60_000, faux);

    // Au-dela du plafond, le cache repart de zero : le processus tourne des
    // semaines, et un cache sans borne finirait par tout retenir.
    for (let rang = 0; rang < 5001; rang += 1) await dns.mx(`site-${String(rang)}.fr`);
    await dns.mx('site-0.fr');

    expect(appels.mx).toBe(5002);
  });
});
