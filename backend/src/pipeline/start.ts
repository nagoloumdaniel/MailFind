import { query } from '../db/pool.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import { completeImportIfDone, planStep } from './steps.js';

export type Enqueue = (step: CompanyStep, job: CompanyJob) => Promise<void>;

/**
 * Apres la planification : une etape d'identification par entreprise de
 * l'import, nouvelle ou deja connue (section 8.4). Rejouable : les etapes
 * deja declarees ne le sont pas deux fois, et l'identifiant stable des taches
 * empeche une double mise en file.
 */
export async function startPipeline(
  importId: string,
  userId: string,
  enqueue: Enqueue,
): Promise<number> {
  const entreprises = await query<{ company_id: string }>(
    `select distinct r.company_id
       from import_rows r
       join imports i on i.id = r.import_id
      where r.import_id = $1 and i.user_id = $2 and i.status = 'running'
        and r.company_id is not null`,
    [importId, userId],
  );

  for (const { company_id: companyId } of entreprises.rows) {
    const job = { importId, companyId, userId };
    await planStep('identify', job);
    await enqueue('identify', job);
  }

  // Un import dont aucune ligne n'a donne d'entreprise est termine tout de suite.
  await completeImportIfDone(importId);
  return entreprises.rows.length;
}
