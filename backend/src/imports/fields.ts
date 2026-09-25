/**
 * Champs reconnus dans un fichier d'import (6.2 du cahier des charges).
 *
 * Cette liste existe aussi dans `frontend/src/lib/column-mapping.ts`, qui
 * propose la correspondance. Les deux doivent rester identiques. Elles ne sont
 * pas partagees parce que le depot n'a pas encore de paquet commun (D-02) ;
 * le jour ou l'API publique aura un client, ce sera le bon moment pour en
 * creer un, et ce couple de listes sera le premier a y entrer.
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

/** Une ligne doit porter au moins un de ces quatre champs (F-202). */
export const IDENTIFYING_FIELDS: readonly KnownField[] = [
  'company_name',
  'domain',
  'website_url',
  'careers_url',
];

export function isKnownField(value: string): value is KnownField {
  return (KNOWN_FIELDS as readonly string[]).includes(value);
}
