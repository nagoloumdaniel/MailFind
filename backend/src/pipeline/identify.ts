import { normalizeCompanyName } from '../companies/normalize.js';
import {
  CONFIDENCE_THRESHOLD,
  chooseOfficialSite,
  type OfficialSite,
} from '../companies/official-site.js';
import { query } from '../db/pool.js';
import { readStoredSettings } from '../imports/settings.js';
import { getLogger } from '../observability/logger.js';
import { paidCall, type CallLimits } from '../providers/credits.js';
import type {
  LegalIdentity,
  RechercheEntreprisesClient,
} from '../providers/recherche-entreprises.js';
import type { WebSearchProvider } from '../providers/web-search.js';
import type { CompanyJob } from '../queue/queues.js';
import type { Enqueue } from './start.js';
import { claimQuota } from '../quotas/usage.js';
import {
  blockOnQuota,
  completeImportIfDone,
  finishStep,
  isImportCancelled,
  planStep,
  startStep,
} from './steps.js';

/**
 * Etape `company.identify` (section 8.4) : l'identite legale, puis le domaine
 * officiel, puis la suite.
 *
 * Une erreur de fournisseur n'arrete ni l'etape ni l'import (F-606) : elle
 * est notee, et l'entreprise continue avec ce qu'on sait. Seule une panne de
 * notre cote, la base par exemple, fait echouer l'etape, pour que la file la
 * retente.
 */

export interface IdentifyDeps {
  readonly entreprises: RechercheEntreprisesClient;
  /** Absent quand aucune cle n'est configuree. */
  readonly webSearch?: WebSearchProvider;
  readonly webSearchLimits: CallLimits;
  readonly enqueue: Enqueue;
}

/** Le resultat deduit d'une recherche est garde 30 jours (D-07, F-604). */
const CACHE_JOURS = 30;

interface CompanyRow {
  name: string;
  normalized_name: string;
  domain: string | null;
  domain_status: string;
  siren: string | null;
  legal_name: string | null;
  city: string | null;
  country: string | null;
  settings: unknown;
}

function francaiseOuInconnue(pays: string | null): boolean {
  if (pays === null) return true;
  return ['fr', 'france', 'fra'].includes(normalizeCompanyName(pays));
}

async function appliquerIdentite(job: CompanyJob, identite: LegalIdentity): Promise<void> {
  // Le SIREN n'est pose que s'il est libre : une autre fiche du meme compte
  // qui le porte deja est la meme entreprise, et c'est a l'utilisateur de les
  // rapprocher, pas a une recherche de le decider en silence.
  await query(
    `update companies c
        set siren = case
              when c.siren is null and not exists (
                select 1 from companies autre
                 where autre.user_id = c.user_id and autre.id <> c.id and autre.siren = $2
              ) then $2 else c.siren end,
            legal_name = coalesce(c.legal_name, $3),
            city = coalesce(c.city, $4),
            industry = coalesce(c.industry, $5),
            employee_range = coalesce(c.employee_range, $6),
            updated_at = now()
      where c.id = $1`,
    [
      job.companyId,
      identite.siren,
      identite.legalName,
      identite.city ?? null,
      identite.industry ?? null,
      identite.employeeRange ?? null,
    ],
  );
}

async function identiteLegale(
  deps: IdentifyDeps,
  job: CompanyJob,
  entreprise: CompanyRow,
): Promise<string | undefined> {
  if (!francaiseOuInconnue(entreprise.country)) return undefined;
  try {
    let identite: LegalIdentity | undefined;
    if (entreprise.siren !== null && entreprise.legal_name === null) {
      identite = await deps.entreprises.bySiren(entreprise.siren);
    } else if (entreprise.siren === null) {
      identite = await deps.entreprises.byName(entreprise.name, entreprise.city ?? undefined);
    }
    if (identite !== undefined) await appliquerIdentite(job, identite);
    return undefined;
  } catch (error) {
    return `Recherche d'entreprises indisponible : ${error instanceof Error ? error.message : 'erreur'}`;
  }
}

/** Le resultat deduit d'une recherche, tel qu'il est garde au cache. */
interface EnCache {
  domain?: string;
  confidence?: number;
}

const MOTIFS_SAUT: Record<string, string> = {
  interrupted: 'Recherche interrompue, non relancee pour ne pas la payer deux fois.',
  already_settled: 'Recherche deja faite pour cette entreprise dans cet import.',
  user_quota: 'Plafond mensuel de recherches atteint pour ce compte.',
  global_quota: 'Credits de recherche du mois epuises.',
  budget: 'Plafond de depense du mois atteint : les appels payants sont suspendus.',
};

/**
 * Le site officiel par recherche web, compte, mis en cache et plafonne par
 * `paidCall`. Rend le site choisi, ou un motif quand la recherche n'a pas pu
 * se faire.
 */
async function rechercherSite(
  deps: IdentifyDeps,
  job: CompanyJob,
  entreprise: CompanyRow,
): Promise<{ site?: OfficialSite; note?: string }> {
  const recherche = deps.webSearch;
  if (recherche === undefined) return { note: 'Recherche web non configuree.' };

  const issue = await paidCall<EnCache>({
    scope: {
      provider: recherche.name,
      operation: 'web_search',
      userId: job.userId,
      importId: job.importId,
      companyId: job.companyId,
      idempotencyKey: `web_search:${job.importId}:${job.companyId}`,
    },
    limits: deps.webSearchLimits,
    // Une recherche deja faite pour ce nom et cette ville, par n'importe
    // quelle tache, ne coute rien.
    cacheKey: `${entreprise.normalized_name}|${(entreprise.city ?? '').toLowerCase()}`,
    ttlDays: CACHE_JOURS,
    call: async () => {
      const requete = [entreprise.name, entreprise.city].filter(Boolean).join(' ');
      return chooseOfficialSite(await recherche.search(requete), entreprise.name) ?? {};
    },
  });

  if (issue.kind === 'skipped') return { note: MOTIFS_SAUT[issue.reason] ?? '' };
  if (issue.kind === 'failed') {
    const motif = issue.error instanceof Error ? issue.error.message : 'erreur';
    return { note: `Recherche web indisponible : ${motif}` };
  }
  const { domain, confidence } = issue.value;
  return domain === undefined || confidence === undefined ? {} : { site: { domain, confidence } };
}

async function appliquerSite(job: CompanyJob, site: OfficialSite): Promise<boolean> {
  // Le domaine n'est pose que s'il est libre pour ce compte : une autre fiche
  // qui le porte deja est sans doute la meme entreprise.
  const result = await query(
    `update companies c
        set domain = $2, domain_confidence = $3, domain_status = $4::domain_status,
            updated_at = now()
      where c.id = $1 and c.domain is null
        and not exists (
          select 1 from companies autre
           where autre.user_id = c.user_id and autre.id <> c.id and autre.domain = $2
        )`,
    [
      job.companyId,
      site.domain,
      site.confidence,
      site.confidence >= CONFIDENCE_THRESHOLD ? 'confirmed' : 'to_confirm',
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

async function sansCollecte(job: CompanyJob, note: 'no_website' | undefined, erreur?: string) {
  await query(
    `update companies
        set crawl_status = 'skipped',
            crawl_notes = case when $2::crawl_note is null or $2::crawl_note = any(crawl_notes)
                               then crawl_notes else array_append(crawl_notes, $2::crawl_note) end,
            crawl_error = coalesce($3, crawl_error),
            updated_at = now()
      where id = $1`,
    [job.companyId, note ?? null, erreur ?? null],
  );
  await finishStep('crawl', job, 'skipped');
}

export async function identifyCompany(deps: IdentifyDeps, job: CompanyJob): Promise<void> {
  const logger = getLogger().child({ step: 'company.identify', companyId: job.companyId });

  if (await isImportCancelled(job.importId)) {
    await finishStep('identify', job, 'skipped');
    return;
  }

  const lu = await query<CompanyRow>(
    `select c.name, c.normalized_name, c.domain, c.domain_status::text as domain_status, c.siren,
            c.legal_name, c.city, c.country, i.settings
       from companies c
       join imports i on i.id = $2 and i.user_id = c.user_id
      where c.id = $1 and c.user_id = $3`,
    [job.companyId, job.importId, job.userId],
  );
  const entreprise = lu.rows[0];
  if (entreprise === undefined) {
    // Supprimee entre-temps : rien a identifier.
    await finishStep('identify', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  // Le quota d'entreprises se prend ici, au seuil du traitement : avant, on
  // ne sait pas si l'entreprise existe encore ; apres, le travail est fait et
  // le refuser ne rend rien (F-1401, F-1403).
  const place = await claimQuota(job.userId, 'companies');
  if (!place.granted) {
    await blockOnQuota('identify', job, 'companies');
    logger.info({ limite: place.limit }, 'entreprise en attente de quota');
    return;
  }

  await startStep('identify', job);
  const reglages = readStoredSettings(entreprise.settings);
  const notes: string[] = [];

  const legale = await identiteLegale(deps, job, entreprise);
  if (legale !== undefined) notes.push(legale);

  let statutDomaine = entreprise.domain_status;
  let aUnDomaine = entreprise.domain !== null;

  if (!aUnDomaine && reglages.providers.includes('brave')) {
    const { site, note } = await rechercherSite(deps, job, entreprise);
    if (note !== undefined) notes.push(note);
    if (site !== undefined && (await appliquerSite(job, site))) {
      aUnDomaine = true;
      statutDomaine = site.confidence >= CONFIDENCE_THRESHOLD ? 'confirmed' : 'to_confirm';
    }
  }

  const erreur = notes.length > 0 ? notes.join(' ') : undefined;

  // L'etape suivante est declaree avant de conclure celle-ci : sinon l'import
  // pourrait se croire termine entre les deux.
  if (aUnDomaine && (statutDomaine === 'provided' || statutDomaine === 'confirmed')) {
    await planStep('crawl', job);
    await finishStep('identify', job, 'done', erreur);
    await deps.enqueue('crawl', job);
  } else {
    // Sans domaine, ou avec un domaine a confirmer par l'utilisateur (F-305),
    // la collecte n'a pas lieu.
    await sansCollecte(job, aUnDomaine ? undefined : 'no_website', erreur);
    await finishStep('identify', job, 'done', erreur);
    await completeImportIfDone(job.importId);
  }

  logger.info({ statutDomaine, aUnDomaine }, 'identification terminee');
}
