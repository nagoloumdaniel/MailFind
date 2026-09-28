import type { FoundAddress } from './extract.js';

/**
 * Ce qui a l'allure d'une adresse de l'entreprise sans en etre une (F-410).
 *
 * Chaque rejet porte son motif : un faux positif garde coute une candidature
 * envoyee dans le vide, et un vrai positif ecarte sans raison ne se retrouve
 * jamais. Les motifs servent aux tests et au diagnostic, pas a l'utilisateur.
 */

export type RejectionReason = 'example' | 'file_name' | 'service_provider' | 'unrelated_domain';

export interface FilterContext {
  /** Domaine confirme de l'entreprise. */
  readonly companyDomain: string;
  /**
   * Domaines vus sur une page de mentions legales du site : l'entreprise y
   * declare elle-meme ses coordonnees, meme sur un autre domaine.
   */
  readonly confirmedDomains: ReadonlySet<string>;
}

export interface FilterResult {
  readonly kept: FoundAddress[];
  readonly rejected: { address: FoundAddress; reason: RejectionReason }[];
}

const DOMAINES_EXEMPLE = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.fr',
  'exemple.fr',
  'exemple.com',
  'domain.com',
  'domaine.fr',
  'domaine.com',
  'votre-domaine.fr',
  'votredomaine.fr',
  'votre-domaine.com',
  'mondomaine.fr',
  'monsite.fr',
  'mysite.com',
  'yoursite.com',
  'yourdomain.com',
  'email.com',
  'test.com',
  'sample.com',
]);

/** Parties locales qui ne designent personne : un modele de saisie. */
const LOCALES_EXEMPLE = new Set([
  'prenom.nom',
  'nom.prenom',
  'prenom',
  'nom',
  'votre.email',
  'votre.adresse',
  'votremail',
  'votreemail',
  'your.email',
  'youremail',
  'yourname',
  'firstname.lastname',
  'name',
  'john.doe',
  'jane.doe',
  'jean.dupont',
  'exemple',
  'example',
  'user',
  'username',
]);

/** Une « extension » qui est en fait celle d'un fichier : logo@2x.png. */
const EXTENSIONS_FICHIER = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'css',
  'js',
  'pdf',
  'mp4',
  'webm',
  'woff',
  'woff2',
  'ttf',
]);

/**
 * Hebergeurs, createurs de sites, outils de formulaire et de suivi : leurs
 * adresses apparaissent sur des milliers de sites, mentions legales comprises,
 * et n'appartiennent a aucun d'eux.
 */
const PRESTATAIRES = [
  'ovh.com',
  'ovh.net',
  'ovhcloud.com',
  'o2switch.fr',
  'gandi.net',
  'ionos.fr',
  'ionos.com',
  '1and1.fr',
  'godaddy.com',
  'hostinger.com',
  'hostinger.fr',
  'infomaniak.com',
  'scaleway.com',
  'online.net',
  'amazonaws.com',
  'cloudflare.com',
  'vercel.com',
  'netlify.com',
  'wix.com',
  'wixpress.com',
  'squarespace.com',
  'wordpress.com',
  'wpengine.com',
  'webflow.io',
  'webflow.com',
  'shopify.com',
  'jimdo.com',
  'sentry.io',
  'hubspot.com',
  'mailchimp.com',
  'sendinblue.com',
  'brevo.com',
  'typeform.com',
  'jotform.com',
  'google.com',
  'axeptio.eu',
  'didomi.io',
  'cookiebot.com',
  'onetrust.com',
];

function sousDomaineDe(domaine: string, parent: string): boolean {
  return domaine === parent || domaine.endsWith(`.${parent}`);
}

function motif(adresse: FoundAddress, contexte: FilterContext): RejectionReason | undefined {
  const [locale = '', domaine = ''] = adresse.normalized.split('@');
  const extension = domaine.split('.').at(-1) ?? '';

  if (EXTENSIONS_FICHIER.has(extension) || /@\dx\./.test(adresse.normalized)) return 'file_name';
  if (DOMAINES_EXEMPLE.has(domaine) || LOCALES_EXEMPLE.has(locale)) return 'example';
  // Cles de suivi d'erreurs : une partie locale faite de 32 chiffres
  // hexadecimaux n'est jamais une personne.
  if (/^[0-9a-f]{32}$/.test(locale)) return 'service_provider';
  if (PRESTATAIRES.some((prestataire) => sousDomaineDe(domaine, prestataire))) {
    return 'service_provider';
  }
  if (sousDomaineDe(domaine, contexte.companyDomain)) return undefined;
  if ([...contexte.confirmedDomains].some((confirme) => sousDomaineDe(domaine, confirme))) {
    return undefined;
  }
  return 'unrelated_domain';
}

export function filterAddresses(
  adresses: readonly FoundAddress[],
  contexte: FilterContext,
): FilterResult {
  const kept: FoundAddress[] = [];
  const rejected: FilterResult['rejected'] = [];
  for (const adresse of adresses) {
    const raison = motif(adresse, contexte);
    if (raison === undefined) kept.push(adresse);
    else rejected.push({ address: adresse, reason: raison });
  }
  return { kept, rejected };
}
