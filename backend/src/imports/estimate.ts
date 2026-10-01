import { MAX_PAGES } from '../crawler/pages.js';
import { getEnvironment } from '../config/env.js';
import { callCostCents } from '../providers/budget.js';
import { quotaReport, type QuotaMetric } from '../quotas/usage.js';
import type { ImportSettings } from './settings.js';

/**
 * Estimation avant traitement (F-1402).
 *
 * Au-dela de vingt entreprises, l'utilisateur voit ce que son import va
 * consommer avant de le lancer, et confirme. Ce n'est pas une precaution
 * commerciale : un import de mille entreprises epuise les quotas du mois en
 * une fois, et l'apprendre apres coup n'aide personne.
 *
 * L'estimation majore. Une entreprise dont le domaine est deja connu ne
 * declenche aucune recherche, un site de trois pages n'en consomme pas vingt-
 * cinq, et une reponse en cache ne coute rien. Annoncer le pire et consommer
 * moins vaut mieux que l'inverse.
 */

/** F-1402 : en dessous, l'import part sans rien demander. */
export const CONFIRMATION_THRESHOLD = 20;

export interface EstimateLine {
  readonly metric: QuotaMetric;
  /** Ce que cet import demanderait au plus. */
  readonly needed: number;
  readonly remaining: number;
  readonly limit: number;
  /** Vrai quand le quota du mois n'y suffit pas : l'import s'arretera en route. */
  readonly exceeds: boolean;
}

export interface ImportEstimate {
  readonly companies: number;
  readonly quotas: EstimateLine[];
  /** Recherches de site officiel et appels d'enrichissement, au plus. */
  readonly providerCalls: number;
  /** Verifications de boite demandees par les reglages, au plus. */
  readonly mailboxChecks: number;
  /** Ce que les appels payants couteraient au plus, en centimes. */
  readonly costCents: number;
  /** Vrai au-dela du seuil : l'interface doit faire confirmer. */
  readonly needsConfirmation: boolean;
  /** Vrai quand un quota ne suffira pas : l'import s'arretera proprement. */
  readonly willStopEarly: boolean;
}

/**
 * Combien d'adresses une entreprise peut faire verifier. Majoration tenue :
 * au-dela, la verification de boite n'est de toute facon pas demandee.
 */
const ADRESSES_PAR_ENTREPRISE = 3;

export async function estimateImport(
  userId: string,
  companies: number,
  settings: ImportSettings,
): Promise<ImportEstimate> {
  const environment = getEnvironment();
  const pages = companies * MAX_PAGES[settings.depth];

  // Une recherche de site par entreprise au plus, et un appel
  // d'enrichissement par entreprise au plus, chacun seulement si
  // l'utilisateur a laisse le fournisseur actif.
  const recherches = settings.providers.includes('brave') ? companies : 0;
  const enrichissements = settings.providers.includes('hunter') ? companies : 0;
  const verifications = settings.mailboxCheck === 'never' ? 0 : companies * ADRESSES_PAR_ENTREPRISE;

  const besoins: Record<QuotaMetric, number> = { companies, pages, exports: 0 };
  const quotas = (await quotaReport(userId)).map((ligne) => ({
    metric: ligne.metric,
    needed: besoins[ligne.metric],
    remaining: ligne.remaining,
    limit: ligne.limit,
    exceeds: besoins[ligne.metric] > ligne.remaining,
  }));

  // Une verification de boite vaut un demi-credit (D-14).
  const cout =
    callCostCents(environment.PROVIDER_ORDER.split(',')[0]?.trim() ?? 'hunter', enrichissements) +
    callCostCents('hunter', verifications * 0.5);

  return {
    companies,
    quotas,
    providerCalls: recherches + enrichissements,
    mailboxChecks: verifications,
    costCents: cout,
    needsConfirmation: companies > CONFIRMATION_THRESHOLD,
    willStopEarly: quotas.some((ligne) => ligne.exceeds),
  };
}
