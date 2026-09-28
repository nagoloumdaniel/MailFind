import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRechercheEntreprisesClient } from './recherche-entreprises.js';

/** Des reponses au format de l'API, servies en local : les tests ne sortent pas. */
const REPONSES: Record<string, unknown> = {
  doctolib: {
    results: [
      {
        siren: '794598813',
        nom_complet: 'DOCTOLIB',
        nom_raison_sociale: 'DOCTOLIB',
        activite_principale: '62.01Z',
        tranche_effectif_salarie: '42',
        etat_administratif: 'A',
        siege: { libelle_commune: 'LEVALLOIS-PERRET', code_postal: '92300' },
      },
      {
        siren: '901234567',
        nom_complet: 'DOCTOLIB SERVICES',
        etat_administratif: 'A',
        siege: { libelle_commune: 'PARIS' },
      },
    ],
  },
  'boulangerie martin': {
    results: [
      {
        siren: '111111111',
        nom_complet: 'BOULANGERIE MARTIN',
        etat_administratif: 'A',
        siege: { libelle_commune: 'LYON 3E ARRONDISSEMENT' },
      },
      {
        siren: '222222222',
        nom_complet: 'BOULANGERIE MARTIN',
        etat_administratif: 'A',
        siege: { libelle_commune: 'NANTES' },
      },
      {
        siren: '333333333',
        nom_complet: 'BOULANGERIE MARTIN',
        etat_administratif: 'C',
        siege: { libelle_commune: 'LILLE' },
      },
    ],
  },
  '794598813': {
    results: [{ siren: '794598813', nom_raison_sociale: 'DOCTOLIB', etat_administratif: 'A' }],
  },
  casse: { rien: 'du tout' },
};

let serveur: Server;
let base: string;
const requetes: string[] = [];

beforeAll(async () => {
  serveur = createServer((req, res) => {
    const q = new URL(req.url ?? '/', 'http://local').searchParams.get('q') ?? '';
    requetes.push(q);
    if (q === 'surcharge') {
      res.writeHead(429);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    // L'API cherche large ; ici, un mot cle en tete de requete suffit.
    const cle = Object.keys(REPONSES).find((mot) => q.toLowerCase().startsWith(mot));
    res.end(JSON.stringify(cle === undefined ? { results: [] } : REPONSES[cle]));
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

let appels = 0;
const client = () =>
  createRechercheEntreprisesClient({
    baseUrl: base,
    userAgent: 'MailFindBot/0.1',
    throttle: (tache) => {
      appels += 1;
      return tache();
    },
  });

describe('Recherche d entreprises (F-304)', () => {
  it('rend SIREN, raison sociale, ville, activite et effectif quand le nom est sans ambiguite', async () => {
    expect(await client().byName('Doctolib SAS')).toEqual({
      siren: '794598813',
      legalName: 'DOCTOLIB',
      city: 'LEVALLOIS-PERRET',
      industry: '62.01Z',
      employeeRange: '1 000 a 1 999 salaries',
    });
  });

  it('ne rend rien quand plusieurs entreprises portent le meme nom', async () => {
    expect(await client().byName('Boulangerie Martin')).toBeUndefined();
  });

  it('tranche par la ville, arrondissements compris', async () => {
    expect((await client().byName('Boulangerie Martin', 'Lyon 3e'))?.siren).toBe('111111111');
    expect((await client().byName('Boulangerie Martin', 'Nantes'))?.siren).toBe('222222222');
  });

  it('ne rend jamais une entreprise fermee', async () => {
    expect(await client().byName('Boulangerie Martin', 'Lille')).toBeUndefined();
  });

  it('retrouve une entreprise par son SIREN', async () => {
    expect((await client().bySiren('794598813'))?.legalName).toBe('DOCTOLIB');
  });

  it('ne se trompe pas sur une reponse inattendue', async () => {
    expect(await client().byName('casse')).toBeUndefined();
  });

  it('leve sur un refus de l API, pour que l etape soit retentee plus tard', async () => {
    await expect(client().byName('surcharge')).rejects.toThrow(/429/);
  });

  it('passe chaque requete par la file de debit', async () => {
    const avant = appels;
    await client().byName('Doctolib');
    await client().bySiren('794598813');
    expect(appels - avant).toBe(2);
  });
});
