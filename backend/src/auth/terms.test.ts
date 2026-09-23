import request from 'supertest';
import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express, RequestHandler } from 'express';
import type { User } from '../users/repository.js';
import { createTestSession } from '../test/session.js';

const silent = pino({ level: 'silent' });

const utilisateur: User = {
  id: '01929c3e-0000-7000-8000-000000000001',
  googleId: 'google-1',
  email: 'proprietaire@example.com',
  name: 'Proprietaire',
  termsVersion: null,
  termsAcceptedAt: null,
  createdAt: new Date('2026-09-23T00:00:00Z'),
};

// La base n'est pas jointe : ce qui est verifie ici, ce sont les regles de la
// route, pas le SQL.
vi.mock('../users/repository.js', () => ({
  findUserById: vi.fn(),
  acceptTerms: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock('../audit/repository.js', () => ({
  recordAuditEvent: vi.fn(() => Promise.resolve()),
}));

/**
 * Session de test qui place d'office un compte connecte.
 *
 * Le middleware est construit une seule fois : en creer un par requete
 * donnerait un magasin neuf a chaque appel, donc une session vide, donc un
 * jeton anti-falsification qui ne correspondrait jamais.
 */
function connectedSession(userId: string | undefined): RequestHandler {
  const base = createTestSession();
  return (req, res, next) => {
    base(req, res, () => {
      if (userId !== undefined) req.session.userId = userId;
      next();
    });
  };
}

async function buildApp(userId: string | undefined): Promise<Express> {
  const { createApp } = await import('../app.js');
  return createApp({ logger: silent, session: connectedSession(userId) });
}

/**
 * Agent qui porte deja le cookie de session et le jeton anti-falsification :
 * sans lui, chaque ecriture tomberait sur le 403 du CSRF avant d'atteindre la
 * regle qu'on veut verifier.
 */
async function connectedAgent(app: Express) {
  const agent = request.agent(app);
  const first = await agent.get('/api/auth/me');
  const cookies = first.headers['set-cookie'] as unknown as string[];
  const token =
    cookies
      .find((cookie) => cookie.startsWith('mailfind.csrf='))
      ?.split(';')[0]
      ?.split('=')[1] ?? '';

  return { agent, token };
}

async function postTerms(app: Express, body: Record<string, unknown>) {
  const { agent, token } = await connectedAgent(app);
  return agent.post('/api/auth/terms').set('x-csrf-token', token).send(body);
}

beforeEach(async () => {
  const repository = await import('../users/repository.js');
  vi.mocked(repository.findUserById).mockResolvedValue(utilisateur);
  vi.mocked(repository.acceptTerms).mockResolvedValue({
    ...utilisateur,
    termsVersion: '2026-09-23',
    termsAcceptedAt: new Date(),
  });
});

describe('POST /api/auth/terms', () => {
  it('refuse un visiteur non connecte', async () => {
    const app = await buildApp(undefined);
    const response = await postTerms(app, { version: '2026-09-23' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('enregistre la version acceptee', async () => {
    const app = await buildApp(utilisateur.id);
    const repository = await import('../users/repository.js');

    const response = await postTerms(app, { version: '2026-09-23' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ termsAccepted: true });
    expect(vi.mocked(repository.acceptTerms)).toHaveBeenCalledWith(utilisateur.id, '2026-09-23');
  });

  it('refuse une version que le serveur ne sert plus', async () => {
    const app = await buildApp(utilisateur.id);
    const response = await postTerms(app, { version: '2020-01-01' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'terms_version_unknown' });
  });

  it('refuse un corps sans version', async () => {
    const app = await buildApp(utilisateur.id);
    const response = await postTerms(app, {});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'invalid_body' });
  });
});

describe('GET /api/auth/me', () => {
  it("dit que les conditions ne sont pas acceptees tant qu'elles ne le sont pas", async () => {
    const app = await buildApp(utilisateur.id);
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      termsAccepted: false,
      termsVersion: null,
    });
  });
});

describe('requireAcceptedTerms', () => {
  it('bloque tant que les conditions en vigueur ne sont pas acceptees', async () => {
    const { requireAcceptedTerms } = await import('../http/middleware/require-terms.js');
    const { AppError } = await import('../http/problem.js');

    const calls: unknown[] = [];
    requireAcceptedTerms({ currentUser: utilisateur } as never, {} as never, (error?: unknown) =>
      calls.push(error),
    );

    expect(calls[0]).toBeInstanceOf(AppError);
    expect(calls[0]).toMatchObject({ code: 'terms_not_accepted', status: 403 });
  });

  it('laisse passer quand la version en vigueur est acceptee', async () => {
    const { requireAcceptedTerms } = await import('../http/middleware/require-terms.js');
    const { CURRENT_TERMS_VERSION } = await import('./routes.js');

    const calls: unknown[] = [];
    requireAcceptedTerms(
      { currentUser: { ...utilisateur, termsVersion: CURRENT_TERMS_VERSION } } as never,
      {} as never,
      (error?: unknown) => calls.push(error),
    );

    expect(calls[0]).toBeUndefined();
  });
});
