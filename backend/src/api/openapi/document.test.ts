import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createV1Router } from '../router.js';
import { buildOpenApiDocument, OPERATIONS } from './document.js';

interface Couche {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Les routes reellement montees sur le routeur `/v1`, au format OpenAPI. */
function routesMontees(): string[] {
  const routeur = createV1Router() as unknown as { stack: Couche[] };
  return routeur.stack
    .flatMap((couche) =>
      couche.route === undefined
        ? []
        : Object.keys(couche.route.methods).map(
            (m) => `${m} ${couche.route?.path.replace(/:id\b/g, '{id}') ?? ''}`,
          ),
    )
    .filter((r) => r !== 'get /openapi.json')
    .sort();
}

describe('document OpenAPI 3.1 (F-1301)', () => {
  const document = buildOpenApiDocument('https://api.exemple.test') as {
    openapi: string;
    paths: Record<
      string,
      Record<string, { operationId: string; responses: Record<string, unknown> }>
    >;
    components: { schemas: Record<string, unknown> };
  };

  it('documente chaque route montee, et rien qui ne le soit pas', () => {
    const documentees = OPERATIONS.map((o) => `${o.method} ${o.path}`).sort();
    expect(documentees).toEqual(routesMontees());
  });

  it('est en 3.1, avec des identifiants d operation uniques', () => {
    expect(document.openapi).toBe('3.1.0');
    const ids = Object.values(document.paths).flatMap((p) =>
      Object.values(p).map((o) => o.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resout chaque reference vers un schema des composants', () => {
    const texte = JSON.stringify(document);
    expect(texte).not.toContain('$defs');
    const references = [...texte.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(references.length).toBeGreaterThan(0);
    for (const nom of references)
      expect(document.components.schemas, nom).toHaveProperty(nom ?? '');
  });

  it('donne a chaque operation une reponse de succes et les erreurs communes', () => {
    for (const [chemin, operations] of Object.entries(document.paths)) {
      for (const [methode, operation] of Object.entries(operations)) {
        const statuts = Object.keys(operation.responses);
        expect(
          statuts.some((s) => s.startsWith('2')),
          `${methode} ${chemin}`,
        ).toBe(true);
        for (const erreur of ['401', '403', '429'])
          expect(statuts, `${methode} ${chemin}`).toContain(erreur);
      }
    }
  });
});

describe('GET /v1/openapi.json', () => {
  it('se lit sans cle', async () => {
    const { createApp } = await import('../../app.js');
    const { createTestSession } = await import('../../test/session.js');
    const app = createApp({ logger: pino({ level: 'silent' }), session: createTestSession() });
    const reponse = await request(app).get('/v1/openapi.json');
    expect(reponse.status).toBe(200);
    expect(reponse.body.openapi).toBe('3.1.0');
    expect(reponse.headers['set-cookie']).toBeUndefined();
  });
});
