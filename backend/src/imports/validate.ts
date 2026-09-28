import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeSiren,
  normalizeTags,
  normalizeUrl,
} from '../companies/normalize.js';
import { thirdPartyKind } from '../companies/third-party.js';
import { IDENTIFYING_FIELDS, type KnownField } from './fields.js';

/**
 * Validation des lignes cote serveur (F-202).
 *
 * Le navigateur a deja montre un apercu, mais il n'a rien decide : les valeurs
 * d'un fichier sont traitees comme hostiles (S-07), et rien de ce qui vient de
 * la page n'est cru sur parole.
 */

/** Au-dela, la valeur est tronquee : aucune donnee utile ne fait cette taille. */
const MAX_VALUE_LENGTH = 2000;

/**
 * Caracteres de controle, qui n'ont rien a faire dans une cellule de tableur et
 * brouillent aussi bien l'affichage que les journaux. La tabulation et le
 * retour a la ligne sont volontairement absents : ils apparaissent
 * legitimement dans une cellule entre guillemets.
 */
// eslint-disable-next-line no-control-regex -- viser ces caracteres est precisement le but
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export interface CompanyDraft {
  readonly name: string | undefined;
  readonly normalizedName: string | undefined;
  readonly domain: string | undefined;
  readonly websiteUrl: string | undefined;
  readonly careersUrl: string | undefined;
  readonly siren: string | undefined;
  readonly city: string | undefined;
  readonly country: string | undefined;
  readonly industry: string | undefined;
  readonly contactName: string | undefined;
  readonly tags: readonly string[];
  readonly notes: string | undefined;
  readonly attributes: Record<string, string>;
}

export type RowVerdict =
  | { readonly accepted: true; readonly draft: CompanyDraft }
  | { readonly accepted: false; readonly reason: string };

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const propre = value.replace(CONTROL_CHARACTERS, '').trim().slice(0, MAX_VALUE_LENGTH);
  return propre === '' ? undefined : propre;
}

/**
 * Transforme une ligne brute en brouillon d'entreprise, ou dit pourquoi elle
 * n'est pas exploitable. Le motif est ecrit pour etre lu par l'utilisateur,
 * pas par un developpeur.
 */
export function validateRow(
  headers: readonly string[],
  mapping: readonly (KnownField | null)[],
  row: readonly string[],
): RowVerdict {
  const valeurs = new Map<KnownField, string>();
  const attributes: Record<string, string> = {};

  headers.forEach((header, index) => {
    const valeur = clean(row[index]);
    if (valeur === undefined) return;

    const champ = mapping[index] ?? null;
    if (champ === null) {
      const titre = clean(header);
      if (titre !== undefined) attributes[titre] = valeur;
      return;
    }
    // Premiere valeur gagnante : deux colonnes attribuees au meme champ sont
    // deja empechees a la saisie, mais l'API peut envoyer n'importe quoi.
    if (!valeurs.has(champ)) valeurs.set(champ, valeur);
  });

  const nom = valeurs.get('company_name');
  const domaineBrut = valeurs.get('domain');
  const siteBrut = valeurs.get('website_url');
  const carrieresBrut = valeurs.get('careers_url');

  if (IDENTIFYING_FIELDS.every((champ) => valeurs.get(champ) === undefined)) {
    return {
      accepted: false,
      reason:
        "Aucun nom d'entreprise, domaine, site ou page carrieres : rien a chercher sur cette ligne.",
    };
  }

  // Une page hebergee par une plateforme de recrutement, un reseau social ou
  // un annuaire designe l'entreprise sans etre son site (F-306) : son domaine
  // n'est pas le sien. Le prendre fondrait en une seule toutes les entreprises
  // dont le fichier ne donne qu'un lien Welcome to the Jungle.
  const domaineColonne = domaineBrut === undefined ? undefined : normalizeDomain(domaineBrut);
  const domaineSite = siteBrut === undefined ? undefined : normalizeDomain(siteBrut);
  const tiersColonne = domaineColonne === undefined ? undefined : thirdPartyKind(domaineColonne);
  const tiersSite = domaineSite === undefined ? undefined : thirdPartyKind(domaineSite);

  const domaine =
    (tiersColonne === undefined ? domaineColonne : undefined) ??
    (tiersSite === undefined ? domaineSite : undefined);

  const site =
    siteBrut === undefined || tiersSite !== undefined ? undefined : normalizeUrl(siteBrut);
  // Une offre sur une plateforme de recrutement reste utile : c'est la page
  // carrieres de l'entreprise.
  const carrieresBrutes =
    carrieresBrut ??
    (tiersSite === 'careers' ? siteBrut : undefined) ??
    (tiersColonne === 'careers' ? domaineBrut : undefined);
  const carrieres = carrieresBrutes === undefined ? undefined : normalizeUrl(carrieresBrutes);
  const nomNormalise = nom === undefined ? undefined : normalizeCompanyName(nom);

  // Une ligne dont le nom est vide et dont aucune URL n'est exploitable n'a
  // plus rien pour identifier quoi que ce soit, meme si le fichier avait
  // l'air correct.
  if (
    (nom === undefined || nomNormalise === undefined || nomNormalise === '') &&
    domaine === undefined &&
    carrieres === undefined
  ) {
    const fautif = domaineBrut ?? siteBrut ?? carrieresBrut ?? '';
    const tiers = tiersColonne ?? tiersSite;
    let reason: string;
    if (fautif === '') reason = "Le nom d'entreprise est vide apres nettoyage.";
    else if (tiers === 'social' || tiers === 'directory') {
      reason = `« ${fautif.slice(0, 80)} » est une page de reseau social ou d'annuaire, pas le site de l'entreprise : ajoutez son nom ou son domaine.`;
    } else {
      reason = `« ${fautif.slice(0, 80)} » n'est pas un domaine ni une adresse de site exploitable.`;
    }
    return { accepted: false, reason };
  }

  const etiquettes = valeurs.get('tags');
  const sirenBrut = valeurs.get('siren');

  return {
    accepted: true,
    draft: {
      name: nom,
      normalizedName: nomNormalise === '' ? undefined : nomNormalise,
      domain: domaine,
      websiteUrl: site,
      careersUrl: carrieres,
      siren: sirenBrut === undefined ? undefined : normalizeSiren(sirenBrut),
      city: valeurs.get('city'),
      country: valeurs.get('country'),
      industry: valeurs.get('industry'),
      contactName: valeurs.get('contact_name'),
      tags: etiquettes === undefined ? [] : normalizeTags(etiquettes),
      notes: valeurs.get('notes'),
      attributes,
    },
  };
}
