/**
 * Parametres d'un import, etape 4 du parcours.
 *
 * Meme liste que `backend/src/imports/settings.ts`, qui fait autorite : le
 * serveur refuse toute valeur qu'il ne connait pas. Ici, on ne fait que la
 * proposer et l'expliquer.
 */

export const CRAWL_DEPTHS = ['quick', 'standard', 'deep'] as const;
export type CrawlDepth = (typeof CRAWL_DEPTHS)[number];

export const EMAIL_TYPES = ['recruitment', 'hr', 'generic', 'sales', 'press'] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const PROVIDERS = ['brave', 'hunter'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ImportSettings {
  depth: CrawlDepth;
  emailTypes: EmailType[];
  providers: Provider[];
  tags: string[];
}

/** Les memes valeurs par defaut que le serveur. */
export function defaultSettings(): ImportSettings {
  return {
    depth: 'standard',
    emailTypes: ['recruitment', 'hr', 'generic'],
    providers: ['brave', 'hunter'],
    tags: [],
  };
}

/** F-402. Le nombre de pages est dit, parce que c'est lui qui fait la duree. */
export const DEPTH_OPTIONS: Record<CrawlDepth, { label: string; description: string }> = {
  quick: {
    label: 'Rapide',
    description: "Page d'accueil et page contact, 3 pages au plus par entreprise.",
  },
  standard: {
    label: 'Standard',
    description:
      'Contact, a propos, equipe, mentions legales, recrutement et presse, 10 pages au plus.',
  },
  deep: {
    label: 'Approfondie',
    description: 'Les liens internes de ces pages en plus, 25 pages au plus. Nettement plus long.',
  },
};

export const EMAIL_TYPE_LABELS: Record<EmailType, { label: string; exemples: string }> = {
  recruitment: { label: 'Recrutement', exemples: 'recrutement@, jobs@, carrieres@' },
  hr: { label: 'Ressources humaines', exemples: 'rh@, drh@, people@' },
  generic: { label: 'Generique', exemples: 'contact@, hello@, info@' },
  sales: { label: 'Commercial', exemples: 'commercial@, sales@' },
  press: { label: 'Presse', exemples: 'presse@, media@' },
};

export const PROVIDER_LABELS: Record<Provider, { label: string; description: string }> = {
  brave: {
    label: 'Recherche du site officiel',
    description:
      'Brave Search, seulement pour les lignes sans domaine ni site. Une ligne qui en porte un ne coute rien.',
  },
  hunter: {
    label: 'Enrichissement',
    description:
      "Hunter, en dernier recours, quand le site de l'entreprise n'a rien donne. Credits mensuels tres limites.",
  },
};

/** Au-dela, le serveur refuse : autant le dire avant. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 50;

/**
 * Lit la saisie des etiquettes comme le serveur lira la colonne du fichier :
 * separees par des virgules ou des points-virgules, en minuscules, sans
 * doublon. L'utilisateur voit donc exactement ce qui sera enregistre.
 */
export function parseTags(saisie: string): string[] {
  const vues = new Set<string>();
  for (const brut of saisie.split(/[;,]/)) {
    const etiquette = brut.trim().toLowerCase();
    if (etiquette !== '') vues.add(etiquette);
  }
  return [...vues];
}

/** Le motif qui empeche de lancer, ou `undefined` si tout est pret. */
export function settingsProblem(settings: ImportSettings): string | undefined {
  if (settings.emailTypes.length === 0) return "Choisissez au moins un type d'adresse.";
  if (settings.tags.length > MAX_TAGS) return `${String(MAX_TAGS)} etiquettes au plus.`;
  const longue = settings.tags.find((etiquette) => etiquette.length > MAX_TAG_LENGTH);
  if (longue !== undefined) {
    return `Une etiquette fait ${String(MAX_TAG_LENGTH)} caracteres au plus : « ${longue.slice(0, 20)}... ».`;
  }
  return undefined;
}

/** Ajoute ou retire une valeur d'une liste, dans l'ordre de reference. */
export function toggle<T extends string>(
  liste: readonly T[],
  valeur: T,
  reference: readonly T[],
): T[] {
  const choisis = new Set(liste);
  if (choisis.has(valeur)) choisis.delete(valeur);
  else choisis.add(valeur);
  return reference.filter((element) => choisis.has(element));
}
