import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createTestSession } from '../test/session.js';
import { isDomainExcluded, normalizeDomain, requestExclusion } from './exclusions.js';

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp({ logger: pino({ level: 'silent' }), session: createTestSession() });
});

beforeEach(async () => {
  await query('delete from excluded_domains');
});

afterAll(async () => {
  await closePool();
});

describe('retrait des sites (R-07, F-1603)', () => {
  it('ramene un domaine a sa forme comparable', () => {
    expect(normalizeDomain('  HTTPS://WWW.Acme.FR/contact  ')).toBe('acme.fr');
    expect(normalizeDomain('acme.fr.')).toBe('acme.fr');
    expect(normalizeDomain('acme.fr:8443')).toBe('acme.fr');
  });

  it('exclut le domaine et ses sous-domaines, pas un domaine qui lui ressemble', async () => {
    await requestExclusion('acme.fr');

    expect(await isDomainExcluded('acme.fr')).toBe(true);
    expect(await isDomainExcluded('www.acme.fr')).toBe(true);
    expect(await isDomainExcluded('carrieres.acme.fr')).toBe(true);
    expect(await isDomainExcluded('faux-acme.fr')).toBe(false);
    expect(await isDomainExcluded('acme.fr.exemple.test')).toBe(false);
  });

  it('redevient explorable quand l exploitant refuse la demande', async () => {
    await requestExclusion('acme.fr');
    await query(`update excluded_domains set status = 'rejected' where domain = 'acme.fr'`);

    expect(await isDomainExcluded('acme.fr')).toBe(false);
  });

  it('se rejoue sans effet : deux demandes ne font qu une ligne', async () => {
    expect(await requestExclusion('acme.fr')).toBe('recorded');
    expect(await requestExclusion('WWW.Acme.fr')).toBe('already_known');

    const lignes = await query<{ n: string }>('select count(*)::text as n from excluded_domains');
    expect(lignes.rows[0]?.n).toBe('1');
  });

  it('prend la demande sans session, et l applique tout de suite', async () => {
    const reponse = await request(app)
      .post('/api/bot/exclusion')
      .send({ domain: 'beta.io', reason: 'Nous preferons etre contactes par le formulaire.' });

    expect(reponse.status).toBe(201);
    expect(reponse.body).toMatchObject({ domain: 'beta.io', excluded: true });
    expect(await isDomainExcluded('beta.io')).toBe(true);
  });

  it('refuse ce qui n est pas un domaine, sans rien enregistrer', async () => {
    for (const domain of ['pas un domaine', 'acme', 'http://', '']) {
      const reponse = await request(app).post('/api/bot/exclusion').send({ domain });
      expect(reponse.status).toBe(400);
      expect(reponse.body).toMatchObject({ code: 'invalid_domain' });
    }
    const lignes = await query<{ n: string }>('select count(*)::text as n from excluded_domains');
    expect(lignes.rows[0]?.n).toBe('0');
  });

  it('ne garde rien de personnel de la demande', async () => {
    await request(app)
      .post('/api/bot/exclusion')
      .send({ domain: 'gamma.fr', reason: 'Ecrire a webmestre@gamma.fr' });

    const ligne = await query<{ contenu: string }>(
      `select row_to_json(e)::text as contenu from excluded_domains e where domain = 'gamma.fr'`,
    );
    // Le motif est garde tel quel : la page previent qu'elle ne demande ni nom
    // ni adresse, et c'est le seul champ libre. Rien d'autre n'est stocke.
    expect(Object.keys(JSON.parse(ligne.rows[0]?.contenu ?? '{}')).sort()).toEqual([
      'created_at',
      'domain',
      'reason',
      'reviewed_at',
      'status',
    ]);
  });

  it('dit publiquement ce que fait l agent, sans session', async () => {
    const reponse = await request(app).get('/api/bot');

    expect(reponse.status).toBe(200);
    expect(reponse.body.bot).toMatchObject({ respects_robots_txt: true });
    expect(reponse.body.bot.user_agent).toContain('MailFindBot');
  });
});
