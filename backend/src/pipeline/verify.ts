import { getPool, query } from '../db/pool.js';
import type { EmailType } from '../emails/roles.js';
import {
  computeScore,
  type EmailOrigin,
  type EmailStatus,
  type ScoreSource,
  type SourceKind,
} from '../emails/score.js';
import { readStoredSettings } from '../imports/settings.js';
import { getLogger } from '../observability/logger.js';
import { paidCall, type CallLimits } from '../providers/credits.js';
import type { MailboxResult, MailboxStatus, MailboxVerifier } from '../providers/enrichment.js';
import type { CompanyJob } from '../queue/queues.js';
import type { Cipher } from '../security/crypto.js';
import { hashAddress, isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import { isDisposableIn } from '../verification/disposable.js';
import { checkLocally, type LocalVerdict, type MailDns } from '../verification/local.js';
import { USER_EXCLUSION_REASON } from '../emails/visibility.js';
import { completeImportIfDone, finishStep, isImportCancelled, startStep } from './steps.js';

/**
 * Etape `company.verify` (section 8.4, point 6) : les controles locaux sur
 * chaque adresse de l'entreprise, la verification de boite par le
 * fournisseur quand le reglage de l'import la demande (F-702), l'historique
 * (F-703), le statut qui en decoule, puis le score (6.9).
 *
 * Aucune connexion SMTP ne part de nos serveurs (D-09) : le niveau 8 passe
 * par le fournisseur, compte, mis en cache et plafonne comme toute depense.
 */

export interface VerifyDeps {
  readonly mailDns: MailDns;
  /** La liste des domaines jetables, relue par le processus au plus une fois l'heure. */
  readonly disposableDomains: () => Promise<ReadonlySet<string>>;
  /** Absent sans cle : seules les verifications locales s'appliquent. */
  readonly verifier?: MailboxVerifier;
  /** Sans cle de chiffrement, le fournisseur n'est pas appele (F-604). */
  readonly cipher?: Cipher;
  readonly verificationLimits: CallLimits;
  readonly now?: () => Date;
}

/** F-704 : une verification vaut 30 jours, le cache du fournisseur aussi. */
const VALIDITE_JOURS = 30;
const JOUR_MS = 24 * 60 * 60 * 1000;
/** Tarif Hunter au 23 septembre 2026 (D-08) : une verification, un demi-credit. */
const CREDITS_VERIFICATION = 0.5;

interface EmailRow {
  id: string;
  normalized_address: string;
  type: EmailType;
  origin: EmailOrigin;
  status: EmailStatus;
  last_check: Date | null;
  last_mailbox: Date | null;
  last_mailbox_status: EmailStatus | null;
}

interface SourceRow {
  email_id: string;
  kind: SourceKind;
  url: string | null;
  provider: string | null;
  discovered_at: Date;
}

interface Verification {
  readonly level: number;
  readonly status: EmailStatus;
  readonly reason: string;
  readonly subStatus?: string;
  readonly provider?: string;
}

const STATUT_BOITE: Record<MailboxStatus, EmailStatus> = {
  valid: 'valid',
  invalid: 'invalid',
  accept_all: 'accept_all',
  unknown: 'unknown',
  disposable: 'disposable',
  // Section 6.7 : une messagerie grand public est `risky`, pas une adresse
  // d'entreprise confirmee.
  webmail: 'risky',
};

function motifBoite(fournisseur: string, resultat: MailboxResult): string {
  switch (resultat.status) {
    case 'valid':
      return `Boite confirmee par ${fournisseur}.`;
    case 'invalid':
      return `Boite inexistante selon ${fournisseur}.`;
    case 'accept_all':
      return 'Le domaine accepte toute adresse : celle-ci ne peut pas etre confirmee.';
    case 'unknown':
      return `Le serveur de messagerie n'a pas repondu de facon exploitable a ${fournisseur}.`;
    case 'disposable':
      return `Domaine jetable selon ${fournisseur}.`;
    case 'webmail':
      return "Messagerie grand public : ce n'est pas une adresse d'entreprise confirmee.";
  }
}

const MOTIFS_SAUT: Record<string, string> = {
  interrupted: 'appel interrompu, non relance pour ne pas le payer deux fois',
  already_settled: 'deja verifiee dans cet import',
  user_quota: 'plafond mensuel du compte atteint',
  global_quota: 'credits de verification du mois epuises',
  budget: 'plafond de depense du mois atteint',
};

/** Statuts qui ecartent l'adresse de tout export et de tout envoi (6.7). */
const ECARTES: ReadonlySet<EmailStatus> = new Set(['invalid', 'disposable', 'suppressed']);

function motifExclusion(origin: EmailOrigin, statut: EmailStatus): string {
  // F-503 : une candidate invalide est ecartee sans etre montree.
  if (origin === 'deduced') return "Candidate ecartee : la verification l'a refusee.";
  if (statut === 'suppressed') return 'Adresse dans votre liste de suppression.';
  if (statut === 'disposable') return 'Domaine jetable.';
  return 'Adresse invalide.';
}

export async function verifyStep(deps: VerifyDeps, job: CompanyJob): Promise<void> {
  const logger = getLogger().child({ step: 'company.verify', companyId: job.companyId });

  if (await isImportCancelled(job.importId)) {
    await finishStep('verify', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  const lu = await query<{ domain: string | null; settings: unknown }>(
    `select c.domain, i.settings
       from companies c
       join imports i on i.id = $2 and i.user_id = c.user_id
      where c.id = $1 and c.user_id = $3`,
    [job.companyId, job.importId, job.userId],
  );
  const entreprise = lu.rows[0];
  if (entreprise === undefined) {
    await finishStep('verify', job, 'skipped');
    await completeImportIfDone(job.importId);
    return;
  }

  await startStep('verify', job);
  const reglages = readStoredSettings(entreprise.settings);
  const bilan = await verifyEmails(deps, {
    userId: job.userId,
    companyId: job.companyId,
    importId: job.importId,
    runKey: job.importId,
    officialDomain: entreprise.domain,
    wantedTypes: reglages.emailTypes,
    mailboxCheck: reglages.mailboxCheck,
  });
  const notes = skipNotes(bilan.skips);

  await finishStep('verify', job, 'done', notes.length > 0 ? notes.join(' ') : undefined);
  await completeImportIfDone(job.importId);
  logger.info(
    { adresses: bilan.total, verifiees: bilan.checked, boites: bilan.mailboxes },
    'verification terminee',
  );
}

export interface VerifyRun {
  readonly userId: string;
  readonly companyId: string;
  /** L'import qui a demande la verification, pour le compte des credits. */
  readonly importId?: string;
  /**
   * Ce qui distingue une verification de boite d'une autre dans la cle
   * d'idempotence : l'import pour le pipeline, un identifiant de demande
   * sinon. Rejouee sous la meme cle, elle ne paie pas deux fois.
   */
  readonly runKey: string;
  readonly officialDomain: string | null;
  readonly wantedTypes: readonly string[];
  readonly mailboxCheck: 'never' | 'found' | 'all';
  /** Seulement ces adresses ; toutes celles de l'entreprise sinon. */
  readonly emailIds?: readonly string[];
  /** Revoir les controles locaux meme si l'adresse a ete verifiee il y a moins de 30 jours. */
  readonly force?: boolean;
}

export interface VerifyOutcome {
  readonly total: number;
  readonly checked: number;
  readonly mailboxes: number;
  /** Verifications de boite non faites, par motif. */
  readonly skips: ReadonlyMap<string, number>;
}

/** Les verifications de boite non faites, dites a l'utilisateur. */
export function skipNotes(sauts: ReadonlyMap<string, number>): string[] {
  const notes: string[] = [];
  for (const [cle, nombre] of sauts) {
    const motif =
      cle === 'indisponible'
        ? 'fournisseur non configure'
        : cle === 'erreur'
          ? 'erreur du fournisseur'
          : (MOTIFS_SAUT[cle] ?? cle);
    notes.push(`Verification de boite non faite pour ${String(nombre)} adresse(s) : ${motif}.`);
  }
  return notes;
}

/**
 * Le coeur de la verification, pour le pipeline comme pour une adresse
 * saisie ou corrigee a la main (F-1013, F-1014) : controles locaux, boite si
 * demandee, historique, statut et score.
 */
export async function verifyEmails(deps: VerifyDeps, run: VerifyRun): Promise<VerifyOutcome> {
  const maintenant = deps.now?.() ?? new Date();
  const filtre = run.emailIds === undefined ? '' : 'and e.id = any($3::uuid[])';
  const params: unknown[] = [run.companyId, run.userId];
  if (run.emailIds !== undefined) params.push(run.emailIds);

  // Seules comptent les verifications de l'adresse telle qu'elle est : une
  // adresse corrigee n'herite pas de la fraicheur de l'ancienne. Les controles
  // locaux et la boite se datent a part : un fournisseur peut avoir verifie
  // la boite (recherche par domaine) avant tout controle local.
  const emails = await query<EmailRow>(
    `select e.id, e.normalized_address, e.type::text as type, e.origin::text as origin,
            e.status::text as status,
            (select max(v.verified_at) from verifications v
              where v.email_id = e.id and v.address = e.normalized_address
                and v.level < 8) as last_check,
            b.verified_at as last_mailbox, b.status::text as last_mailbox_status
       from emails e
       left join lateral (
         select v.verified_at, v.status from verifications v
          where v.email_id = e.id and v.address = e.normalized_address and v.level = 8
          order by v.verified_at desc limit 1
       ) b on true
      where e.company_id = $1 and e.user_id = $2 ${filtre}
      order by e.created_at, e.id`,
    params,
  );
  const sources = await query<SourceRow>(
    `select s.email_id, s.kind::text as kind, s.url, s.provider, s.discovered_at
       from email_sources s
       join emails e on e.id = s.email_id
      where e.company_id = $1 and e.user_id = $2 ${filtre}`,
    params,
  );

  const supprimees = await loadSuppressedHashes(run.userId);
  const jetables = await deps.disposableDomains();
  const contexte = {
    dns: deps.mailDns,
    isDisposable: (domaine: string) => isDisposableIn(jetables, domaine),
    isSuppressed: (adresse: string) => isSuppressed(supprimees, adresse),
  };

  const recent = (date: Date | null) =>
    date !== null && maintenant.getTime() - date.getTime() < VALIDITE_JOURS * JOUR_MS;
  const sauts = new Map<string, number>();
  let verifiees = 0;
  let boites = 0;

  for (const email of emails.rows) {
    // F-702 : « trouvees seulement » laisse de cote les candidates deduites.
    const boiteDemandee =
      run.mailboxCheck === 'all' || (run.mailboxCheck === 'found' && email.origin !== 'deduced');

    let statut = email.status;
    const nouvelles: Verification[] = [];

    // F-704 : verifiee il y a moins de 30 jours, au niveau demande, une
    // adresse ne l'est pas a nouveau. Son score est quand meme recalcule :
    // une seconde source a pu apparaitre. Une adresse supprimee est toujours
    // revue : c'est gratuit, la liste passe avant le DNS, et l'utilisateur a
    // pu l'en retirer.
    const aJour =
      run.force !== true &&
      email.status !== 'suppressed' &&
      recent(email.last_check) &&
      (!boiteDemandee || recent(email.last_mailbox));

    if (!aJour) {
      const locale: LocalVerdict = await checkLocally(email.normalized_address, contexte);
      nouvelles.push({ level: locale.level, status: locale.status, reason: locale.reason });
      statut = locale.status;

      const { verifier, cipher } = deps;
      // Une boite verifiee il y a moins de 30 jours, par un appel paye ou
      // jointe a une recherche par domaine, vaut qu'elle ait ete demandee ou
      // non : c'est ce qu'on sait de plus precis, et elle ne coute rien. Une
      // reverification forcee la refait, et un controle local qui ecarte
      // l'adresse l'emporte.
      const boiteConnue =
        run.force !== true && recent(email.last_mailbox) ? email.last_mailbox_status : null;
      if (boiteConnue !== null && !ECARTES.has(locale.status)) {
        statut = boiteConnue;
      } else if (boiteDemandee && !ECARTES.has(locale.status)) {
        if (verifier === undefined || cipher === undefined) {
          sauts.set('indisponible', (sauts.get('indisponible') ?? 0) + 1);
        } else {
          const issue = await paidCall<MailboxResult>({
            scope: {
              provider: verifier.name,
              operation: 'verification',
              userId: run.userId,
              ...(run.importId === undefined ? {} : { importId: run.importId }),
              companyId: run.companyId,
              idempotencyKey: `verification:${verifier.name}:${run.runKey}:${email.id}`,
              credits: CREDITS_VERIFICATION,
            },
            limits: deps.verificationLimits,
            // L'empreinte, pas l'adresse : la cle du cache est lisible en base.
            cacheKey: hashAddress(email.normalized_address),
            ttlDays: VALIDITE_JOURS,
            cipher,
            call: () => verifier.verify(email.normalized_address),
          });
          if (issue.kind === 'ok') {
            const resultat = issue.value;
            statut = STATUT_BOITE[resultat.status];
            nouvelles.push({
              level: 8,
              status: statut,
              reason: motifBoite(verifier.name, resultat),
              provider: verifier.name,
              ...(resultat.subStatus === undefined ? {} : { subStatus: resultat.subStatus }),
            });
            boites += 1;
          } else {
            const cle = issue.kind === 'skipped' ? issue.reason : 'erreur';
            sauts.set(cle, (sauts.get(cle) ?? 0) + 1);
          }
        }
      }
      verifiees += 1;
    }

    const score = computeScore({
      status: statut,
      origin: email.origin,
      type: email.type,
      wantedTypes: run.wantedTypes,
      officialDomain: run.officialDomain,
      sources: sources.rows
        .filter((source) => source.email_id === email.id)
        .map((source): ScoreSource => ({
          kind: source.kind,
          url: source.url,
          provider: source.provider,
          discoveredAt: source.discovered_at,
        })),
      now: maintenant,
    });

    await enregistrer(email, statut, nouvelles, score);
  }

  return { total: emails.rows.length, checked: verifiees, mailboxes: boites, skips: sauts };
}

/** Historique, statut et score d'une adresse ensemble : l'un n'a pas de sens sans l'autre. */
async function enregistrer(
  email: EmailRow,
  statut: EmailStatus,
  nouvelles: readonly Verification[],
  score: ReturnType<typeof computeScore>,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    for (const verification of nouvelles) {
      await client.query(
        `insert into verifications (email_id, level, status, sub_status, reason, provider, address)
         values ($1, $2, $3::email_status, $4, $5, $6, $7)`,
        [
          email.id,
          verification.level,
          verification.status,
          verification.subStatus ?? null,
          verification.reason,
          verification.provider ?? null,
          email.normalized_address,
        ],
      );
    }
    const ecartee = ECARTES.has(statut);
    await client.query(
      `update emails
          set status = $2::email_status,
              score = $3,
              score_breakdown = $4::jsonb,
              last_verified_at = case when $5 then now() else last_verified_at end,
              -- Le statut ecarte ou rend une adresse, sauf quand c'est
              -- l'utilisateur qui l'a exclue : la verification ne defait pas
              -- son choix. Une adresse retiree de la liste de suppression
              -- revient.
              excluded = $6 or (excluded and excluded_reason = $8),
              excluded_reason = case
                when excluded and excluded_reason = $8 then excluded_reason
                when $6 then $7 end,
              updated_at = now()
        where id = $1`,
      [
        email.id,
        statut,
        score.score,
        JSON.stringify(score),
        nouvelles.length > 0,
        ecartee,
        ecartee ? motifExclusion(email.origin, statut) : null,
        USER_EXCLUSION_REASON,
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
