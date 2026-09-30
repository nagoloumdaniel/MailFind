import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExportData } from '../exports/data.js';
import { BATCH_SIZE, toCampaignMailerContacts } from './push.js';

/**
 * Le contrat avec Campaign Mailer, vu de MailFind : ce que MailFind envoie
 * doit valider le document OpenAPI de l'API v1 de Campaign Mailer. Une copie
 * du document est gardee dans `docs/contracts/` ; quand Campaign Mailer change
 * son API, on la regenere, et ce test dit si MailFind suit encore.
 */

type Schema = Record<string, unknown>;

const DOCUMENT = JSON.parse(
  readFileSync(
    new URL('../../../docs/contracts/campaign-mailer-v1.openapi.json', import.meta.url),
    'utf8',
  ),
) as {
  paths: Record<
    string,
    {
      post: {
        parameters: { name: string; required: boolean }[];
        requestBody: { content: Record<string, { schema: Schema }> };
        responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
      };
    }
  >;
  components: { schemas: Record<string, Schema> };
};

/**
 * Le sous-ensemble de JSON Schema 2020-12 que ce document emploie. Rend la
 * liste des ecarts, vide quand la valeur est conforme.
 */
function valider(valeur: unknown, schema: Schema, chemin = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const nom = schema.$ref.split('/').at(-1) ?? '';
    const cible = DOCUMENT.components.schemas[nom];
    return cible === undefined
      ? [`${chemin} : reference ${nom} absente`]
      : valider(valeur, cible, chemin);
  }
  const variantes = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (variantes !== undefined) {
    return variantes.some((v) => valider(valeur, v, chemin).length === 0)
      ? []
      : [`${chemin} : aucune variante ne convient`];
  }
  const ecarts: string[] = [];
  if ('const' in schema && valeur !== schema.const)
    ecarts.push(`${chemin} : attendu ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(valeur))
    ecarts.push(`${chemin} : hors de ${JSON.stringify(schema.enum)}`);
  const types = schema.type === undefined ? [] : ([] as unknown[]).concat(schema.type);
  const typeDe = (v: unknown) =>
    v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
  if (
    types.length > 0 &&
    !types.some((t) => t === typeDe(valeur) || (t === 'number' && typeof valeur === 'number'))
  ) {
    return [`${chemin} : type ${typeDe(valeur)}, attendu ${types.join('|')}`];
  }
  if (typeof valeur === 'string') {
    if (typeof schema.maxLength === 'number' && valeur.length > schema.maxLength)
      ecarts.push(`${chemin} : trop long`);
    if (typeof schema.minLength === 'number' && valeur.length < schema.minLength)
      ecarts.push(`${chemin} : trop court`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(valeur))
      ecarts.push(`${chemin} : motif`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(valeur)))
      ecarts.push(`${chemin} : date illisible`);
    if (schema.format === 'uri' && !URL.canParse(valeur)) ecarts.push(`${chemin} : URL illisible`);
  }
  if (Array.isArray(valeur)) {
    if (typeof schema.maxItems === 'number' && valeur.length > schema.maxItems)
      ecarts.push(`${chemin} : plus de ${String(schema.maxItems)} elements`);
    if (typeof schema.minItems === 'number' && valeur.length < schema.minItems)
      ecarts.push(`${chemin} : trop peu d elements`);
    const items = schema.items as Schema | undefined;
    if (items !== undefined)
      valeur.forEach((v, i) => ecarts.push(...valider(v, items, `${chemin}[${String(i)}]`)));
  }
  if (typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)) {
    const objet = valeur as Record<string, unknown>;
    const proprietes = (schema.properties ?? {}) as Record<string, Schema>;
    for (const requise of (schema.required ?? []) as string[]) {
      if (!(requise in objet)) ecarts.push(`${chemin}.${requise} : manquant`);
    }
    for (const [cle, v] of Object.entries(objet)) {
      const sous = proprietes[cle];
      if (sous === undefined) {
        if (schema.additionalProperties === false)
          ecarts.push(`${chemin}.${cle} : champ inconnu de Campaign Mailer`);
      } else {
        ecarts.push(...valider(v, sous, `${chemin}.${cle}`));
      }
    }
  }
  return ecarts;
}

const corpsDe = (chemin: string) => {
  const schema = DOCUMENT.paths[chemin]?.post.requestBody.content['application/json']?.schema;
  if (schema === undefined) throw new Error(`${chemin} absent du document de Campaign Mailer`);
  return schema;
};

/** Une bibliotheque qui couvre les cas de toCampaignMailerContacts. */
const DONNEES: ExportData = {
  companies: [
    {
      id: 'c1',
      name: 'Acme',
      domain: 'acme.fr',
      websiteUrl: null,
      careersUrl: null,
      siren: null,
      city: null,
      country: null,
      industry: null,
      tags: [],
      notes: null,
      emails: [
        {
          id: 'e1',
          address: 'RH@acme.fr',
          contactName: 'Marie Durand',
          salutation: 'Madame',
          type: 'hr',
          origin: 'found',
          status: 'valid',
          score: 90,
          tags: [],
          verificationReason: null,
          verifiedAt: new Date('2026-09-29T10:00:00Z'),
          createdAt: new Date(),
          sources: [
            {
              kind: 'website',
              url: 'https://acme.fr/carrieres',
              provider: null,
              method: 'mailto',
              excerpt: null,
              discoveredAt: '2026-09-28T10:00:00Z',
            },
          ],
        },
        {
          id: 'e2',
          address: 'jobs@acme.fr',
          contactName: null,
          salutation: null,
          type: 'recruitment',
          origin: 'deduced',
          status: 'unverified',
          score: 30,
          tags: [],
          verificationReason: null,
          verifiedAt: null,
          createdAt: new Date(),
          sources: [
            {
              kind: 'deduction',
              url: null,
              provider: null,
              method: null,
              excerpt: null,
              discoveredAt: '2026-09-28T10:00:00Z',
            },
          ],
        },
        {
          id: 'e3',
          address: 'contact@acme.fr',
          contactName: null,
          salutation: null,
          type: 'generic',
          origin: 'provider',
          status: 'accept_all',
          score: 50,
          tags: [],
          verificationReason: null,
          verifiedAt: new Date('2026-09-27T10:00:00Z'),
          createdAt: new Date(),
          sources: [
            {
              kind: 'provider',
              url: null,
              provider: 'hunter',
              method: null,
              excerpt: null,
              discoveredAt: '2026-09-28T10:00:00Z',
            },
          ],
        },
        {
          id: 'e4',
          address: 'risky@acme.fr',
          contactName: null,
          salutation: null,
          type: 'generic',
          origin: 'found',
          status: 'risky',
          score: 20,
          tags: [],
          verificationReason: null,
          verifiedAt: null,
          createdAt: new Date(),
          sources: [
            {
              kind: 'website',
              url: 'https://acme.fr/',
              provider: null,
              method: 'text',
              excerpt: null,
              discoveredAt: '2026-09-28T10:00:00Z',
            },
          ],
        },
        {
          id: 'e5',
          address: 'étudiant@acme.fr',
          contactName: null,
          salutation: null,
          type: 'generic',
          origin: 'found',
          status: 'valid',
          score: 60,
          tags: [],
          verificationReason: null,
          verifiedAt: new Date(),
          createdAt: new Date(),
          sources: [],
        },
      ],
    },
  ],
};

describe('contrat avec Campaign Mailer (tests de contrat partages, 6.13)', () => {
  const { contacts, skipped } = toCampaignMailerContacts(DONNEES);

  it('cree un brouillon avec un corps que Campaign Mailer accepte', () => {
    const corps = { name: 'Alternance 2027', contacts };
    expect(valider(corps, corpsDe('/campaigns'))).toEqual([]);
  });

  it('ajoute des contacts avec un corps que Campaign Mailer accepte', () => {
    expect(valider({ contacts }, corpsDe('/campaigns/{id}/contacts'))).toEqual([]);
  });

  it('laisse de cote une adresse que Campaign Mailer refuserait', () => {
    expect(skipped).toBe(1);
    expect(contacts.map((c) => c.email)).not.toContain('étudiant@acme.fr');
  });

  it('voit un ecart au contrat (le test ne passe pas a vide)', () => {
    const faux = { contacts: [{ email: 'a@acme.fr', inconnu: 1 }], trop: true };
    expect(valider(faux, corpsDe('/campaigns/{id}/contacts'))).not.toEqual([]);
    expect(valider({ contacts: 'pas une liste' }, corpsDe('/campaigns/{id}/contacts'))).not.toEqual(
      [],
    );
  });

  it('envoie des lots que Campaign Mailer accepte en un appel', () => {
    const lot = Array.from({ length: BATCH_SIZE }, (_, i) => ({ email: `a${String(i)}@acme.fr` }));
    expect(valider({ contacts: lot }, corpsDe('/campaigns/{id}/contacts'))).toEqual([]);
  });

  it('envoie toujours l Idempotency-Key que Campaign Mailer exige', () => {
    for (const chemin of ['/campaigns', '/campaigns/{id}/contacts']) {
      const cle = DOCUMENT.paths[chemin]?.post.parameters.find((p) => p.name === 'Idempotency-Key');
      expect(cle?.required, chemin).toBe(true);
    }
  });

  it('lit dans la reponse de Campaign Mailer ce que le client attend', () => {
    const reponse =
      DOCUMENT.paths['/campaigns']?.post.responses['201']?.content?.['application/json']?.schema;
    const exemple = {
      campaign: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'x',
        type: 'autre',
        status: 'draft',
        url: 'https://cm.test/campaigns/1',
      },
      report: { read: 1, imported: 1, rejected: [] },
    };
    expect(valider(exemple, reponse ?? {})).toEqual([]);
  });
});
