import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import { blockOnQuota, takeQuotaBlockedSteps } from '../pipeline/steps.js';
import { createUser, resetData } from '../test/integration/db.js';
import { missingQuota, resumeBlocked, resumeBlockedForEveryone } from './resume.js';
import { claimQuota, quotaLimits, quotaReport, readUsage, releaseQuota } from './usage.js';

let userId: string;

beforeEach(async () => {
  await resetData();
  await query('delete from quota_usage');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

/** Remplit un compteur jusqu'a son plafond, sans passer par le pipeline. */
async function remplir(metric: 'companies' | 'pages' | 'exports'): Promise<void> {
  await query(
    `insert into quota_usage (user_id, period, metric, used)
     values ($1, date_trunc('month', now() at time zone 'utc')::date, $2::quota_metric, $3)
     on conflict (user_id, period, metric) do update set used = excluded.used`,
    [userId, metric, quotaLimits()[metric]],
  );
}

/** Un import en cours, avec une entreprise et son etape d'identification. */
async function importAvecEtape(): Promise<CompanyJob> {
  const importe = await query<{ id: string }>(
    `insert into imports (user_id, filename, status, total_rows)
     values ($1, 'liste.csv', 'running', 1) returning id`,
    [userId],
  );
  const entreprise = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name)
     values ($1, 'Acme', 'acme') returning id`,
    [userId],
  );
  const job = {
    importId: importe.rows[0]?.id ?? '',
    companyId: entreprise.rows[0]?.id ?? '',
    userId,
  };
  await query(
    `insert into pipeline_jobs (import_id, company_id, step) values ($1, $2, 'identify')`,
    [job.importId, job.companyId],
  );
  return job;
}

describe('quotas par utilisateur et par mois (F-1401)', () => {
  it('prend une place, la rend, et compte juste', async () => {
    const limite = quotaLimits().companies;

    const premiere = await claimQuota(userId, 'companies');
    expect(premiere).toEqual({ granted: true, remaining: limite - 1, limit: limite });
    expect((await readUsage(userId)).companies).toBe(1);

    await releaseQuota(userId, 'companies');
    expect((await readUsage(userId)).companies).toBe(0);
  });

  it('refuse au plafond, sans rien prendre au passage', async () => {
    await remplir('exports');

    const refus = await claimQuota(userId, 'exports');

    expect(refus.granted).toBe(false);
    expect(refus.remaining).toBe(0);
    expect((await readUsage(userId)).exports).toBe(quotaLimits().exports);
  });

  it('prend tout ou rien : une demande qui depasse ne consomme pas', async () => {
    const limite = quotaLimits().pages;
    await claimQuota(userId, 'pages', limite - 1);

    const refus = await claimQuota(userId, 'pages', 5);

    expect(refus.granted).toBe(false);
    expect((await readUsage(userId)).pages).toBe(limite - 1);
  });

  it('ne prend pas deux fois la derniere place, meme en simultane', async () => {
    const limite = quotaLimits().exports;
    await claimQuota(userId, 'exports', limite - 1);

    const issues = await Promise.all([
      claimQuota(userId, 'exports'),
      claimQuota(userId, 'exports'),
      claimQuota(userId, 'exports'),
    ]);

    expect(issues.filter((i) => i.granted)).toHaveLength(1);
    expect((await readUsage(userId)).exports).toBe(limite);
  });

  it('rend les trois compteurs avec leur plafond, zero compris (F-1404)', async () => {
    await claimQuota(userId, 'companies', 2);

    const rapport = await quotaReport(userId);

    expect(rapport).toContainEqual({
      metric: 'companies',
      used: 2,
      limit: quotaLimits().companies,
      remaining: quotaLimits().companies - 2,
    });
    expect(rapport.map((l) => l.metric).sort()).toEqual(['companies', 'exports', 'pages']);
  });

  it('separe les comptes : le plafond de l un ne touche pas l autre', async () => {
    const autre = await createUser();
    await remplir('companies');

    expect((await claimQuota(userId, 'companies')).granted).toBe(false);
    expect((await claimQuota(autre, 'companies')).granted).toBe(true);
  });
});

describe('arret propre et reprise (F-1403)', () => {
  it('met l etape en attente, conclut l import sans le dire termine', async () => {
    const job = await importAvecEtape();

    await blockOnQuota('identify', job, 'companies');

    const etape = await query<{ status: string; error: string }>(
      `select status::text as status, error from pipeline_jobs where company_id = $1`,
      [job.companyId],
    );
    expect(etape.rows[0]).toMatchObject({ status: 'quota_blocked', error: 'quota companies' });
    const importe = await query<{ status: string }>(
      'select status::text as status from imports where id = $1',
      [job.importId],
    );
    expect(importe.rows[0]?.status).toBe('quota_blocked');
  });

  it('refuse de reprendre tant que le compteur est plein', async () => {
    const job = await importAvecEtape();
    await blockOnQuota('identify', job, 'companies');
    await remplir('companies');
    const enFile: CompanyStep[] = [];

    const issue = await resumeBlocked(userId, (step) => {
      enFile.push(step);
      return Promise.resolve();
    });

    expect(issue).toEqual({ resumed: 0, blockedBy: 'companies' });
    expect(enFile).toEqual([]);
  });

  it('remet en file et remet l import en cours quand la place revient', async () => {
    const job = await importAvecEtape();
    await blockOnQuota('identify', job, 'companies');
    const enFile: { step: CompanyStep; companyId: string }[] = [];

    const issue = await resumeBlocked(userId, (step, enCours) => {
      enFile.push({ step, companyId: enCours.companyId });
      return Promise.resolve();
    });

    expect(issue).toEqual({ resumed: 1 });
    expect(enFile).toEqual([{ step: 'identify', companyId: job.companyId }]);
    const importe = await query<{ status: string; completed_at: string | null }>(
      'select status::text as status, completed_at from imports where id = $1',
      [job.importId],
    );
    expect(importe.rows[0]).toMatchObject({ status: 'running', completed_at: null });
  });

  it('ne rend la meme etape qu une fois, meme a deux relances simultanees', async () => {
    const job = await importAvecEtape();
    await blockOnQuota('identify', job, 'companies');

    const [premiere, seconde] = await Promise.all([
      takeQuotaBlockedSteps(userId),
      takeQuotaBlockedSteps(userId),
    ]);

    expect((premiere?.length ?? 0) + (seconde?.length ?? 0)).toBe(1);
  });

  it('reprend tout le monde a l entretien, et saute les comptes encore pleins', async () => {
    const job = await importAvecEtape();
    await blockOnQuota('identify', job, 'companies');

    // Un second compte, bloque lui aussi, mais dont le compteur reste plein :
    // l'entretien doit reprendre le premier sans se bloquer sur le second.
    const premier = userId;
    userId = await createUser();
    const autre = await importAvecEtape();
    await blockOnQuota('identify', autre, 'companies');
    await remplir('companies');
    const bloque = userId;
    userId = premier;

    const enFile: string[] = [];
    const repris = await resumeBlockedForEveryone((_step, job2) => {
      enFile.push(job2.userId);
      return Promise.resolve();
    });

    expect(repris).toBe(1);
    expect(enFile).toEqual([premier]);
    const restees = await query<{ n: string }>(
      `select count(*)::text as n from pipeline_jobs p
         join imports i on i.id = p.import_id
        where p.status = 'quota_blocked' and i.user_id = $1`,
      [bloque],
    );
    expect(restees.rows[0]?.n).toBe('1');
  });

  it('dit quel compteur manque, et rien quand la place est la', () => {
    const plafonds = { companies: 10, pages: 100, exports: 5 };

    expect(missingQuota({ companies: 10, pages: 0, exports: 0 }, plafonds)).toBe('companies');
    expect(missingQuota({ companies: 0, pages: 100, exports: 0 }, plafonds)).toBe('pages');
    // Un export de plus n'empeche pas une entreprise d'etre traitee.
    expect(missingQuota({ companies: 0, pages: 0, exports: 5 }, plafonds)).toBeUndefined();
  });
});
