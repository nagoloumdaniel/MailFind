import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createCipher } from '../security/crypto.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createCampaignMailerClient } from './client.js';
import { saveConnection } from './connection.js';
import { createPush, findPush, runPush } from './push.js';

/**
 * L'envoi vers Campaign Mailer contre un faux Campaign Mailer qui tient son
 * contrat (`POST /api/v1/campaigns`, `POST /api/v1/campaigns/:id/contacts`) :
 * jeton exige, Idempotency-Key exigee, reponse rejouee pour une cle deja vue,
 * 422 pour la meme cle et un autre corps, doublons d'adresses ecartes.
 */

const CHIFFREUR = createCipher(randomBytes(32).toString('hex'));
const JETON = `cm_${'k'.repeat(43)}`;

interface FauxContact {
  email: string;
  verification_status?: string;
  verified_at?: string;
  source_url?: string;
}

const faux = {
  campagnes: new Map<string, { name: string; status: string; emails: Map<string, FauxContact> }>(),
  cles: new Map<string, { hash: string; corps: unknown }>(),
  appels: [] as { chemin: string; cle: string }[],
  /** Traite le prochain lot puis coupe la connexion : la reponse est perdue. */
  perdreProchaineReponse: false,
  jetonValide: JETON,
};

let serveur: Server;
let base: string;
let userId: string;

function importer(id: string, contacts: FauxContact[]) {
  const campagne = faux.campagnes.get(id);
  if (!campagne) throw new Error('campagne absente');
  let imported = 0;
  const rejected: { line: number; email: string; reason: string }[] = [];
  contacts.forEach((c, i) => {
    if (campagne.emails.has(c.email)) {
      rejected.push({ line: i + 1, email: c.email, reason: 'already_imported' });
      return;
    }
    campagne.emails.set(c.email, c);
    imported += 1;
  });
  return {
    campaign: {
      id,
      name: campagne.name,
      type: 'autre',
      status: campagne.status,
      url: `https://cm.test/campaigns/${id}`,
    },
    report: { read: contacts.length, imported, rejected },
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/v1', (req, res, next) => {
    if (req.get('authorization') !== `Bearer ${faux.jetonValide}`) {
      res.status(401).json({ error: 'Invalid integration token', code: 'invalid_token' });
      return;
    }
    const cle = req.get('idempotency-key');
    if (!cle) {
      res.status(400).json({ error: 'Idempotency-Key required', code: 'idempotency_key_required' });
      return;
    }
    faux.appels.push({ chemin: req.path, cle });
    const hash = createHash('sha256')
      .update(`${req.path}${JSON.stringify(req.body)}`)
      .digest('hex');
    const connue = faux.cles.get(cle);
    if (connue) {
      if (connue.hash !== hash) {
        res.status(422).json({ error: 'reused', code: 'idempotency_key_reused' });
        return;
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(201).json(connue.corps);
      return;
    }
    res.locals.garder = (corps: unknown) => faux.cles.set(cle, { hash, corps });
    next();
  });
  const repondre = (res: express.Response, corps: unknown) => {
    (res.locals.garder as (c: unknown) => void)(corps);
    if (faux.perdreProchaineReponse) {
      faux.perdreProchaineReponse = false;
      res.socket?.destroy();
      return;
    }
    res.status(201).json(corps);
  };
  app.post('/api/v1/campaigns', (req, res) => {
    const id = `camp-${String(faux.campagnes.size + 1)}`;
    const body = req.body as { name: string; contacts: FauxContact[] };
    faux.campagnes.set(id, { name: body.name, status: 'draft', emails: new Map() });
    repondre(res, importer(id, body.contacts));
  });
  app.post('/api/v1/campaigns/:id/contacts', (req, res) => {
    const campagne = faux.campagnes.get(req.params.id);
    if (!campagne) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    if (campagne.status !== 'draft') {
      res.status(409).json({ error: 'not editable', code: 'campaign_not_editable' });
      return;
    }
    repondre(res, importer(req.params.id, (req.body as { contacts: FauxContact[] }).contacts));
  });
  await new Promise<void>((resolve) => {
    serveur = app.listen(0, () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
  await closePool();
});

beforeEach(async () => {
  await resetData();
  await query('truncate campaign_mailer_pushes');
  faux.campagnes.clear();
  faux.cles.clear();
  faux.appels.length = 0;
  faux.perdreProchaineReponse = false;
  faux.jetonValide = JETON;
  userId = await createUser();
  await saveConnection(userId, JETON, CHIFFREUR);
});

/** `n` adresses d'une entreprise, chacune avec sa source, en une instruction. */
async function adresses(n: number, champs: { status?: string; verifiedAt?: string } = {}) {
  const entreprise = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain, domain_status)
     values ($1, 'Acme', 'acme', 'acme.fr', 'provided') returning id`,
    [userId],
  );
  await query(
    `with e as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                           origin, status, last_verified_at)
       select $1, $2, 'contact' || g || '@acme.fr', 'contact' || g || '@acme.fr', 'contact' || g,
              'generic', 'found', $4::email_status, $5::timestamptz
         from generate_series(1, $3::int) g
       returning id
     )
     insert into email_sources (email_id, kind, url, extraction_method)
     select id, 'website', 'https://acme.fr/contact', 'mailto' from e`,
    [
      entreprise.rows[0]?.id,
      userId,
      n,
      champs.status ?? 'valid',
      champs.verifiedAt ?? '2026-09-29T10:00:00Z',
    ],
  );
}

const client = () => ({
  client: (token: string) => createCampaignMailerClient({ baseUrl: base, token }),
});

async function lancer(statuses: 'valid' | 'valid_accept_all' | 'all' = 'valid_accept_all') {
  return createPush(
    userId,
    { campaignName: 'Alternance 2027', scope: { kind: 'library' }, statuses },
    () => Promise.resolve(),
  );
}

describe('envoi vers Campaign Mailer (F-1202 a F-1209)', () => {
  it('cree un brouillon puis ajoute les lots suivants, 500 adresses par lot', async () => {
    await adresses(1100);
    const envoi = await lancer();
    await runPush(envoi.id, { cipher: CHIFFREUR, ...client(), finalAttempt: false });

    const fini = await findPush(userId, envoi.id);
    expect(fini).toMatchObject({
      status: 'done',
      campaignId: 'camp-1',
      batchesTotal: 3,
      batchesDone: 3,
      sent: 1100,
      imported: 1100,
    });
    expect(faux.appels.map((a) => a.chemin)).toEqual([
      '/campaigns',
      '/campaigns/camp-1/contacts',
      '/campaigns/camp-1/contacts',
    ]);
    expect(faux.campagnes.get('camp-1')?.emails.size).toBe(1100);
  });

  it('ne cree aucun doublon quand une reponse est perdue et l envoi relance (A7)', async () => {
    await adresses(1100);
    const envoi = await lancer();
    // Le deuxieme lot est importe par Campaign Mailer, mais sa reponse se perd.
    let rang = 0;
    const perdre = {
      client: (token: string) => {
        const vrai = createCampaignMailerClient({ baseUrl: base, token });
        return {
          createDraft: (...args: Parameters<typeof vrai.createDraft>) => vrai.createDraft(...args),
          addContacts: (id: string, lot: Parameters<typeof vrai.addContacts>[1], cle: string) => {
            rang += 1;
            if (rang === 1) faux.perdreProchaineReponse = true;
            return vrai.addContacts(id, lot, cle);
          },
        };
      },
    };
    await expect(
      runPush(envoi.id, { cipher: CHIFFREUR, ...perdre, finalAttempt: false }),
    ).rejects.toThrow(/injoignable/);
    expect(await findPush(userId, envoi.id)).toMatchObject({ status: 'running', batchesDone: 1 });

    // La file relance : le lot 1 repart sous la meme cle et Campaign Mailer rejoue.
    await runPush(envoi.id, { cipher: CHIFFREUR, ...client(), finalAttempt: false });
    expect(await findPush(userId, envoi.id)).toMatchObject({ status: 'done', imported: 1100 });
    expect(faux.campagnes.size).toBe(1);
    expect(faux.campagnes.get('camp-1')?.emails.size).toBe(1100);
    const cles = faux.appels.map((a) => a.cle);
    expect(cles.filter((c) => c === `mailfind-${envoi.id}-1`)).toHaveLength(2);
  });

  it('transmet la source et la verification, jamais une verification sans date', async () => {
    await adresses(2, { status: 'valid', verifiedAt: '2026-09-29T10:00:00Z' });
    await query(`
      update emails set address = 'rh@acme.fr', normalized_address = 'rh@acme.fr'
       where address = 'contact1@acme.fr'`);
    await query(`
      update emails set address = 'jobs@acme.fr', normalized_address = 'jobs@acme.fr',
                        status = 'unverified', last_verified_at = null
       where address = 'contact2@acme.fr'`);
    const envoi = await lancer('all');
    await runPush(envoi.id, { cipher: CHIFFREUR, ...client(), finalAttempt: false });
    const recus = faux.campagnes.get('camp-1')?.emails;
    expect(recus?.get('rh@acme.fr')).toMatchObject({
      source_url: 'https://acme.fr/contact',
      verification_status: 'valid',
      verified_at: '2026-09-29T10:00:00.000Z',
    });
    expect(recus?.get('jobs@acme.fr')).toMatchObject({ verification_status: 'unverified' });
    expect(recus?.get('jobs@acme.fr')).not.toHaveProperty('verified_at');
  });

  it('s arrete et le dit quand le jeton est refuse, sans relancer', async () => {
    await adresses(3);
    faux.jetonValide = `cm_${'x'.repeat(43)}`;
    const envoi = await lancer();
    await runPush(envoi.id, { cipher: CHIFFREUR, ...client(), finalAttempt: false });
    expect(await findPush(userId, envoi.id)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Jeton Campaign Mailer refuse/),
    });
  });

  it('s arrete quand la campagne a ete lancee dans Campaign Mailer entre deux lots', async () => {
    await adresses(600);
    const envoi = await lancer();
    const lancerEntreDeux = {
      client: (token: string) => {
        const vrai = createCampaignMailerClient({ baseUrl: base, token });
        return {
          createDraft: async (...args: Parameters<typeof vrai.createDraft>) => {
            const rapport = await vrai.createDraft(...args);
            const campagne = faux.campagnes.get(rapport.campaign.id);
            if (campagne) campagne.status = 'running';
            return rapport;
          },
          addContacts: (...args: Parameters<typeof vrai.addContacts>) => vrai.addContacts(...args),
        };
      },
    };
    await runPush(envoi.id, { cipher: CHIFFREUR, ...lancerEntreDeux, finalAttempt: false });
    expect(await findPush(userId, envoi.id)).toMatchObject({
      status: 'failed',
      batchesDone: 1,
      error: expect.stringMatching(/lancee/),
    });
  });

  it('refuse un envoi sans connexion ou sans adresse a envoyer', async () => {
    await expect(lancer()).rejects.toMatchObject({ code: 'nothing_to_push' });
    await query('delete from campaign_mailer_connections');
    await adresses(1);
    await expect(lancer()).rejects.toMatchObject({ code: 'campaign_mailer_not_connected' });
  });
});
