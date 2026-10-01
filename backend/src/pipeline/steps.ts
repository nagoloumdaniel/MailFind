import { query } from '../db/pool.js';
import { emitWebhookEvent } from '../webhooks/service.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import type { QuotaMetric } from '../quotas/usage.js';

/**
 * Suivi des etapes par entreprise, dans `pipeline_jobs`. C'est lui qui fait
 * la progression affichee, qui dit quand un import est termine, et ce qu'il
 * faut remettre en file apres un redemarrage (F-206).
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'quota_blocked';

/** Declare une etape a faire. Deja declaree, elle ne bouge pas. */
export async function planStep(step: CompanyStep, job: CompanyJob): Promise<void> {
  await query(
    `insert into pipeline_jobs (import_id, company_id, step)
     values ($1, $2, $3)
     on conflict on constraint pipeline_jobs_unique_step do nothing`,
    [job.importId, job.companyId, step],
  );
}

export async function startStep(step: CompanyStep, job: CompanyJob): Promise<void> {
  await query(
    `insert into pipeline_jobs (import_id, company_id, step, status, attempts, started_at)
     values ($1, $2, $3, 'running', 1, now())
     on conflict on constraint pipeline_jobs_unique_step
     do update set status = 'running', attempts = pipeline_jobs.attempts + 1,
                   started_at = now(), error = null`,
    [job.importId, job.companyId, step],
  );
}

export async function finishStep(
  step: CompanyStep,
  job: CompanyJob,
  status: Exclude<StepStatus, 'pending' | 'running'>,
  error?: string,
): Promise<void> {
  await query(
    `insert into pipeline_jobs (import_id, company_id, step, status, error, completed_at)
     values ($1, $2, $3, $4::pipeline_job_status, $5, now())
     on conflict on constraint pipeline_jobs_unique_step
     do update set status = excluded.status, error = excluded.error, completed_at = now()`,
    [job.importId, job.companyId, step, status, error ?? null],
  );
}

/**
 * Arrete une etape sur un quota atteint (F-1403). Ni faite ni en echec :
 * elle attend le renouvellement du mois, ou que l'utilisateur relance. Un
 * echec serait trompeur, puisque rien ne s'est mal passe, et serait retente
 * en vain par la file.
 */
export async function blockOnQuota(
  step: CompanyStep,
  job: CompanyJob,
  metric: QuotaMetric,
): Promise<void> {
  await query(
    `insert into pipeline_jobs (import_id, company_id, step, status, error, completed_at)
     values ($1, $2, $3, 'quota_blocked', $4, now())
     on conflict on constraint pipeline_jobs_unique_step
     do update set status = 'quota_blocked', error = excluded.error, completed_at = now()`,
    [job.importId, job.companyId, step, `quota ${metric}`],
  );
  // L'import peut se conclure : il ne reste rien qui avance tout seul.
  await completeImportIfDone(job.importId);
}

/**
 * Les etapes qu'un quota avait arretees, pour les remettre en file quand le
 * mois a change ou que l'utilisateur relance. Elles repassent « en attente »
 * dans la meme instruction, pour que deux relances simultanees n'en rendent
 * pas deux fois la meme.
 */
export async function takeQuotaBlockedSteps(
  userId: string,
  importId?: string,
): Promise<{ step: CompanyStep; job: CompanyJob }[]> {
  const result = await query<{ step: CompanyStep; import_id: string; company_id: string }>(
    `update pipeline_jobs p
        set status = 'pending', error = null, completed_at = null
       from imports i
      where i.id = p.import_id and i.user_id = $1 and p.status = 'quota_blocked'
        and ($2::uuid is null or p.import_id = $2)
      returning p.step::text as step, p.import_id, p.company_id`,
    [userId, importId ?? null],
  );
  return result.rows.map((row) => ({
    step: row.step,
    job: { importId: row.import_id, companyId: row.company_id, userId },
  }));
}

/** Vrai quand l'import a ete annule : ses etapes restantes ne partent plus (F-205). */
export async function isImportCancelled(importId: string): Promise<boolean> {
  const result = await query<{ status: string }>(
    'select status::text as status from imports where id = $1',
    [importId],
  );
  return result.rows[0]?.status === 'cancelled';
}

/**
 * Passe l'import en « termine » quand plus aucune etape n'attend. La
 * condition est dans la requete elle-meme : deux etapes qui finissent en meme
 * temps ne peuvent pas conclure chacune de leur cote que l'autre tourne
 * encore.
 */
export async function completeImportIfDone(importId: string): Promise<boolean> {
  const result = await query<{ user_id: string; filename: string; status: string }>(
    `update imports
        set status = case
              when exists (
                select 1 from pipeline_jobs
                 where import_id = $1 and status = 'quota_blocked'
              ) then 'quota_blocked'::import_status
              else 'completed'::import_status end,
            completed_at = now()
      where id = $1 and status = 'running'
        and not exists (
          select 1 from pipeline_jobs
           where import_id = $1 and status in ('pending', 'running')
        )
      returning user_id, filename, status::text as status`,
    [importId],
  );
  const termine = result.rows[0];
  // F-1308 : une seule fois, par la mise a jour qui a vraiment conclu. Un
  // import arrete par un quota n'est pas « termine » : l'evenement le dit,
  // pour qu'un abonne ne prenne pas un travail interrompu pour un travail
  // fini.
  if (termine !== undefined) {
    await emitWebhookEvent(termine.user_id, 'import.completed', {
      import_id: importId,
      name: termine.filename,
      status: termine.status,
    });
  }
  return termine !== undefined;
}

/**
 * Les etapes qu'aucune tache ne garantit plus de faire avancer, pour la
 * reprise au demarrage : en attente ou en cours dans un import en cours.
 */
export async function listStepsToResume(): Promise<{ step: CompanyStep; job: CompanyJob }[]> {
  const result = await query<{
    step: CompanyStep;
    import_id: string;
    company_id: string;
    user_id: string;
  }>(
    `select p.step::text as step, p.import_id, p.company_id, i.user_id
       from pipeline_jobs p
       join imports i on i.id = p.import_id
      where i.status = 'running' and p.status in ('pending', 'running')
      order by p.created_at`,
  );
  return result.rows.map((row) => ({
    step: row.step,
    job: { importId: row.import_id, companyId: row.company_id, userId: row.user_id },
  }));
}
