import type { CrawlerClient } from '../crawler/client.js';
import { crawlCompany, type CrawlReport } from '../crawler/engine.js';
import { MAX_PAGES, type CrawlDepth } from '../crawler/pages.js';
import { isDomainExcluded } from '../crawler/exclusions.js';
import { claimQuota, releaseQuota } from '../quotas/usage.js';
import { getPool, query } from '../db/pool.js';
import { readStoredSettings } from '../imports/settings.js';
import { getLogger } from '../observability/logger.js';
import { typeInContext } from '../emails/roles.js';
import { isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import type { Enqueue } from './start.js';
import {
  blockOnQuota,
  completeImportIfDone,
  finishStep,
  isImportCancelled,
  planStep,
  startStep,
} from './steps.js';

/** Ce qu'une profondeur peut demander au plus, accueil compris (F-402). */
const maxPagesForDepth = (depth: CrawlDepth): number => MAX_PAGES[depth];

/**
 * Etape `company.crawl` (section 8.4) : explorer le site, puis enregistrer
 * adresses et sources en une seule transaction.
 *
 * Rejouer l'etape n'ajoute rien : une adresse existe une fois par entreprise,
 * et une source revue sur la meme page de la meme facon est la meme source.
 */

export interface CrawlDeps {
  readonly crawler: CrawlerClient;
  readonly enqueue: Enqueue;
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
  // R-04 : une adresse de la liste de suppression n'est plus jamais collectee.
  const supprimees = await loadSuppressedHashes(userId);
  const client = await getPool().connect();
  try {
    await client.query('begin');

    for (const trouvee of report.addresses) {
      if (isSuppressed(supprimees, trouvee.normalized)) continue;
      const locale = trouvee.address.split('@')[0] ?? '';
      const email = await client.query<{ id: string }>(
        `insert into emails
           (company_id, user_id, address, normalized_address, local_part, type, origin)
         values ($1, $2, $3, $4, $5, $6::email_type, 'found')
         on conflict on constraint emails_unique_per_company
         do update set updated_at = now(),
           -- Vue a nouveau sur la page carrieres, une adresse generique
           -- devient une adresse de recrutement (6.8).
           type = case
             when excluded.type = 'recruitment' and emails.type in ('generic', 'unknown')
               then excluded.type
             else emails.type end
         returning id`,
        [
          companyId,
          userId,
          trouvee.address,
          trouvee.normalized,
          locale,
          typeInContext(locale, trouvee.pageUrl),
        ],
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

  if (entreprise?.domain == null) {
    await finishStep('crawl', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  // R-07 : un site qui a demande a ne pas etre explore ne l'est pour
  // personne. Verifie ici, avant toute requete, et pas seulement dans le
  // robot : c'est une decision de politique, pas une regle de collecte.
  if (await isDomainExcluded(entreprise.domain)) {
    await query(
      `update companies
          set crawl_status = 'skipped',
              crawl_notes = array_append(array_remove(crawl_notes, 'site_excluded'), 'site_excluded'::crawl_note),
              updated_at = now()
        where id = $1`,
      [job.companyId],
    );
    await planStep('enrich', job);
    await finishStep('crawl', job, 'skipped', 'site_excluded');
    await deps.enqueue('enrich', job);
    return;
  }

  // Exploree depuis peu : on ne refait pas les requetes, mais l'entreprise
  // passe quand meme a l'enrichissement, dont les reglages de cet import
  // peuvent differer du precedent.
  if (entreprise.recent && entreprise.crawl_status === 'done') {
    await planStep('enrich', job);
    await finishStep('crawl', job, 'skipped');
    await deps.enqueue('enrich', job);
    return;
  }

  // Les pages se reservent avant d'etre demandees, au plus de ce que la
  // profondeur choisie peut atteindre : un site ne doit pas pouvoir faire
  // depasser le plafond a lui seul (F-1401).
  const reglages = readStoredSettings(entreprise.settings);
  const budgetPages = maxPagesForDepth(reglages.depth);
  const place = await claimQuota(job.userId, 'pages', budgetPages);
  if (!place.granted) {
    await blockOnQuota('crawl', job, 'pages');
    return;
  }

  await startStep('crawl', job);
  await query(`update companies set crawl_status = 'running' where id = $1`, [job.companyId]);

  const rapport = await crawlCompany(deps.crawler, {
    domain: entreprise.domain,
    depth: reglages.depth,
    ...(entreprise.website_url === null ? {} : { websiteUrl: entreprise.website_url }),
    ...(entreprise.careers_url === null ? {} : { careersUrl: entreprise.careers_url }),
  });

  // Rendre ce que le site n'a pas fait consommer : la plupart des sites
  // tiennent en bien moins de pages que la profondeur n'en autorise.
  await releaseQuota(job.userId, 'pages', budgetPages - rapport.pages.length);

  await saveCrawlReport(job.companyId, job.userId, rapport);
  // L'etape suivante est declaree avant de conclure celle-ci : sinon
  // l'import pourrait se croire termine entre les deux.
  await planStep('enrich', job);
  await finishStep('crawl', job, 'done');
  await deps.enqueue('enrich', job);

  logger.info(
    { pages: rapport.pages.length, adresses: rapport.addresses.length, notes: rapport.notes },
    'collecte terminee',
  );
}

/**
 * Quand la file renonce a une etape : elle est notee en echec avec son motif,
 * l'entreprise aussi, et l'import peut se terminer sans elle.
 */
export async function failStep(step: CompanyStep, job: CompanyJob, motif: string): Promise<void> {
  await finishStep(step, job, 'failed', motif);
  if (step === 'identify') await finishStep('crawl', job, 'skipped');
  // Un enrichissement ou une verification en echec laisse intact ce que la
  // collecte a trouve.
  if (step === 'identify' || step === 'crawl') {
    await query(
      `update companies set crawl_status = 'failed', crawl_error = $2, updated_at = now()
        where id = $1`,
      [job.companyId, motif],
    );
  }
  await completeImportIfDone(job.importId);
}
