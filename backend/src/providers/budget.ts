import { getEnvironment } from '../config/env.js';
import { getLogger } from '../observability/logger.js';
import { reportError } from '../observability/errors.js';

/**
 * Plafond global de depense par fournisseur et par mois (F-1405).
 *
 * Les plafonds en credits de D-13 bornent deja ce que les paliers gratuits
 * offrent. Celui-ci borne l'argent : le jour ou l'exploitant releve les
 * credits au-dela du gratuit, c'est lui qui arrete la depense, pour tout le
 * monde, et qui previent.
 *
 * Par defaut le budget vaut zero : rien de payant n'est jamais appele. Le
 * pipeline continue alors sans le fournisseur et le dit, comme pour un
 * plafond de credits atteint.
 */

/** Ce qu'une reservation a besoin de savoir pour arbitrer la depense. */
export interface SpendPolicy {
  /** Le plafond du mois, en centimes, tous usages confondus chez ce fournisseur. */
  readonly budgetCents: number;
  /** Ce que cet appel couterait. Zero quand le fournisseur est gratuit. */
  readonly costCents: number;
}

/** La politique de l'exploitant pour cet appel, lue dans la configuration. */
export function spendPolicy(provider: string, credits: number): SpendPolicy {
  return { budgetCents: budgetCents(), costCents: callCostCents(provider, credits) };
}

/** Centimes par credit, par fournisseur : `hunter:2,autre:5`. */
export function creditPrices(
  brut = getEnvironment().PROVIDER_CREDIT_PRICE_CENTS,
): Record<string, number> {
  const prix: Record<string, number> = {};
  for (const morceau of brut.split(',')) {
    const [nom, valeur] = morceau.split(':').map((part) => part.trim());
    const centimes = Number(valeur);
    if (nom !== undefined && nom !== '' && Number.isFinite(centimes) && centimes >= 0) {
      prix[nom] = centimes;
    }
  }
  return prix;
}

/** Ce que cet appel coutera, en centimes. Zero quand le fournisseur est gratuit. */
export function callCostCents(provider: string, credits: number, tarifs = creditPrices()): number {
  return Math.round((tarifs[provider] ?? 0) * credits);
}

/** Le budget mensuel, en centimes. */
export function budgetCents(): number {
  return Math.round(getEnvironment().PROVIDER_MONTHLY_BUDGET_EUR * 100);
}

/**
 * Previent l'exploitant, une seule fois par fournisseur et par mois : c'est
 * l'insertion qui decide, pas un compteur en memoire, pour que deux processus
 * n'envoient pas deux alertes.
 */
export async function alertBudgetReached(
  insert: (provider: string, spentCents: number, budget: number) => Promise<boolean>,
  provider: string,
  spentCents: number,
  budget: number,
): Promise<void> {
  if (!(await insert(provider, spentCents, budget))) return;

  const message = `Plafond de depense atteint chez ${provider} : ${(spentCents / 100).toFixed(2)} euros sur ${(budget / 100).toFixed(2)}. Les appels payants sont suspendus pour tous jusqu'au mois prochain.`;
  getLogger().error({ provider, spentCents, budget }, message);
  reportError(new Error(message), { service: 'worker' });
}
