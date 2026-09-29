import { getPool, query } from '../db/pool.js';
import { generateCandidates, hasMx, type MxResolver } from '../emails/candidates.js';
import { applyPattern, splitName } from '../emails/nominative.js';
import { classifyLocalPart, type EmailType, type WantedType } from '../emails/roles.js';
import { isKnownField } from '../imports/fields.js';
import { readStoredSettings } from '../imports/settings.js';
import { getLogger } from '../observability/logger.js';
import { paidCall, type CallLimits } from '../providers/credits.js';
import type { DomainSearchResult, EnrichmentProvider } from '../providers/enrichment.js';
import type { CompanyJob } from '../queue/queues.js';
import type { Cipher } from '../security/crypto.js';
import { isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import type { Enqueue } from './start.js';
import {
  completeImportIfDone,
  finishStep,
  isImportCancelled,
  planStep,
  startStep,
} from './steps.js';

/**
 * Etape `company.enrich` (section 8.4) : quand le site n'a pas donne
 * d'adresse d'un type recherche, les fournisseurs dans l'ordre de repli
 * (F-603), puis les adresses deduites (sections 6.5).
 *
 * Aucune erreur de fournisseur n'arrete l'etape ni l'import (F-606) : elle
 * est notee avec son motif, et le fournisseur suivant, puis la deduction,
 * prennent le relais.
 */

export interface EnrichDeps {
  /** Dans l'ordre de repli configure (F-603). */
  readonly providers: readonly EnrichmentProvider[];
  /** Sans cle de chiffrement, aucun fournisseur n'est appele (F-604). */
  readonly cipher?: Cipher;
  /** Plafonds de la recherche par domaine, par fournisseur. */
  readonly providerLimits: Readonly<Record<string, CallLimits>>;
  readonly mx?: MxResolver;
  readonly enqueue: Enqueue;
}

/** F-604 : une reponse de fournisseur est gardee 30 jours. */
const CACHE_JOURS = 30;
const EXTRAIT_MAX = 200;

interface CompanyRow {
  domain: string | null;
  domain_status: string;
  settings: unknown;
}

interface Nouvelle {
  readonly address: string;
  readonly type: EmailType;
  readonly origin: 'provider' | 'deduced';
  readonly source: {
    readonly kind: 'provider' | 'deduction';
    readonly provider?: string;
    readonly url?: string;
    readonly excerpt: string;
  };
}

/** Une verification de boite que le fournisseur a jointe a sa recherche. */
interface DejaVerifiee {
  readonly normalized: string;
  readonly provider: string;
  readonly status: 'valid' | 'accept_all';
  readonly checkedOn: string;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * F-704 : une verification vaut 30 jours, a compter du jour ou le fournisseur
 * l'a faite, pas de celui ou on la lit. Une date a venir est une erreur du
 * fournisseur : ecartee.
 */
function encoreValable(jour: string, maintenant = Date.now()): boolean {
  const date = Date.parse(`${jour}T00:00:00Z`);
  if (Number.isNaN(date)) return false;
  const age = maintenant - date;
  return age > -JOUR_MS && age < CACHE_JOURS * JOUR_MS;
}

function surLeDomaine(adresse: string, domaine: string): boolean {
  const hote = adresse.toLowerCase().split('@')[1] ?? '';
  return hote === domaine || hote.endsWith(`.${domaine}`);
}

/** Les noms que l'utilisateur a donnes pour cette entreprise dans cet import (F-504). */
async function nomsFournis(job: CompanyJob, settings: unknown): Promise<string[]> {
  const colonnes = (settings as { columns?: { headers?: unknown; mapping?: unknown } }).columns;
  const entetes: unknown[] = Array.isArray(colonnes?.headers) ? colonnes.headers : [];
  const correspondance: unknown[] = Array.isArray(colonnes?.mapping) ? colonnes.mapping : [];
  const index = correspondance.findIndex(
    (champ) => typeof champ === 'string' && isKnownField(champ) && champ === 'contact_name',
  );
  const entete = entetes[index];
  if (index === -1 || typeof entete !== 'string') return [];

  const lignes = await query<{ nom: string | null }>(
    `select raw ->> $3 as nom from import_rows
      where import_id = $1 and company_id = $2`,
    [job.importId, job.companyId, entete],
  );
  return [...new Set(lignes.rows.map((ligne) => ligne.nom?.trim() ?? '').filter(Boolean))];
}

async function enregistrer(
  job: CompanyJob,
  nouvelles: readonly Nouvelle[],
  verifiees: readonly DejaVerifiee[],
): Promise<void> {
  if (nouvelles.length === 0 && verifiees.length === 0) return;
  const client = await getPool().connect();
  try {
    await client.query('begin');
    for (const nouvelle of nouvelles) {
      const normalisee = nouvelle.address.toLowerCase();
      const email = await client.query<{ id: string }>(
        `insert into emails
           (company_id, user_id, address, normalized_address, local_part, type, origin)
         values ($1, $2, $3, $4, $5, $6::email_type, $7::email_origin)
         on conflict on constraint emails_unique_per_company
         do update set updated_at = now()
         returning id`,
        [
          job.companyId,
          job.userId,
          nouvelle.address,
          normalisee,
          normalisee.split('@')[0] ?? '',
          nouvelle.type,
          nouvelle.origin,
        ],
      );
      // L'adresse et sa source ensemble : la base refuse l'une sans l'autre.
      await client.query(
        `insert into email_sources (email_id, kind, url, provider, context_excerpt)
         values ($1, $2::email_source_kind, $3, $4, $5)
         on conflict do nothing`,
        [
          email.rows[0]?.id,
          nouvelle.source.kind,
          nouvelle.source.url ?? null,
          nouvelle.source.provider ?? null,
          nouvelle.source.excerpt.slice(0, EXTRAIT_MAX),
        ],
      );
    }
    // Apres les adresses, pour trouver aussi celles qui viennent d'etre
    // ajoutees. Au jour du fournisseur, et une seule fois : un enrichissement
    // rejoue relit la meme reponse du cache.
    for (const deja of verifiees) {
      await client.query(
        `insert into verifications
           (email_id, level, status, sub_status, reason, provider, address, verified_at)
         select e.id, 8, $3::email_status, 'domain_search', $4, $5, e.normalized_address,
                $6::date
           from emails e
          where e.company_id = $1 and e.normalized_address = $2
            and not exists (
              select 1 from verifications v
               where v.email_id = e.id and v.level = 8 and v.provider = $5
                 and v.verified_at = $6::date)`,
        [
          job.companyId,
          deja.normalized,
          deja.status,
          deja.status === 'valid'
            ? `Boite confirmee par ${deja.provider} le ${deja.checkedOn}, lors de sa recherche par domaine.`
            : 'Le domaine accepte toute adresse : celle-ci ne peut pas etre confirmee.',
          deja.provider,
          deja.checkedOn,
        ],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const MOTIFS: Record<string, string> = {
  interrupted: 'appel interrompu, non relance pour ne pas le payer deux fois',
  already_settled: 'deja interroge pour cette entreprise dans cet import',
  user_quota: 'plafond mensuel du compte atteint',
  global_quota: 'credits du mois epuises',
};

export async function enrichStep(deps: EnrichDeps, job: CompanyJob): Promise<void> {
  const logger = getLogger().child({ step: 'company.enrich', companyId: job.companyId });

  if (await isImportCancelled(job.importId)) {
    await finishStep('enrich', job, 'skipped');
    return;
  }

  const lu = await query<CompanyRow>(
    `select c.domain, c.domain_status::text as domain_status, i.settings
       from companies c
       join imports i on i.id = $2 and i.user_id = c.user_id
      where c.id = $1 and c.user_id = $3`,
    [job.companyId, job.importId, job.userId],
  );
  const entreprise = lu.rows[0];
  const domaine = entreprise?.domain ?? null;
  if (
    entreprise === undefined ||
    domaine === null ||
    (entreprise.domain_status !== 'provided' && entreprise.domain_status !== 'confirmed')
  ) {
    await finishStep('enrich', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  await startStep('enrich', job);
  const reglages = readStoredSettings(entreprise.settings);
  const recherches = reglages.emailTypes as WantedType[];
  const notes: string[] = [];

  // Le type enregistre, pas celui du prefixe : une adresse generique vue sur
  // la page carrieres compte deja pour le recrutement (6.8).
  const connues = await query<{ normalized_address: string; type: EmailType }>(
    'select normalized_address, type::text as type from emails where company_id = $1',
    [job.companyId],
  );
  const adresses = new Set(connues.rows.map((ligne) => ligne.normalized_address));
  const trouves = new Set<EmailType>(connues.rows.map((ligne) => ligne.type));
  const manque = () => recherches.some((type) => !trouves.has(type));

  let format: { pattern: string; provider: string } | undefined;
  const nouvelles: Nouvelle[] = [];
  const verifiees: DejaVerifiee[] = [];
  // R-04 : ni fournie ni deduite, une adresse supprimee ne revient jamais.
  const supprimees = await loadSuppressedHashes(job.userId);
  const ajouter = (nouvelle: Nouvelle) => {
    const cle = nouvelle.address.toLowerCase();
    if (adresses.has(cle) || isSuppressed(supprimees, cle)) return;
    adresses.add(cle);
    trouves.add(nouvelle.type);
    nouvelles.push(nouvelle);
  };

  // F-603 : chaque fournisseur, dans l'ordre, seulement s'il manque encore un
  // type recherche.
  for (const fournisseur of deps.providers) {
    if (!manque()) break;
    if (!reglages.providers.includes(fournisseur.name as 'hunter' | 'brave')) continue;
    if (deps.cipher === undefined) {
      notes.push(`${fournisseur.name} : aucune cle de chiffrement, fournisseur non appele.`);
      break;
    }
    const limites = deps.providerLimits[fournisseur.name];
    if (limites === undefined) continue;

    const issue = await paidCall<DomainSearchResult>({
      scope: {
        provider: fournisseur.name,
        operation: 'domain_search',
        userId: job.userId,
        importId: job.importId,
        companyId: job.companyId,
        idempotencyKey: `domain_search:${fournisseur.name}:${job.importId}:${job.companyId}`,
      },
      limits: limites,
      cacheKey: domaine,
      ttlDays: CACHE_JOURS,
      cipher: deps.cipher,
      call: () => fournisseur.domainSearch(domaine),
    });

    if (issue.kind === 'skipped') {
      notes.push(`${fournisseur.name} : ${MOTIFS[issue.reason] ?? issue.reason}.`);
      continue;
    }
    if (issue.kind === 'failed') {
      const motif = issue.error instanceof Error ? issue.error.message : 'erreur';
      notes.push(`${fournisseur.name} : ${motif}.`);
      continue;
    }

    if (issue.value.pattern !== undefined && format === undefined) {
      format = { pattern: issue.value.pattern, provider: fournisseur.name };
    }
    for (const email of issue.value.emails) {
      if (!surLeDomaine(email.address, domaine)) continue;
      const locale = email.address.toLowerCase().split('@')[0] ?? '';
      // Gratuite, elle vaut aussi pour une adresse que le site avait deja
      // donnee ; jamais pour une adresse supprimee (R-04).
      const normalisee = email.address.toLowerCase();
      if (
        email.verification !== undefined &&
        encoreValable(email.verification.checkedOn) &&
        !isSuppressed(supprimees, normalisee)
      ) {
        verifiees.push({
          normalized: normalisee,
          provider: fournisseur.name,
          status: email.verification.status,
          checkedOn: email.verification.checkedOn,
        });
      }
      const vue = email.sourceUrls[0];
      ajouter({
        address: email.address,
        type: email.kind === 'personal' ? 'personal' : classifyLocalPart(locale),
        origin: 'provider',
        source: {
          kind: 'provider',
          provider: fournisseur.name,
          ...(vue === undefined ? {} : { url: vue }),
          excerpt: `Fourni par ${fournisseur.name}${
            email.confidence === undefined
              ? ''
              : `, confiance annoncee ${String(email.confidence)} sur 100`
          }${vue === undefined ? '' : `, vue sur ${vue}`}. Non verifiee.`,
        },
      });
    }
  }

  // F-504 : une adresse nominative pour chaque nom donne par l'utilisateur,
  // si un format a ete observe sur le domaine. Elles passent avant les
  // adresses de role dans le plafond : l'utilisateur les a demandees.
  let deduites = 0;
  if (format !== undefined) {
    for (const nom of await nomsFournis(job, entreprise.settings)) {
      const personne = splitName(nom);
      const adresse =
        personne === undefined ? undefined : applyPattern(format.pattern, personne, domaine);
      if (adresse === undefined || deduites >= 5) continue;
      ajouter({
        address: adresse,
        type: 'personal',
        origin: 'deduced',
        source: {
          kind: 'deduction',
          excerpt: `Deduite du nom donne dans l'import et du format ${format.pattern} observe par ${format.provider} sur ce domaine. Non verifiee.`,
        },
      });
      deduites += 1;
    }
  }

  // Sections 6.5 : les adresses de role probables des types qui manquent,
  // sur un domaine qui recoit du courrier.
  if (manque()) {
    const mx = await hasMx(domaine, deps.mx);
    if (mx === 'yes') {
      for (const candidate of generateCandidates({
        domain: domaine,
        wantedTypes: recherches,
        foundTypes: trouves,
        existing: adresses,
        max: Math.max(0, 5 - deduites),
      })) {
        ajouter({
          address: candidate.address,
          type: candidate.type,
          origin: 'deduced',
          source: {
            kind: 'deduction',
            excerpt: `Adresse de role probable (prefixe ${candidate.prefix}) : le domaine recoit du courrier et aucune adresse de ce type n'a ete trouvee. Non verifiee.`,
          },
        });
      }
    } else if (mx === 'no') {
      notes.push('Domaine sans serveur de messagerie : aucune adresse deduite.');
    } else {
      notes.push('Serveurs de messagerie du domaine non verifiables : aucune adresse deduite.');
    }
  }

  await enregistrer(job, nouvelles, verifiees);
  // La verification est declaree avant de conclure : sinon l'import pourrait
  // se croire termine entre les deux.
  await planStep('verify', job);
  await finishStep('enrich', job, 'done', notes.length > 0 ? notes.join(' ') : undefined);
  await deps.enqueue('verify', job);
  logger.info({ ajoutees: nouvelles.length, notes: notes.length }, 'enrichissement termine');
}
