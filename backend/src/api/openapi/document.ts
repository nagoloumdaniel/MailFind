import { z } from 'zod';
import { API_SCOPES, type ApiScope } from '../../api-keys/keys.js';
import { updateCompanySchema } from '../../companies/detail.js';
import { pageParamsSchema } from '../pagination.js';
import { companyCreationSchema, companyFiltersSchema } from '../v1/companies.js';
import { emailFiltersSchema, emailUpdateSchema } from '../v1/emails.js';
import { exportCreationSchema } from '../v1/exports.js';
import { findSchema } from '../v1/find.js';
import { importCreationSchema } from '../v1/imports.js';
import { verifyListSchema } from '../v1/verify.js';
import { webhookCreationSchema } from '../v1/webhooks.js';
import { pushCreationSchema } from '../v1/integrations.js';
import {
  companyListItemSchema,
  companyWithEmailsSchema,
  emailWithCompanySchema,
  exportSchema,
  findCachedSchema,
  findPendingSchema,
  importSchema,
  page,
  problemSchema,
  progressSchema,
  usageSchema,
  verificationRunSchema,
  verifyResultSchema,
  deliverySchema,
  campaignMailerPushSchema,
  WEBHOOK_EVENT_VALUES,
  webhookEventSchema,
  webhookSchema,
} from './responses.js';

/**
 * Le document OpenAPI 3.1 de l'API publique (F-1301), tire des schemas zod
 * qui valident les requetes et de ceux qui decrivent les reponses. Le
 * registre ci-dessous est aussi celui des tests de contrat : une operation
 * absente d'ici n'est ni documentee ni verifiee.
 */

export interface ApiResponse {
  readonly description: string;
  readonly schema?: z.ZodType;
  /** application/json par defaut. */
  readonly contentType?: string;
}

export interface Operation {
  readonly method: 'get' | 'post' | 'patch' | 'delete';
  /** Au format OpenAPI, sans le prefixe `/v1` : `/imports/{id}`. */
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly tag: string;
  /** Absente, n'importe quelle cle active suffit. */
  readonly scope?: ApiScope;
  readonly query?: z.ZodObject;
  readonly body?: z.ZodType;
  /** Accepte l'en-tete Idempotency-Key (F-1305). */
  readonly idempotent?: boolean;
  readonly responses: Readonly<Record<number, ApiResponse>>;
}

const avecPage = <T extends z.ZodObject>(filtres: T) => filtres.extend(pageParamsSchema.shape);

const supprimerQuery = z.object({
  suppress: z
    .enum(['true', 'false'])
    .optional()
    .describe("true : ajoute d'abord les adresses a la liste de suppression (R-05)."),
});

const supprimeSchema = z.strictObject({ deleted: z.literal(true), suppressed: z.number().int() });

export const OPERATIONS: readonly Operation[] = [
  {
    method: 'post',
    path: '/imports',
    tag: 'Imports',
    summary: 'Creer et lancer un import',
    description:
      "Soit `companies` (une entree par entreprise, cles nommees d'apres les champs connus ; les autres cles restent des colonnes libres), soit `csv` (texte dont l'en-tete nomme ces champs). 5 000 lignes au plus.",
    scope: 'imports:write',
    body: importCreationSchema,
    idempotent: true,
    responses: {
      201: { description: 'Import cree', schema: z.strictObject({ import: importSchema }) },
    },
  },
  {
    method: 'get',
    path: '/imports/{id}',
    tag: 'Imports',
    summary: "Statut et progression d'un import",
    scope: 'companies:read',
    responses: {
      200: {
        description: "L'import",
        schema: z.strictObject({
          import: importSchema,
          progress: progressSchema,
          rejected_rows: z.array(z.strictObject({ line: z.number().int(), error: z.string() })),
        }),
      },
    },
  },
  {
    method: 'get',
    path: '/imports/{id}/results',
    tag: 'Imports',
    summary: "Entreprises et adresses produites par l'import",
    scope: 'companies:read',
    query: pageParamsSchema,
    responses: { 200: { description: 'Une page', schema: page(companyWithEmailsSchema) } },
  },
  {
    method: 'post',
    path: '/imports/{id}/cancel',
    tag: 'Imports',
    summary: 'Annuler un import en cours',
    scope: 'imports:write',
    responses: {
      200: { description: 'Import annule', schema: z.strictObject({ import: importSchema }) },
      409: { description: "L'import est deja termine", schema: problemSchema },
    },
  },
  {
    method: 'post',
    path: '/find',
    tag: 'Recherche',
    summary: "Rechercher les adresses d'une entreprise",
    description:
      "Deja exploree, l'entreprise est rendue tout de suite (200, annexe C) sans rien depenser. Sinon la recherche part comme un import d'une ligne (202), a suivre par GET /imports/{id}.",
    scope: 'imports:write',
    body: findSchema,
    idempotent: true,
    responses: {
      200: { description: 'Entreprise deja connue', schema: findCachedSchema },
      202: { description: 'Recherche lancee', schema: findPendingSchema },
    },
  },
  {
    method: 'get',
    path: '/companies',
    tag: 'Entreprises',
    summary: 'Lister et filtrer les entreprises',
    scope: 'companies:read',
    query: avecPage(companyFiltersSchema),
    responses: { 200: { description: 'Une page', schema: page(companyListItemSchema) } },
  },
  {
    method: 'post',
    path: '/companies',
    tag: 'Entreprises',
    summary: 'Creer une entreprise',
    description:
      "Memes regles de dedoublonnage qu'un import (F-303) ; la collecte part aussitot. Une entreprise deja presente est rendue en 200.",
    scope: 'companies:write',
    body: companyCreationSchema,
    idempotent: true,
    responses: {
      201: {
        description: 'Entreprise creee',
        schema: z.strictObject({
          company: companyWithEmailsSchema,
          created: z.literal(true),
          import_id: z.uuid(),
        }),
      },
      200: {
        description: 'Entreprise deja dans la bibliotheque',
        schema: z.strictObject({
          company: companyWithEmailsSchema,
          created: z.literal(false),
          import_id: z.uuid(),
        }),
      },
    },
  },
  {
    method: 'get',
    path: '/companies/{id}',
    tag: 'Entreprises',
    summary: "Detail d'une entreprise et de ses adresses",
    scope: 'companies:read',
    responses: {
      200: {
        description: "L'entreprise",
        schema: z.strictObject({ company: companyWithEmailsSchema }),
      },
    },
  },
  {
    method: 'patch',
    path: '/companies/{id}',
    tag: 'Entreprises',
    summary: 'Modifier une entreprise',
    scope: 'companies:write',
    body: updateCompanySchema,
    responses: {
      200: {
        description: "L'entreprise",
        schema: z.strictObject({ company: companyWithEmailsSchema }),
      },
    },
  },
  {
    method: 'delete',
    path: '/companies/{id}',
    tag: 'Entreprises',
    summary: 'Supprimer une entreprise et ses adresses',
    scope: 'companies:write',
    query: supprimerQuery,
    responses: { 200: { description: 'Supprimee', schema: supprimeSchema } },
  },
  {
    method: 'post',
    path: '/companies/{id}/enrich',
    tag: 'Entreprises',
    summary: "Relancer la collecte d'une entreprise",
    scope: 'companies:write',
    responses: {
      202: { description: 'Collecte relancee', schema: z.strictObject({ import_id: z.uuid() }) },
      409: { description: "L'entreprise n'a pas de domaine", schema: problemSchema },
    },
  },
  {
    method: 'get',
    path: '/emails',
    tag: 'Adresses',
    summary: 'Lister et filtrer les adresses',
    description: 'Les listes se separent par des virgules : `status=valid,accept_all`.',
    scope: 'emails:read',
    query: avecPage(emailFiltersSchema),
    responses: { 200: { description: 'Une page', schema: page(emailWithCompanySchema) } },
  },
  {
    method: 'patch',
    path: '/emails/{id}',
    tag: 'Adresses',
    summary: "Modifier le type, les etiquettes ou l'exclusion d'une adresse",
    description:
      "Portee companies:write : F-1303 ne prevoit pas d'emails:write. Seule une exclusion decidee par l'utilisateur se leve (D-20).",
    scope: 'companies:write',
    body: emailUpdateSchema,
    responses: {
      200: { description: "L'adresse", schema: z.strictObject({ email: emailWithCompanySchema }) },
    },
  },
  {
    method: 'delete',
    path: '/emails/{id}',
    tag: 'Adresses',
    summary: 'Supprimer une adresse',
    scope: 'companies:write',
    query: supprimerQuery,
    responses: { 200: { description: 'Supprimee', schema: supprimeSchema } },
  },
  {
    method: 'post',
    path: '/verify',
    tag: 'Verification',
    summary: "Verifier une liste d'adresses",
    description:
      "Controles gratuits, sans verification de boite. Jusqu'a 100 adresses en reponse directe ; au-dela, jusqu'a 10 000, en tache. `unverified` veut dire controles passes, jamais boite confirmee.",
    scope: 'verify',
    body: verifyListSchema,
    idempotent: true,
    responses: {
      200: {
        description: 'Resultats',
        schema: z.strictObject({ results: z.array(verifyResultSchema) }),
      },
      202: {
        description: 'Verification en tache',
        schema: z.strictObject({ verification: verificationRunSchema }),
      },
    },
  },
  {
    method: 'get',
    path: '/verifications/{id}',
    tag: 'Verification',
    summary: "Resultat d'une verification en tache",
    description: 'Gardee sept jours.',
    scope: 'verify',
    responses: {
      200: {
        description: 'La verification, et ses resultats une fois faite',
        schema: z.strictObject({
          verification: verificationRunSchema,
          results: z.array(verifyResultSchema).nullable(),
        }),
      },
    },
  },
  {
    method: 'post',
    path: '/exports',
    tag: 'Exports',
    summary: 'Creer un export filtre',
    description: 'Toujours produit en tache et garde sept jours.',
    scope: 'exports:write',
    body: exportCreationSchema,
    idempotent: true,
    responses: {
      202: { description: 'Export lance', schema: z.strictObject({ export: exportSchema }) },
    },
  },
  {
    method: 'get',
    path: '/exports/{id}',
    tag: 'Exports',
    summary: "Statut d'un export et son lien de telechargement",
    scope: 'exports:write',
    responses: {
      200: { description: "L'export", schema: z.strictObject({ export: exportSchema }) },
    },
  },
  {
    method: 'get',
    path: '/exports/{id}/download',
    tag: 'Exports',
    summary: "Telecharger le fichier d'un export",
    scope: 'exports:write',
    responses: { 200: { description: 'Le fichier', contentType: 'application/octet-stream' } },
  },
  {
    method: 'get',
    path: '/webhooks',
    tag: 'Webhooks',
    summary: 'Lister les abonnements',
    scope: 'integrations:write',
    responses: {
      200: {
        description: 'Les abonnements',
        schema: z.strictObject({ webhooks: z.array(webhookSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/webhooks',
    tag: 'Webhooks',
    summary: "S'abonner a des evenements",
    description:
      "Le secret de signature n'est rendu qu'ici, une fois. Idempotency-Key est ignore sur cette route : garder la reponse garderait le secret en clair. Chaque envoi porte `MailFind-Signature: t=...,v1=...`, le HMAC-SHA256 de `t.corps` avec ce secret ; refusez un `t` de plus de cinq minutes. Trois nouvelles tentatives apres un echec (30 s, 1 min, 2 min) ; aucune redirection n'est suivie.",
    scope: 'integrations:write',
    body: webhookCreationSchema,
    responses: {
      201: {
        description: 'Abonnement cree',
        schema: z.strictObject({ webhook: webhookSchema, secret: z.string() }),
      },
    },
  },
  {
    method: 'delete',
    path: '/webhooks/{id}',
    tag: 'Webhooks',
    summary: 'Supprimer un abonnement',
    description: 'Son journal de livraisons reste lisible.',
    scope: 'integrations:write',
    responses: {
      200: { description: 'Supprime', schema: z.strictObject({ deleted: z.literal(true) }) },
    },
  },
  {
    method: 'get',
    path: '/webhooks/{id}/deliveries',
    tag: 'Webhooks',
    summary: "Journal des livraisons d'un abonnement",
    scope: 'integrations:write',
    query: pageParamsSchema,
    responses: { 200: { description: 'Une page', schema: page(deliverySchema) } },
  },
  {
    method: 'post',
    path: '/integrations/campaign-mailer/push',
    tag: 'Campaign Mailer',
    summary: 'Envoyer une selection vers une campagne en brouillon',
    description:
      "Le compte doit avoir connecte Campaign Mailer depuis sa page Compte. L'envoi part en tache, par lots de 500 sous une cle d'idempotence chacun : relance, il ne cree aucun doublon. Rien n'est lance ; seul l'utilisateur lance la campagne, dans Campaign Mailer.",
    scope: 'integrations:write',
    body: pushCreationSchema,
    idempotent: true,
    responses: {
      202: {
        description: 'Envoi lance',
        schema: z.strictObject({ push: campaignMailerPushSchema }),
      },
      409: { description: 'Campaign Mailer non connecte', schema: problemSchema },
    },
  },
  {
    method: 'get',
    path: '/integrations/campaign-mailer/pushes/{id}',
    tag: 'Campaign Mailer',
    summary: "Etat d'un envoi vers Campaign Mailer",
    scope: 'integrations:write',
    responses: {
      200: { description: "L'envoi", schema: z.strictObject({ push: campaignMailerPushSchema }) },
    },
  },
  {
    method: 'get',
    path: '/usage',
    tag: 'Compte',
    summary: 'Credits et consommation du mois',
    description: "Les memes quotas que l'interface (F-1309). Toute cle active.",
    responses: { 200: { description: 'Les compteurs', schema: usageSchema } },
  },
];

/** Les erreurs que toute operation authentifiee peut rendre. */
const ERREURS_COMMUNES: Record<number, string> = {
  400: 'Requete refusee (corps, filtre ou curseur)',
  401: "Cle d'API absente, inconnue ou revoquee",
  403: 'Portee insuffisante, ou conditions a accepter',
  404: 'Ressource introuvable',
  429: 'Trop de requetes : voir Retry-After',
};

type Json = Record<string, unknown>;

/** Un schema zod en JSON Schema 2020-12, ses definitions rangees dans `components`. */
function convertir(schema: z.ZodType, io: 'input' | 'output', composants: Json): Json {
  // Les references sont reecrites partout, definitions comprises, avant de
  // ranger celles-ci dans `components`.
  const brut = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: 'any' })).replaceAll(
      '"#/$defs/',
      '"#/components/schemas/',
    ),
  ) as Json;
  const { $schema: _schema, $defs, ...reste } = brut;
  for (const [nom, def] of Object.entries(($defs as Json | undefined) ?? {})) composants[nom] = def;
  return reste;
}

function parametres(op: Operation, composants: Json): Json[] {
  const liste: Json[] = [];
  if (op.path.includes('{id}')) {
    liste.push({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  }
  if (op.idempotent === true) {
    liste.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'La meme cle rejoue la premiere reponse pendant 24 heures (F-1305).',
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    });
  }
  if (op.query !== undefined) {
    const json = convertir(op.query, 'input', composants);
    const proprietes = (json.properties as Record<string, Json> | undefined) ?? {};
    const requis = new Set((json.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries(proprietes)) {
      liste.push({ name, in: 'query', required: requis.has(name), schema });
    }
  }
  return liste;
}

export function buildOpenApiDocument(serverUrl: string): Json {
  const composants: Json = {};
  const paths: Record<string, Json> = {};
  const probleme = { $ref: '#/components/schemas/Problem' };

  for (const op of OPERATIONS) {
    const reponses: Json = {};
    for (const [statut, reponse] of Object.entries(op.responses)) {
      const type =
        reponse.contentType ??
        (Number(statut) >= 400 ? 'application/problem+json' : 'application/json');
      reponses[statut] = {
        description: reponse.description,
        content: {
          [type]:
            reponse.schema === undefined
              ? { schema: { type: 'string', format: 'binary' } }
              : { schema: convertir(reponse.schema, 'output', composants) },
        },
      };
    }
    for (const [statut, description] of Object.entries(ERREURS_COMMUNES)) {
      reponses[statut] ??= {
        description,
        content: { 'application/problem+json': { schema: probleme } },
      };
    }
    paths[op.path] = {
      ...paths[op.path],
      [op.method]: {
        operationId: `${op.method}${op.path.replace(/\{id\}/g, 'ById').replace(/[/-](\w)/g, (_m, c: string) => c.toUpperCase())}`,
        tags: [op.tag],
        summary: op.summary,
        ...(op.description === undefined ? {} : { description: op.description }),
        ...(op.scope === undefined ? {} : { 'x-scope': op.scope }),
        security: [{ cleApi: [] }],
        parameters: parametres(op, composants),
        ...(op.body === undefined
          ? {}
          : {
              requestBody: {
                required: true,
                content: {
                  'application/json': { schema: convertir(op.body, 'input', composants) },
                },
              },
            }),
        responses: reponses,
      },
    };
  }
  composants.Problem = convertir(problemSchema, 'output', {});

  // OpenAPI 3.1 : ce que MailFind envoie a l'application abonnee.
  const evenement = convertir(webhookEventSchema, 'output', composants);
  const webhooks = Object.fromEntries(
    WEBHOOK_EVENT_VALUES.map((type) => [
      type,
      {
        post: {
          summary: `Evenement ${type}`,
          parameters: [
            {
              name: 'MailFind-Signature',
              in: 'header',
              required: true,
              description: 't=horodatage,v1=HMAC-SHA256 hexadecimal de "t.corps" avec le secret.',
              schema: { type: 'string' },
            },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: evenement } } },
          responses: { '200': { description: 'Tout 2xx vaut accuse de reception.' } },
        },
      },
    ]),
  );

  return {
    openapi: '3.1.0',
    info: {
      title: 'API MailFind',
      version: '1.0.0',
      description:
        "Trouver et verifier les adresses professionnelles d'entreprises. Authentification : `Authorization: Bearer mf_...`, cle creee dans la page Compte. Chaque operation indique sa portee dans `x-scope`. 60 requetes par minute et par cle (en-tetes RateLimit-*). Erreurs au format RFC 9457. Listes paginees par curseur (`limit`, `cursor`, `next_cursor`).",
    },
    servers: [{ url: `${serverUrl}/v1` }],
    security: [{ cleApi: [] }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    webhooks,
    components: {
      schemas: composants,
      securitySchemes: {
        cleApi: {
          type: 'http',
          scheme: 'bearer',
          description: `Cle d'API. Portees : ${API_SCOPES.join(', ')}.`,
        },
      },
    },
  };
}
