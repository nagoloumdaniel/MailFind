/**
 * Detail du score de confiance (6.9), tel que le serveur l'a calcule. Rien
 * n'est recalcule ici : l'ecran montre les lignes rendues par le serveur, dont
 * la somme est le score. Afficher un calcul refait cote navigateur, c'est
 * risquer d'afficher autre chose que ce qui a ete fait.
 */

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
  criterion: ScoreCriterion;
  points: number;
}

export const SCORE_CRITERION_LABELS: Record<ScoreCriterion, string> = {
  official_site: 'Trouvee sur le site officiel',
  legal_or_contact_page: 'Dans les mentions legales ou la page contact',
  second_source: 'Confirmee par une seconde page ou un second fournisseur',
  valid: 'Boite confirmee valide',
  accept_all: 'Domaine qui accepte toute adresse',
  relevant_role: 'Type recherche dans cet import',
  old_source: 'Source de plus de 12 mois',
  unknown: 'Verification sans reponse exploitable',
  deduced_cap: 'Deduite et non confirmee : plafond a 40',
  excluded_status: 'Invalide, jetable ou supprimee : score a 0',
  bounds: 'Le score reste entre 0 et 100',
};

/**
 * Relit le detail rendu par l'API. Une ligne inconnue ou mal formee est
 * ecartee plutot que d'afficher un libelle vide ; le detail est alors
 * incomplet, et `readBreakdown` le dit par `complete`.
 */
export function readBreakdown(
  valeur: unknown,
  score: number | null,
): { lines: ScoreLine[]; complete: boolean } | undefined {
  if (typeof valeur !== 'object' || valeur === null || score === null) return undefined;
  const brutes = (valeur as { criteria?: unknown }).criteria;
  if (!Array.isArray(brutes)) return undefined;
  const lignes: ScoreLine[] = [];
  for (const brute of brutes as unknown[]) {
    if (typeof brute !== 'object' || brute === null) continue;
    const { criterion, points } = brute as { criterion?: unknown; points?: unknown };
    if (typeof criterion !== 'string' || typeof points !== 'number') continue;
    if (!(criterion in SCORE_CRITERION_LABELS)) continue;
    lignes.push({ criterion: criterion as ScoreCriterion, points });
  }
  const somme = lignes.reduce((total, ligne) => total + ligne.points, 0);
  return { lines: lignes, complete: somme === score };
}

/** « +40 », « -15 », « 0 » : le signe se lit, comme dans le cahier des charges. */
export function formatPoints(points: number): string {
  if (points > 0) return `+${String(points)}`;
  if (points < 0) return `-${String(-points)}`;
  return '0';
}

/** Trois paliers pour la couleur du badge ; le nombre, lui, est toujours ecrit. */
export function scoreTone(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
