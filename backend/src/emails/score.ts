import type { EmailType } from './roles.js';

/**
 * Score de confiance, section 6.9. Il mesure la qualite de la donnee, pas la
 * chance d'obtenir une reponse.
 *
 * Le detail est rendu critere par critere, et la somme des points listes est
 * toujours egale au score : le plafond d'une adresse deduite, la mise a zero
 * d'une adresse ecartee et les bornes 0 a 100 y figurent comme des lignes a
 * part entiere. Ce que l'utilisateur lit au survol est donc exactement le
 * calcul, sans ligne cachee (Definition of Done de la Phase 5).
 */

export type EmailStatus =
  | 'valid'
  | 'accept_all'
  | 'risky'
  | 'unknown'
  | 'invalid'
  | 'disposable'
  | 'suppressed'
  | 'unverified';

export type EmailOrigin = 'found' | 'provider' | 'deduced' | 'imported';

export type SourceKind = 'website' | 'provider' | 'import' | 'deduction';

export interface ScoreSource {
  readonly kind: SourceKind;
  readonly url?: string | null;
  readonly provider?: string | null;
  readonly discoveredAt: Date;
}

export interface ScoreInput {
  readonly status: EmailStatus;
  readonly origin: EmailOrigin;
  readonly type: EmailType;
  readonly wantedTypes: readonly string[];
  /** Le domaine officiel de l'entreprise, s'il est connu. */
  readonly officialDomain?: string | null;
  readonly sources: readonly ScoreSource[];
  readonly now: Date;
}

export type ScoreCriterion =
  | 'official_site'
  | 'legal_or_contact_page'
  | 'second_source'
  | 'valid'
  | 'accept_all'
  | 'relevant_role'
  | 'old_source'
  | 'unknown'
  | 'deduced_cap'
  | 'excluded_status'
  | 'bounds';

export interface ScoreLine {
  readonly criterion: ScoreCriterion;
  readonly points: number;
}

export interface ScoreBreakdown {
  readonly score: number;
  readonly criteria: readonly ScoreLine[];
}

const PLAFOND_DEDUITE = 40;
const DOUZE_MOIS_MS = 365 * 24 * 60 * 60 * 1000;

/** Statuts qui ramenent le score a 0, quoi que disent les autres criteres. */
const ECARTES: ReadonlySet<EmailStatus> = new Set(['invalid', 'disposable', 'suppressed']);

const PAGES_LEGALES_OU_CONTACT = [
  'mentions-legales',
  'mentions',
  'legal',
  'legales',
  'impressum',
  'contact',
  'contacts',
  'contactez-nous',
  'nous-contacter',
];

function hote(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function surLeDomaine(url: string | null | undefined, domaine: string): boolean {
  const h = hote(url);
  return h !== undefined && (h === domaine || h.endsWith(`.${domaine}`));
}

function pageLegaleOuContact(url: string | null | undefined): boolean {
  if (url === null || url === undefined) return false;
  let chemin: string;
  try {
    chemin = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  const replie = `-${chemin
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-`;
  return PAGES_LEGALES_OU_CONTACT.some((mot) => replie.includes(`-${mot}-`));
}

/**
 * Une confirmation est une page ou un fournisseur distinct. Une deduction ne
 * confirme rien : elle dit seulement que l'adresse est plausible.
 */
function confirmations(sources: readonly ScoreSource[]): Set<string> {
  const vues = new Set<string>();
  for (const source of sources) {
    if (source.kind === 'website' && source.url) vues.add(`page:${source.url}`);
    else if (source.kind === 'provider' && source.provider)
      vues.add(`fournisseur:${source.provider}`);
    else if (source.kind === 'import') vues.add('import');
  }
  return vues;
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const lignes: ScoreLine[] = [];
  let total = 0;
  const ajouter = (criterion: ScoreCriterion, points: number) => {
    lignes.push({ criterion, points });
    total += points;
  };

  const domaine = input.officialDomain?.toLowerCase();
  const pagesOfficielles =
    domaine === undefined
      ? []
      : input.sources.filter((s) => s.kind === 'website' && surLeDomaine(s.url, domaine));

  if (pagesOfficielles.length > 0) ajouter('official_site', 40);
  if (pagesOfficielles.some((s) => pageLegaleOuContact(s.url)))
    ajouter('legal_or_contact_page', 10);

  const confirmees = confirmations(input.sources);
  if (confirmees.size >= 2) ajouter('second_source', 15);

  if (input.status === 'valid') ajouter('valid', 30);
  if (input.status === 'accept_all') ajouter('accept_all', 5);

  // Une adresse nominative n'est pas une adresse de role, et un type inconnu
  // ne repond a aucune recherche.
  if (
    input.type !== 'personal' &&
    input.type !== 'unknown' &&
    input.wantedTypes.includes(input.type)
  ) {
    ajouter('relevant_role', 5);
  }

  const plusRecente = Math.max(...input.sources.map((s) => s.discoveredAt.getTime()));
  if (Number.isFinite(plusRecente) && input.now.getTime() - plusRecente > DOUZE_MOIS_MS) {
    ajouter('old_source', -15);
  }

  if (input.status === 'unknown') ajouter('unknown', -10);

  // Un garde-fou plus qu'une regle active : avec les criteres ci-dessus, une
  // deduction sans autre source plafonne d'elle-meme a 10. Il reste la pour
  // qu'un critere ajoute demain ne fasse pas passer une supposition pour une
  // adresse vue.
  const confirmeeAilleurs = confirmees.size > 0 || input.status === 'valid';
  if (input.origin === 'deduced' && !confirmeeAilleurs && total > PLAFOND_DEDUITE) {
    ajouter('deduced_cap', PLAFOND_DEDUITE - total);
  }

  if (ECARTES.has(input.status)) {
    ajouter('excluded_status', total === 0 ? 0 : -total);
  } else if (total < 0) {
    ajouter('bounds', -total);
  } else if (total > 100) {
    ajouter('bounds', 100 - total);
  }

  return { score: total, criteria: lignes };
}
