import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool, query } from './pool.js';
import { createUser, resetData } from '../test/integration/db.js';

/**
 * Ce que la base garantit d'elle-meme, quel que soit le code qui lui parle.
 * La regle « chaque adresse a une source » est la premiere : elle est non
 * negociable, donc elle ne depend pas de la discipline d'un module.
 */

let userId: string;
let companyId: string;

beforeEach(async () => {
  await resetData();
  userId = await createUser();
  const cree = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain)
     values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
    [userId],
  );
  companyId = cree.rows[0]?.id ?? '';
});

afterAll(async () => {
  await closePool();
});

async function transaction<T>(travail: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const resultat = await travail(client);
    await client.query('commit');
    return resultat;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insererAdresse(client: pg.PoolClient, adresse = 'contact@acme.fr'): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into emails (company_id, user_id, address, normalized_address, local_part, origin)
     values ($1, $2, $3, lower($3), split_part($3, '@', 1), 'found') returning id`,
    [companyId, userId, adresse],
  );
  return result.rows[0]?.id ?? '';
}

async function insererSource(
  client: pg.PoolClient,
  emailId: string,
  url = 'https://acme.fr/contact',
) {
  await client.query(
    `insert into email_sources (email_id, kind, url, extraction_method, context_excerpt)
     values ($1, 'website', $2, 'mailto', 'Ecrivez-nous')`,
    [emailId, url],
  );
}

describe('chaque adresse a une source', () => {
  it('refuse d enregistrer une adresse sans source', async () => {
    await expect(transaction((client) => insererAdresse(client))).rejects.toThrow(/sans source/);
    const reste = await query<{ n: number }>('select count(*)::int as n from emails');
    expect(reste.rows[0]?.n).toBe(0);
  });

  it('enregistre une adresse avec sa source, statut non verifie par defaut', async () => {
    await transaction(async (client) => {
      const id = await insererAdresse(client);
      await insererSource(client, id);
    });
    const lue = await query<{ status: string; type: string }>(
      'select status::text as status, type::text as type from emails',
    );
    expect(lue.rows[0]).toEqual({ status: 'unverified', type: 'unknown' });
  });

  it('refuse de retirer la derniere source d une adresse', async () => {
    const id = await transaction(async (client) => {
      const cree = await insererAdresse(client);
      await insererSource(client, cree);
      return cree;
    });

    await expect(
      transaction((client) => client.query('delete from email_sources where email_id = $1', [id])),
    ).rejects.toThrow(/sans source/);
  });

  it('laisse retirer une source quand il en reste une autre', async () => {
    const id = await transaction(async (client) => {
      const cree = await insererAdresse(client);
      await insererSource(client, cree, 'https://acme.fr/contact');
      await insererSource(client, cree, 'https://acme.fr/mentions-legales');
      return cree;
    });

    await transaction((client) =>
      client.query(`delete from email_sources where email_id = $1 and url like '%contact'`, [id]),
    );
  });

  it('laisse supprimer une adresse avec ses sources, et une entreprise avec ses adresses', async () => {
    await transaction(async (client) => {
      const id = await insererAdresse(client);
      await insererSource(client, id);
    });
    await query('delete from companies where id = $1', [companyId]);
    const reste = await query<{ n: number }>('select count(*)::int as n from email_sources');
    expect(reste.rows[0]?.n).toBe(0);
  });

  it('exige l URL et la methode d une source web (F-411)', async () => {
    await expect(
      transaction(async (client) => {
        const id = await insererAdresse(client);
        await client.query(`insert into email_sources (email_id, kind) values ($1, 'website')`, [
          id,
        ]);
      }),
    ).rejects.toThrow(/email_sources_website_complete/);
  });
});

describe('unicite', () => {
  it('garde une adresse une seule fois par entreprise', async () => {
    await transaction(async (client) => {
      const id = await insererAdresse(client, 'contact@acme.fr');
      await insererSource(client, id);
    });
    await expect(
      transaction(async (client) => {
        const id = await insererAdresse(client, 'Contact@Acme.fr');
        await insererSource(client, id);
      }),
    ).rejects.toThrow(/emails_unique_per_company/);
  });

  it('ne duplique pas une source revue sur la meme page', async () => {
    await expect(
      transaction(async (client) => {
        const id = await insererAdresse(client);
        await insererSource(client, id);
        await insererSource(client, id);
      }),
    ).rejects.toThrow(/email_sources_unique_idx/);
  });

  it('ne garde qu une etape par entreprise et par import, meme hors import', async () => {
    await query(`insert into pipeline_jobs (company_id, step) values ($1, 'crawl')`, [companyId]);
    await expect(
      query(`insert into pipeline_jobs (company_id, step) values ($1, 'crawl')`, [companyId]),
    ).rejects.toThrow(/pipeline_jobs_unique_step/);
  });
});
