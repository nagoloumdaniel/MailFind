import { z } from 'zod';
import { normalizeCompanyName } from '../companies/normalize.js';

/**
 * Client de l'API Recherche d'entreprises de l'Etat (F-304, D-10).
 *
 * Elle est gratuite, officielle et sans cle, et fait foi pour les entreprises
 * francaises : SIREN, adresse du siege, activite, tranche d'effectif. Elle ne
 * donne pas le site web. Sa limite publiee est de 7 requetes par seconde : le
 * client passe par la meme file que la collecte, reglee pour en rester loin.
 */

/** Une requete toutes les 200 ms au plus : 5 par seconde, sous la limite de 7. */
export const RECHERCHE_ENTREPRISES_INTERVAL_MS = 200;

const siegeSchema = z
  .object({
    libelle_commune: z.string().nullish(),
    code_postal: z.string().nullish(),
    adresse: z.string().nullish(),
  })
  .partial();

const resultatSchema = z.object({
  siren: z.string(),
  nom_complet: z.string().nullish(),
  nom_raison_sociale: z.string().nullish(),
  sigle: z.string().nullish(),
  activite_principale: z.string().nullish(),
  tranche_effectif_salarie: z.string().nullish(),
  etat_administratif: z.string().nullish(),
  siege: siegeSchema.nullish(),
});

const reponseSchema = z.object({ results: z.array(z.unknown()) });

export interface LegalIdentity {
  readonly siren: string;
  readonly legalName: string;
  readonly city?: string;
  /** Code NAF de l'activite principale, par exemple « 62.01Z ». */
  readonly industry?: string;
  readonly employeeRange?: string;
}

/** Tranches d'effectif de l'INSEE, telles qu'on les lit. */
const TRANCHES: Record<string, string> = {
  '00': '0 salarie',
  '01': '1 ou 2 salaries',
  '02': '3 a 5 salaries',
  '03': '6 a 9 salaries',
  '11': '10 a 19 salaries',
  '12': '20 a 49 salaries',
  '21': '50 a 99 salaries',
  '22': '100 a 199 salaries',
  '31': '200 a 249 salaries',
  '32': '250 a 499 salaries',
  '41': '500 a 999 salaries',
  '42': '1 000 a 1 999 salaries',
  '51': '2 000 a 4 999 salaries',
  '52': '5 000 a 9 999 salaries',
  '53': '10 000 salaries et plus',
};

export interface RechercheEntreprisesClient {
  /** Par SIREN : une seule entreprise possible. */
  bySiren(siren: string): Promise<LegalIdentity | undefined>;
  /**
   * Par nom, et par ville quand elle est connue. Ne rend une entreprise que si
   * le rapprochement est sans ambiguite : un SIREN attribue a tort ferait
   * fusionner deux fiches au dedoublonnage.
   */
  byName(name: string, city?: string): Promise<LegalIdentity | undefined>;
}

function versIdentite(resultat: z.infer<typeof resultatSchema>): LegalIdentity {
  const ville = resultat.siege?.libelle_commune ?? undefined;
  const tranche =
    resultat.tranche_effectif_salarie === null || resultat.tranche_effectif_salarie === undefined
      ? undefined
      : TRANCHES[resultat.tranche_effectif_salarie];
  return {
    siren: resultat.siren,
    legalName: resultat.nom_raison_sociale ?? resultat.nom_complet ?? resultat.siren,
    ...(ville === undefined ? {} : { city: ville }),
    ...(resultat.activite_principale === null || resultat.activite_principale === undefined
      ? {}
      : { industry: resultat.activite_principale }),
    ...(tranche === undefined ? {} : { employeeRange: tranche }),
  };
}

function lireResultats(corps: unknown): z.infer<typeof resultatSchema>[] {
  const reponse = reponseSchema.safeParse(corps);
  if (!reponse.success) return [];
  return reponse.data.results.flatMap((brut) => {
    const resultat = resultatSchema.safeParse(brut);
    return resultat.success && /^\d{9}$/.test(resultat.data.siren) ? [resultat.data] : [];
  });
}

/**
 * La ville sans ses arrondissements ni son cedex : « LYON 3E ARRONDISSEMENT »
 * dans l'API et « Lyon 3e » dans un fichier designent la meme commune.
 */
function villeReduite(ville: string): string {
  return normalizeCompanyName(ville)
    .replace(/\b\d+(er|e|eme)?\b/g, ' ')
    .replace(/\b(arrondissement|cedex)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Le rapprochement est strict : nom normalise identique a la raison sociale,
 * au nom complet ou au sigle, entreprise active, et meme ville quand on la
 * connait. Plusieurs candidates restantes, c'est une ambiguite : rien.
 */
export function pickByName(
  resultats: readonly z.infer<typeof resultatSchema>[],
  nom: string,
  ville?: string,
): LegalIdentity | undefined {
  const cible = normalizeCompanyName(nom);
  if (cible === '') return undefined;
  const candidates = resultats.filter((resultat) => {
    if (resultat.etat_administratif === 'C') return false;
    const noms = [resultat.nom_raison_sociale, resultat.nom_complet, resultat.sigle]
      .filter((valeur): valeur is string => typeof valeur === 'string' && valeur !== '')
      .map((valeur) => normalizeCompanyName(valeur.replace(/\(.*\)$/, '')));
    if (!noms.includes(cible)) return false;
    if (ville === undefined) return true;
    const commune = resultat.siege?.libelle_commune;
    return (
      commune !== null && commune !== undefined && villeReduite(commune) === villeReduite(ville)
    );
  });
  const [unique] = candidates;
  return candidates.length === 1 && unique !== undefined ? versIdentite(unique) : undefined;
}

export function createRechercheEntreprisesClient(options: {
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly throttle: <T>(task: () => Promise<T>) => Promise<T>;
  readonly timeoutMs?: number;
}): RechercheEntreprisesClient {
  async function chercher(q: string): Promise<z.infer<typeof resultatSchema>[]> {
    const url = new URL('/search', options.baseUrl);
    url.searchParams.set('q', q);
    url.searchParams.set('per_page', '10');
    const reponse = await options.throttle(() =>
      fetch(url, {
        headers: { 'user-agent': options.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      }),
    );
    if (!reponse.ok) {
      throw new Error(`Recherche d'entreprises a repondu ${String(reponse.status)}`);
    }
    return lireResultats(await reponse.json());
  }

  return {
    async bySiren(siren) {
      const resultats = await chercher(siren);
      const exact = resultats.find((resultat) => resultat.siren === siren);
      return exact === undefined ? undefined : versIdentite(exact);
    },
    async byName(name, city) {
      return pickByName(await chercher(name), name, city);
    },
  };
}
