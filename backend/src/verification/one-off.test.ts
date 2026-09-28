import { describe, expect, it } from 'vitest';
import type { MailDns } from './local.js';
import { checkAddressList } from './one-off.js';

describe('checkAddressList (F-705)', () => {
  let requetes = 0;
  const dns: MailDns = {
    mx: (domaine) => {
      requetes += 1;
      return domaine === 'acme.fr'
        ? Promise.resolve([{ exchange: 'mx.acme.fr', priority: 10 }])
        : Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    },
    hasAddress: () => Promise.resolve(false),
  };
  const contexte = {
    dns,
    isDisposable: (domaine: string) => domaine === 'yopmail.com',
    isSuppressed: (adresse: string) => adresse === 'ne.plus@acme.fr',
  };

  it('rend un verdict par adresse, dans l ordre donne, sans doublon', async () => {
    requetes = 0;
    const resultats = await checkAddressList(
      [
        'Contact@Acme.fr',
        'contact@acme.fr',
        '  ',
        'pas une adresse',
        'x@yopmail.com',
        'ne.plus@acme.fr',
        'rh@inexistant.fr',
        'jobs@acme.fr',
      ],
      contexte,
      2,
    );
    expect(resultats.map((r) => `${r.input} ${r.status}`)).toEqual([
      'Contact@Acme.fr unverified',
      'pas une adresse invalid',
      'x@yopmail.com disposable',
      'ne.plus@acme.fr suppressed',
      'rh@inexistant.fr invalid',
      'jobs@acme.fr unverified',
    ]);
    expect(resultats[0]).toMatchObject({ address: 'contact@acme.fr', type: 'generic' });
    expect(resultats[1]?.address).toBeNull();
    // Ni la syntaxe refusee, ni le domaine jetable, ni la suppression ne
    // demandent le DNS.
    expect(requetes).toBeLessThanOrEqual(3);
  });

  it('rend une liste vide pour une saisie vide', async () => {
    expect(await checkAddressList([], contexte)).toEqual([]);
  });
});
