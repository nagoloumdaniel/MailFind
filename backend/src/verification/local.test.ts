import { describe, expect, it } from 'vitest';
import { checkLocally, normalizeAddress, type MailDns } from './local.js';

const erreur = (code: string) => Object.assign(new Error(code), { code });

/** Un DNS simule : chaque domaine a son comportement. */
const DNS: MailDns = {
  mx: (domaine) => {
    switch (domaine) {
      case 'acme.fr':
      case 'gmail.com':
        return Promise.resolve([{ exchange: `mx.${domaine}`, priority: 10 }]);
      case 'nul.fr':
        return Promise.resolve([{ exchange: '.', priority: 0 }]);
      case 'sans-mx.fr':
        return Promise.reject(erreur('ENODATA'));
      case 'panne.fr':
        return Promise.reject(erreur('ESERVFAIL'));
      default:
        return Promise.reject(erreur('ENOTFOUND'));
    }
  },
  hasAddress: (domaine) => Promise.resolve(domaine === 'sans-mx.fr'),
};

const contexte = {
  dns: DNS,
  isDisposable: (domaine: string) => domaine === 'yopmail.com',
  isSuppressed: (adresse: string) => adresse === 'ne.plus@acme.fr',
};

describe('normalizeAddress (niveau 1)', () => {
  it('garde une adresse ordinaire, en minuscules', () => {
    expect(normalizeAddress(' Contact@Acme.FR ')).toBe('contact@acme.fr');
  });

  it('convertit un domaine internationalise en punycode', () => {
    expect(normalizeAddress('contact@café.fr')).toBe('contact@xn--caf-dma.fr');
  });

  it('refuse ce qui n est pas une adresse exploitable', () => {
    for (const adresse of [
      'contact',
      '@acme.fr',
      'contact@',
      'a..b@acme.fr',
      '.a@acme.fr',
      'a@acme',
      'a@-acme.fr',
      'a b@acme.fr',
      'a@acme.1',
    ]) {
      expect(normalizeAddress(adresse), adresse).toBeUndefined();
    }
    expect(normalizeAddress(`${'a'.repeat(65)}@acme.fr`)).toBeUndefined();
  });
});

describe('checkLocally (niveaux 1 a 7)', () => {
  it('passe une adresse d entreprise ordinaire, sans la dire verifiee', async () => {
    expect(await checkLocally('recrutement@acme.fr', contexte)).toMatchObject({
      status: 'unverified',
      level: 7,
      type: 'recruitment',
      mailServer: 'mx',
      webmail: false,
    });
  });

  it('refuse la syntaxe au niveau 1', async () => {
    expect(await checkLocally('pas une adresse', contexte)).toMatchObject({
      status: 'invalid',
      level: 1,
    });
  });

  it('ecarte une adresse supprimee avant toute requete DNS (niveau 7, R-04)', async () => {
    let requetes = 0;
    const compte = {
      ...contexte,
      dns: {
        mx: () => {
          requetes += 1;
          return DNS.mx('acme.fr');
        },
        hasAddress: (domaine: string) => DNS.hasAddress(domaine),
      },
    };
    expect(await checkLocally('Ne.Plus@acme.fr', compte)).toMatchObject({ status: 'suppressed' });
    expect(requetes).toBe(0);
  });

  it('ecarte un domaine jetable (niveau 4)', async () => {
    expect(await checkLocally('x@yopmail.com', contexte)).toMatchObject({
      status: 'disposable',
      level: 4,
    });
  });

  it('dit invalide un domaine qui n existe pas, ou qui ne recoit rien', async () => {
    expect(await checkLocally('contact@inexistant.fr', contexte)).toMatchObject({
      status: 'invalid',
      level: 2,
    });
    expect(await checkLocally('contact@nul.fr', contexte)).toMatchObject({
      status: 'invalid',
      level: 3,
    });
  });

  it('accepte le repli sur l adresse A quand le domaine n a pas de MX (niveau 3)', async () => {
    expect(await checkLocally('contact@sans-mx.fr', contexte)).toMatchObject({
      status: 'unverified',
      mailServer: 'a',
    });
  });

  it('ne conclut rien d une panne DNS', async () => {
    expect(await checkLocally('contact@panne.fr', contexte)).toMatchObject({
      status: 'unverified',
      dnsUnknown: true,
    });
  });

  it('signale une messagerie grand public (niveau 6)', async () => {
    expect(await checkLocally('acme.paris@gmail.com', contexte)).toMatchObject({
      status: 'risky',
      webmail: true,
    });
  });

  it('ne declasse pas une adresse de role (D-17)', async () => {
    const verdict = await checkLocally('contact@acme.fr', contexte);
    expect(verdict.status).toBe('unverified');
    expect(verdict.type).toBe('generic');
  });
});
