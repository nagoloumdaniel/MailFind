import request from 'supertest';
import { pino } from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const silent = pino({ level: 'silent' });

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const { createTestSession } = await import('../test/session.js');
  app = createApp({ logger: silent, session: createTestSession() });
});

describe('GET /api/auth/google', () => {
  it('envoie vers Google', async () => {
    const response = await request(app).get('/api/auth/google');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('ne demande que les portees openid, email et profile (F-101)', async () => {
    const response = await request(app).get('/api/auth/google');
    const scope = new URL(response.headers.location!).searchParams.get('scope') ?? '';

    expect(scope.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
  });

  it("ne demande jamais d'acces a la messagerie", async () => {
    const response = await request(app).get('/api/auth/google');
    const location = response.headers.location!;

    expect(location).not.toContain('gmail');
    expect(location).not.toContain('mail.google.com');
  });

  it('protege la redirection par un jeton d etat', async () => {
    const response = await request(app).get('/api/auth/google');
    const state = new URL(response.headers.location!).searchParams.get('state');

    expect(state).toBeTruthy();
  });
});

describe('GET /api/auth/me', () => {
  it('repond que personne n est connecte, sans erreur', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });
});

describe('protection CSRF (S-09)', () => {
  it('depose un jeton lisible par l application', async () => {
    const response = await request(app).get('/api/auth/me');
    const cookies = response.headers['set-cookie'] as unknown as string[];

    expect(cookies.some((cookie) => cookie.startsWith('mailfind.csrf='))).toBe(true);
  });

  it('refuse une requete d ecriture sans jeton', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'csrf_token_invalid' });
  });

  it('refuse une requete d ecriture avec un mauvais jeton', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/me');

    const response = await agent.post('/api/auth/logout').set('x-csrf-token', 'jeton-invente');

    expect(response.status).toBe(403);
  });

  it('accepte une requete d ecriture avec le jeton de la session', async () => {
    const agent = request.agent(app);
    const first = await agent.get('/api/auth/me');
    const cookies = first.headers['set-cookie'] as unknown as string[];
    const token = cookies
      .find((cookie) => cookie.startsWith('mailfind.csrf='))
      ?.split(';')[0]
      ?.split('=')[1];

    expect(token).toBeTruthy();

    const response = await agent.post('/api/auth/logout').set('x-csrf-token', token ?? '');

    expect(response.status).toBe(204);
  });
});
