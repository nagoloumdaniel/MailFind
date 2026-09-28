import { promises as dns } from 'node:dns';
import { ROLE_PREFIXES, type EmailType, type WantedType } from './roles.js';

/**
 * Adresses de role candidates (section 6.5), quand ni le site ni les
 * fournisseurs n'ont donne d'adresse d'un type recherche.
 *
 * Ce sont des hypotheses : elles portent l'origine « deduite », le statut
 * « non verifiee », et ne sont jamais presentees ni exportees comme verifiees
 * (regle du depot). Leur verification arrive en Phase 5 (F-503).
 */

/** F-505 : cinq candidates par entreprise au plus, pour contenir le cout de verification. */
export const MAX_CANDIDATES = 5;

export interface Candidate {
  readonly address: string;
  readonly type: WantedType;
  readonly prefix: string;
}

/**
 * Les candidates des types recherches qui manquent, a raison d'un prefixe
 * par type a tour de role : chaque type manquant recoit d'abord son prefixe
 * le plus frequent, plutot que cinq variantes du premier type.
 */
export function generateCandidates(options: {
  readonly domain: string;
  readonly wantedTypes: readonly WantedType[];
  readonly foundTypes: ReadonlySet<EmailType>;
  readonly existing?: ReadonlySet<string>;
  readonly max?: number;
}): Candidate[] {
  const manquants = options.wantedTypes.filter((type) => !options.foundTypes.has(type));
  const plafond = options.max ?? MAX_CANDIDATES;
  const deja = options.existing ?? new Set<string>();
  const candidates: Candidate[] = [];
  const vues = new Set<string>();

  for (let rang = 0; candidates.length < plafond; rang += 1) {
    let ajoute = false;
    for (const type of manquants) {
      const prefixe = ROLE_PREFIXES[type][rang];
      if (prefixe === undefined) continue;
      ajoute = true;
      const adresse = `${prefixe}@${options.domain}`.toLowerCase();
      if (deja.has(adresse) || vues.has(adresse)) continue;
      vues.add(adresse);
      candidates.push({ address: adresse, type, prefix: prefixe });
      if (candidates.length >= plafond) break;
    }
    if (!ajoute) break;
  }
  return candidates;
}

export type MxVerdict = 'yes' | 'no' | 'unknown';

export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

/**
 * F-502 : un domaine sans serveur de messagerie ne recoit aucune candidate.
 * Un « MX nul » (RFC 7505, un seul enregistrement vers « . ») dit
 * explicitement que le domaine ne recoit pas de courrier. Une panne de
 * resolution ne dit rien : on ne genere pas, sans conclure pour autant.
 */
export async function hasMx(
  domain: string,
  resolver: MxResolver = dns.resolveMx,
): Promise<MxVerdict> {
  try {
    const enregistrements = await resolver(domain);
    const utiles = enregistrements.filter((mx) => mx.exchange !== '' && mx.exchange !== '.');
    return utiles.length > 0 ? 'yes' : 'no';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN') return 'no';
    return 'unknown';
  }
}
