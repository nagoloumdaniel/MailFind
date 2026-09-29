import { apiFetch } from './api';
import type { EmailStatus } from './imports';

/** Verification ponctuelle (F-705) : la meme limite que le serveur. */
export const ONE_OFF_MAX = 1000;

/** L'indicateur UTF-8 qu'Excel attend pour lire les accents. */
const BOM = String.fromCharCode(0xfeff);

export interface OneOffResult {
  input: string;
  address: string | null;
  status: EmailStatus;
  reason: string;
  type: string;
  webmail: boolean;
}

/**
 * Les adresses d'un texte colle ou des cellules d'un CSV : tout morceau qui
 * contient une arobase, debarrasse des chevrons et guillemets qui
 * l'entourent (« Jean <jean@acme.fr> »). Le reste, noms et intitules, n'est
 * pas une adresse et n'a pas a etre signale comme invalide.
 */
export function extractAddresses(texte: string): string[] {
  const vues = new Set<string>();
  const adresses: string[] = [];
  for (const morceau of texte.split(/[\s,;]+/)) {
    const nettoye = morceau.replace(/^[<("'[]+|[>)"'\].]+$/g, '').replace(/^mailto:/i, '');
    if (!nettoye.includes('@')) continue;
    const cle = nettoye.toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    adresses.push(nettoye);
  }
  return adresses;
}

export async function checkAddresses(addresses: string[]): Promise<OneOffResult[]> {
  const { results } = await apiFetch<{ results: OneOffResult[] }>('/api/verifications/one-off', {
    method: 'POST',
    body: JSON.stringify({ addresses }),
  });
  return results;
}

/**
 * Une cellule sure pour un tableur : entre guillemets, et une valeur qui
 * commence comme une formule est neutralisee (injection de formule).
 */
function cellule(valeur: string): string {
  const sure = /^[=+\-@\t\r]/.test(valeur) ? `'${valeur}` : valeur;
  return `"${sure.replaceAll('"', '""')}"`;
}

/**
 * Le resultat en CSV, au separateur point-virgule et avec l'indicateur UTF-8 :
 * c'est ce qu'Excel en francais ouvre sans assistant.
 */
export function resultsToCsv(
  resultats: readonly OneOffResult[],
  libelles: Record<EmailStatus, string>,
): string {
  const lignes = [['adresse', 'statut', 'libelle', 'motif', 'type'].map(cellule).join(';')];
  for (const r of resultats) {
    lignes.push(
      [r.address ?? r.input, r.status, libelles[r.status], r.reason, r.type].map(cellule).join(';'),
    );
  }
  return `${BOM}${lignes.join('\r\n')}\r\n`;
}
