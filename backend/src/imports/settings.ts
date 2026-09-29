import { z } from 'zod';
import { normalizeTags } from '../companies/normalize.js';

/**
 * Parametres d'un import, etape 4 du parcours (section 5).
 *
 * Ils sont fixes a l'arrivee et ne bougent plus : le pipeline des phases
 * suivantes les relit a chaque etape, et un import doit etre traite selon ce
 * que l'utilisateur a choisi en le lancant, pas selon ce qu'il aurait change
 * depuis.
 *
 * Cette liste existe aussi dans `frontend/src/lib/import-settings.ts`. Les deux
 * doivent rester identiques, pour la meme raison que les champs reconnus
 * (voir `fields.ts`).
 */

/** F-402 : rapide 3 pages, standard 10, approfondie 25. */
export const CRAWL_DEPTHS = ['quick', 'standard', 'deep'] as const;

/** Les cinq types proposes a l'etape 4, parmi ceux de la section 6.8. */
export const EMAIL_TYPES = ['recruitment', 'hr', 'generic', 'sales', 'press'] as const;

/**
 * Fournisseurs que l'utilisateur peut refuser : la recherche du site officiel
 * (D-07) et l'enrichissement (D-08). Le site de l'entreprise, lui, est
 * toujours explore : c'est gratuit et c'est la source principale.
 */
export const PROVIDERS = ['brave', 'hunter'] as const;

/**
 * F-702 : verification de boite par le fournisseur. « Jamais » par defaut :
 * elle coute un demi-credit par adresse, sur 20 credits par mois (D-08).
 */
export const MAILBOX_CHECKS = ['never', 'found', 'all'] as const;

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

export const importSettingsSchema = z
  .object({
    depth: z.enum(CRAWL_DEPTHS).default('standard'),
    emailTypes: z
      .array(z.enum(EMAIL_TYPES))
      .min(1)
      .max(EMAIL_TYPES.length)
      .default(['recruitment', 'hr', 'generic'])
      .transform((types) => [...new Set(types)]),
    providers: z
      .array(z.enum(PROVIDERS))
      .max(PROVIDERS.length)
      .default(['brave', 'hunter'])
      .transform((fournisseurs) => [...new Set(fournisseurs)]),
    mailboxCheck: z.enum(MAILBOX_CHECKS).default('never'),
    tags: z
      .array(z.string().max(MAX_TAG_LENGTH))
      .max(MAX_TAGS)
      .default([])
      // Meme regle que la colonne « Etiquettes » du fichier : minuscules,
      // sans espace autour, sans doublon. Sans cela, « Lyon » applique ici et
      // « lyon » lu dans le fichier seraient deux etiquettes.
      .transform((etiquettes) => normalizeTags(etiquettes.join(','))),
  })
  // Une cle inconnue est refusee plutot qu'ignoree : les reglages sont
  // enregistres tels quels, et rien ne doit y entrer que le pipeline ne
  // saurait pas lire.
  .strict();

export type ImportSettings = z.infer<typeof importSettingsSchema>;

/**
 * Relit les etiquettes des reglages enregistres. Un import cree avant ce lot
 * n'en a pas, et c'est le cas normal, pas une erreur.
 */
export function readSettingsTags(settings: unknown): string[] {
  if (typeof settings !== 'object' || settings === null) return [];
  const etiquettes = (settings as { tags?: unknown }).tags;
  if (!Array.isArray(etiquettes)) return [];
  return etiquettes.filter((valeur): valeur is string => typeof valeur === 'string');
}

/**
 * Relit les reglages enregistres d'un import. Les colonnes du fichier y sont
 * rangees aussi : elles sont ecartees avant la validation, stricte. Un import
 * plus ancien que ce lot, ou abime, prend les valeurs par defaut plutot que
 * de bloquer le pipeline.
 */
export function readStoredSettings(settings: unknown): ImportSettings {
  const brut = typeof settings === 'object' && settings !== null ? settings : {};
  const { depth, emailTypes, providers, tags, mailboxCheck } = brut as Record<string, unknown>;
  const lu = importSettingsSchema.safeParse(
    Object.fromEntries(
      Object.entries({ depth, emailTypes, providers, tags, mailboxCheck }).filter(
        ([, v]) => v !== undefined,
      ),
    ),
  );
  return lu.success ? lu.data : importSettingsSchema.parse({});
}
