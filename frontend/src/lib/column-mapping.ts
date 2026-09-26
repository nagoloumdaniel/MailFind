/**
 * Rapprochement des colonnes du fichier avec les champs que MailFind connait
 * (F-203). La proposition est automatique, et l'utilisateur la corrige : elle
 * n'a pas besoin d'etre parfaite, elle a besoin d'etre juste assez bonne pour
 * qu'il n'y ait rien a changer la plupart du temps.
 */

export const KNOWN_FIELDS = [
  'company_name',
  'domain',
  'website_url',
  'careers_url',
  'city',
  'country',
  'siren',
  'industry',
  'contact_name',
  'tags',
  'notes',
] as const;

export type KnownField = (typeof KNOWN_FIELDS)[number];

/**
 * Une ligne doit porter au moins un de ces quatre champs, sinon il n'y a rien
 * a chercher (F-202).
 */
export const IDENTIFYING_FIELDS: readonly KnownField[] = [
  'company_name',
  'domain',
  'website_url',
  'careers_url',
];

/** Libelles affiches, en francais, dans l'ordre d'importance. */
export const FIELD_LABELS: Record<KnownField, string> = {
  company_name: "Nom de l'entreprise",
  domain: 'Domaine',
  website_url: 'Site web',
  careers_url: 'Page carrieres',
  city: 'Ville',
  country: 'Pays',
  siren: 'SIREN',
  industry: 'Secteur',
  contact_name: 'Nom du contact',
  tags: 'Etiquettes',
  notes: 'Notes',
};

/**
 * En-tetes reconnus, francais et anglais. La liste est volontairement large :
 * une colonne mal devinee coute un clic, une colonne non devinee coute une
 * lecture attentive de tout l'ecran.
 */
const ALIASES: Record<KnownField, readonly string[]> = {
  company_name: [
    'entreprise',
    'entreprises',
    'societe',
    'societes',
    'raison sociale',
    'nom',
    'nom entreprise',
    'nom de l entreprise',
    'company',
    'company name',
    'organisation',
    'organization',
    'name',
  ],
  domain: ['domaine', 'domain', 'nom de domaine', 'domain name'],
  website_url: [
    'site',
    'site web',
    'site internet',
    'website',
    'web',
    'url',
    'url du site',
    'lien',
    'website url',
  ],
  careers_url: [
    'carrieres',
    'carriere',
    'page carrieres',
    'recrutement',
    'emploi',
    'emplois',
    'offres',
    'careers',
    'careers url',
    'jobs',
    'jobs url',
  ],
  city: ['ville', 'commune', 'city', 'town', 'localite'],
  country: ['pays', 'country'],
  siren: ['siren', 'siret', 'numero siren', 'numero siret'],
  industry: ['secteur', 'secteur d activite', 'activite', 'industry', 'sector', 'domaine activite'],
  contact_name: [
    'contact',
    'nom du contact',
    'nom contact',
    'interlocuteur',
    'contact name',
    'full name',
    'prenom nom',
  ],
  tags: ['etiquettes', 'etiquette', 'tags', 'tag', 'labels', 'mots cles'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'remarque', 'remarques', 'comment'],
};

/**
 * Reduit un en-tete a sa forme comparable : sans accents, sans casse, sans
 * ponctuation de separation. « Nom de l'entreprise », « nom_de_l_entreprise »
 * et « NOM DE L ENTREPRISE » doivent tomber sur la meme chose.
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Un champ par colonne, ou null quand la colonne n'est pas reconnue. */
export type Mapping = readonly (KnownField | null)[];

export function suggestMapping(headers: readonly string[]): Mapping {
  const pris = new Set<KnownField>();

  return headers.map((header) => {
    const normalise = normalizeHeader(header);
    if (normalise === '') return null;

    for (const champ of KNOWN_FIELDS) {
      // Un champ deja attribue n'est pas repris : deux colonnes « site » dans
      // le meme fichier, c'est la premiere qui compte, la seconde devient un
      // attribut libre plutot que d'ecraser silencieusement la premiere.
      if (pris.has(champ)) continue;
      if (ALIASES[champ].includes(normalise)) {
        pris.add(champ);
        return champ;
      }
    }

    return null;
  });
}

/** Les colonnes non reconnues sont gardees comme attributs libres (F-204). */
export function freeColumns(headers: readonly string[], mapping: Mapping): readonly string[] {
  return headers.filter((header, index) => mapping[index] === null && header.trim() !== '');
}

/**
 * Le fichier est exploitable si au moins une colonne identifie une entreprise.
 * Sans cela, aucune ligne ne pourra l'etre non plus.
 */
export function mappingCanIdentify(mapping: Mapping): boolean {
  return mapping.some((champ) => champ !== null && IDENTIFYING_FIELDS.includes(champ));
}

export interface RowView {
  readonly line: number;
  readonly values: Partial<Record<KnownField, string>>;
  readonly attributes: Record<string, string>;
  /** Motif de rejet, absent quand la ligne est exploitable (F-202). */
  readonly rejection?: string;
}

/**
 * Traduit une ligne brute en ce qui sera reellement traite, telle qu'elle doit
 * apparaitre dans la previsualisation des dix premieres lignes (etape 3 du
 * parcours).
 */
export function describeRow(
  headers: readonly string[],
  mapping: Mapping,
  row: readonly string[],
  line: number,
): RowView {
  const values: Partial<Record<KnownField, string>> = {};
  const attributes: Record<string, string> = {};

  headers.forEach((header, index) => {
    const valeur = (row[index] ?? '').trim();
    if (valeur === '') return;

    const champ = mapping[index];
    if (champ === null || champ === undefined) {
      if (header.trim() !== '') attributes[header.trim()] = valeur;
      return;
    }
    values[champ] = valeur;
  });

  const rejection = rejectionOf(values);
  return { line, values, attributes, ...(rejection === undefined ? {} : { rejection }) };
}

/**
 * Les deux motifs de rejet du serveur (`backend/src/imports/validate.ts`),
 * avec les memes mots. L'apercu annonce les lignes « telles qu'elles seront
 * traitees » : s'il en laissait passer une que le serveur ecarte, il mentirait
 * sur ce qu'il montre.
 */
function rejectionOf(values: Partial<Record<KnownField, string>>): string | undefined {
  if (IDENTIFYING_FIELDS.every((champ) => (values[champ] ?? '') === '')) {
    return "Aucun nom d'entreprise, domaine, site ou page carrieres : rien a chercher sur cette ligne.";
  }

  const { company_name: nom, domain: domaine, website_url: site, careers_url: carrieres } = values;
  const nomUtile = nom !== undefined && foldName(nom) !== '';
  const adresseUtile = [domaine, site, carrieres].some(
    (valeur) => valeur !== undefined && usableDomain(valeur) !== undefined,
  );
  if (nomUtile || adresseUtile) return undefined;

  const fautif = domaine ?? site ?? carrieres ?? '';
  return fautif === ''
    ? "Le nom d'entreprise est vide apres nettoyage."
    : `« ${fautif.slice(0, 80)} » n'est pas un domaine ni une adresse de site exploitable.`;
}

/** Ce qui reste d'un nom une fois accents, ponctuation et espaces retires. */
function foldName(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Le domaine qu'une saisie designe, ou `undefined` si elle n'en designe pas.
 * Meme regle que `normalizeDomain` cote serveur : http ou https seulement,
 * pas d'identifiants, pas d'adresse IP, une extension alphabetique.
 */
export function usableDomain(input: string): string | undefined {
  const brut = input.trim();
  if (brut === '') return undefined;

  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(brut);
  if (schema !== null && !/^https?$/i.test(schema[1] ?? '')) return undefined;

  const avecProtocole = /^https?:\/\//i.test(brut) ? brut : `https://${brut}`;
  let hote: string;
  try {
    const url = new URL(avecProtocole);
    if (url.username !== '' || url.password !== '') return undefined;
    // Le navigateur rend deja un domaine internationalise en punycode.
    hote = url.hostname.replace(/\.$/, '');
  } catch {
    return undefined;
  }

  const sansWww = hote.startsWith('www.') ? hote.slice(4) : hote;
  if (IPV4.test(sansWww) || sansWww.includes(':')) return undefined;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(sansWww)) return undefined;
  if (sansWww.includes('..') || sansWww.startsWith('-') || sansWww.startsWith('.')) {
    return undefined;
  }
  return sansWww;
}
