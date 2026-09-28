import { checkLocally, normalizeAddress, type LocalContext, type LocalVerdict } from './local.js';

/**
 * Verification ponctuelle (F-705) : une liste d'adresses sans entreprise,
 * collee ou tiree d'un CSV. Les niveaux 1 a 7 seulement : ils sont gratuits,
 * et rien n'est enregistre. La verification de boite, payante, reste
 * reservee aux imports, ou elle est comptee et plafonnee.
 */

export const ONE_OFF_MAX = 1000;

export interface OneOffResult {
  /** Ce que l'utilisateur a donne, tel quel. */
  readonly input: string;
  readonly address: string | null;
  readonly status: LocalVerdict['status'];
  readonly reason: string;
  readonly type: LocalVerdict['type'];
  readonly webmail: boolean;
}

/**
 * Les adresses dans l'ordre donne, sans doublon (une adresse vue deux fois ne
 * se verifie qu'une fois). Quelques domaines a la fois : le cache DNS fait
 * qu'une liste de cent adresses du meme domaine ne coute qu'une requete.
 */
export async function checkAddressList(
  adresses: readonly string[],
  contexte: LocalContext,
  simultanees = 8,
): Promise<OneOffResult[]> {
  const vues = new Set<string>();
  const uniques: string[] = [];
  for (const brute of adresses) {
    const saisie = brute.trim();
    if (saisie === '') continue;
    const cle = normalizeAddress(saisie) ?? saisie.toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    uniques.push(saisie);
  }

  const resultats: OneOffResult[] = new Array<OneOffResult>(uniques.length);
  let suivante = 0;
  async function travailler(): Promise<void> {
    for (let index = suivante++; index < uniques.length; index = suivante++) {
      const saisie = uniques[index] ?? '';
      const verdict = await checkLocally(saisie, contexte);
      resultats[index] = {
        input: saisie,
        address: verdict.normalized ?? null,
        status: verdict.status,
        reason: verdict.reason,
        type: verdict.type,
        webmail: verdict.webmail,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultanees, uniques.length) }, travailler));
  return resultats;
}
