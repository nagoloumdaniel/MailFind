import type { CompanyDraft } from '../imports/validate.js';

/**
 * Ce qu'un nouveau brouillon apporte a une entreprise deja connue.
 *
 * Regle unique : on complete, on n'ecrase pas. Une seconde ligne qui parle de
 * la meme entreprise peut apporter un SIREN ou une ville qui manquaient, mais
 * elle n'a aucune raison d'etre plus juste que la premiere sur ce qui est deja
 * rempli. Les etiquettes font exception : elles s'additionnent, parce qu'elles
 * expriment l'intention de l'utilisateur, pas un fait sur l'entreprise.
 */
export interface ExistingCompany {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly domain: string | null;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly siren: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly industry: string | null;
  readonly notes: string | null;
  readonly tags: readonly string[];
  readonly attributes: Record<string, unknown>;
}

export interface CompanyPatch {
  readonly domain?: string;
  readonly websiteUrl?: string;
  readonly careersUrl?: string;
  readonly siren?: string;
  readonly city?: string;
  readonly country?: string;
  readonly industry?: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
  readonly attributes?: Record<string, unknown>;
}

function complete(
  patch: Record<string, unknown>,
  cle: string,
  existant: string | null,
  apporte: string | undefined,
): void {
  if (existant === null && apporte !== undefined) patch[cle] = apporte;
}

/** Rend les seuls champs a ecrire. Un objet vide signifie « rien a faire ». */
export function mergeDraft(existing: ExistingCompany, draft: CompanyDraft): CompanyPatch {
  const patch: Record<string, unknown> = {};

  complete(patch, 'domain', existing.domain, draft.domain);
  complete(patch, 'websiteUrl', existing.websiteUrl, draft.websiteUrl);
  complete(patch, 'careersUrl', existing.careersUrl, draft.careersUrl);
  complete(patch, 'siren', existing.siren, draft.siren);
  complete(patch, 'city', existing.city, draft.city);
  complete(patch, 'country', existing.country, draft.country);
  complete(patch, 'industry', existing.industry, draft.industry);
  complete(patch, 'notes', existing.notes, draft.notes);

  const etiquettes = new Set(existing.tags);
  const avant = etiquettes.size;
  for (const etiquette of draft.tags) etiquettes.add(etiquette);
  if (etiquettes.size !== avant) patch.tags = [...etiquettes];

  // Les attributs libres se completent cle par cle, sans ecraser une valeur
  // deja connue : la premiere ligne reste la reference.
  const nouveaux: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(draft.attributes)) {
    if (!(cle in existing.attributes)) nouveaux[cle] = valeur;
  }
  if (Object.keys(nouveaux).length > 0) {
    patch.attributes = { ...existing.attributes, ...nouveaux };
  }

  return patch;
}
