import type { CrawlerClient } from '../crawler/client.js';
import { crawlCompany, type CrawlReport } from '../crawler/engine.js';
import { getPool, query } from '../db/pool.js';
import { readStoredSettings } from '../imports/settings.js';
import { getLogger } from '../observability/logger.js';
import type { CompanyJob } from '../queue/queues.js';
import { completeImportIfDone, finishStep, isImportCancelled, startStep } from './steps.js';

/**
 * Etape `company.crawl` (section 8.4) : explorer le site, puis enregistrer
 * adresses et sources en une seule transaction.
 *
 * Rejouer l'etape n'ajoute rien : une adresse existe une fois par entreprise,
 * et une source revue sur la meme page de la meme facon est la meme source.
 */

export interface CrawlDeps {
  readonly crawler: CrawlerClient;
}

/**
 * Une entreprise exploree depuis moins d'une semaine ne l'est pas a nouveau :
 * un second import qui la contient n'a pas a refaire les memes requetes sur
 * le meme site (F-414).
 */
const FRAICHEUR_JOURS = 7;

export async function saveCrawlReport(
  companyId: string,
  userId: string,
  report: CrawlReport,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('begin');

    for (const trouvee of report.addresses) {
      const locale = trouvee.address.split('@')[0] ?? '';
      const email = await client.query<{ id: string }>(
        `insert into emails (company_id, user_id, address, normalized_address, local_part, origin)
         values ($1, $2, $3, $4, $5, 'found')
         on conflict on constraint emails_unique_per_company
         do update set updated_at = now()
         returning id`,
        [companyId, userId, trouvee.address, trouvee.normalized, locale],
      );
      // L'adresse et sa source dans la meme transaction : la base refuse
      // l'une sans l'autre.
      await client.query(
        `insert into email_sources (email_id, kind, url, extraction_method, context_excerpt)
         values ($1, 'website', $2, $3::extraction_method, $4)
         on conflict do nothing`,
        [email.rows[0]?.id, trouvee.pageUrl, trouvee.method, trouvee.excerpt.slice(0, 200)],
      );
    }

    await client.query(
      `update companies
          set crawl_status = 'done',
              crawled_at = now(),
              crawl_notes = $2::crawl_note[],
              crawl_error = null,
              contact_form_url = coalesce(contact_form_url, $3),
              careers_url = coalesce(careers_url, $4),
              phone = coalesce(phone, $5),
              linkedin_url = coalesce(linkedin_url, $6),
              updated_at = now()
        where id = $1`,
      [
        companyId,
        report.notes,
        report.contactFormUrl ?? null,
        report.careersUrl ?? null,
        report.phone ?? null,
        report.linkedinUrl ?? null,
      ],
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

interface CompanyRow {
  domain: string | null;
  website_url: string | null;
  careers_url: string | null;
  crawl_status: string;
  recent: boolean;
  settings: unknown;
}

export async function crawlStep(deps: CrawlDeps, job: CompanyJob): Promise<void> {
  const logger = getLogger().child({ step: 'company.crawl', companyId: job.companyId });

  if (await isImportCancelled(job.importId)) {
    await finishStep('crawl', job, 'skipped');
    return;
  }

  const lu = await query<CompanyRow>(
    `select c.domain, c.website_url, c.careers_url, c.crawl_status::text as crawl_status,
            (c.crawled_at is not null
             and c.crawled_at > now() - make_interval(days => $4)) as recent,
            i.settings
       from companies c
       join imports i on i.id = $2 and i.user_id = c.user_id
      where c.id = $1 and c.user_id = $3`,
    [job.companyId, job.importId, job.userId, FRAICHEUR_JOURS],
  );
  const entreprise = lu.rows[0];

  // Sans domaine, ou exploree depuis peu : rien a faire ici.
  if (entreprise?.domain == null || (entreprise.recent && entreprise.crawl_status === 'done')) {
    await finishStep('crawl', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  await startStep('crawl', job);
  await query(`update companies set crawl_status = 'running' where id = $1`, [job.companyId]);

  const reglages = readStoredSettings(entreprise.settings);
  const rapport = await crawlCompany(deps.crawler, {
    domain: entreprise.domain,
    depth: reglages.depth,
    ...(entreprise.website_url === null ? {} : { websiteUrl: entreprise.website_url }),
    ...(entreprise.careers_url === null ? {} : { careersUrl: entreprise.careers_url }),
  });

  await saveCrawlReport(job.companyId, job.userId, rapport);
  await finishStep('crawl', job, 'done');
  await completeImportIfDone(job.importId);

  logger.info(
    { pages: rapport.pages.length, adresses: rapport.addresses.length, notes: rapport.notes },
    'collecte terminee',
  );
}

/**
 * Quand la file renonce a une etape : elle est notee en echec avec son motif,
 * l'entreprise aussi, et l'import peut se terminer sans elle.
 */
export async function failStep(
  step: 'identify' | 'crawl',
  job: CompanyJob,
  motif: string,
): Promise<void> {
  await finishStep(step, job, 'failed', motif);
  if (step === 'identify') await finishStep('crawl', job, 'skipped');
  await query(
    `update companies set crawl_status = 'failed', crawl_error = $2, updated_at = now()
      where id = $1`,
    [job.companyId, motif],
  );
  await completeImportIfDone(job.importId);
}
