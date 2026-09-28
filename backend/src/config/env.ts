import { z } from 'zod';

/**
 * Configuration lue une seule fois, validee au demarrage. Une variable absente
 * ou mal formee arrete le processus tout de suite, avec la liste de ce qui
 * manque, plutot que de produire une panne obscure au premier appel.
 *
 * Ce schema ne declare que les variables reellement utilisees a ce stade. Il
 * grandit avec chaque lot : une variable declaree mais inutilisee est une
 * promesse que rien ne tient.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Origine de l'application web. Seule origine acceptee par CORS. */
  APP_URL: z.string().min(1),
  /** Origine publique de l'API, utilisee dans les redirections. */
  API_URL: z.string().min(1),

  /** Hote groupe, pour l'application. Passe par pgbouncer. */
  DATABASE_URL: z.string().min(1),
  /**
   * Hote direct, pour les migrations. pgbouncer ne sait pas tenir un verrou
   * consultatif ni un ordre DDL dans une transaction longue.
   */
  DIRECT_DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().min(1),
  REDIS_SESSION_PREFIX: z.string().min(1).default('mailfind:sess:'),
  /**
   * Prefixe des cles BullMQ. Obligatoire meme sur une base dediee, pour que la
   * regle tienne encore le jour ou la base changerait (D-05).
   */
  BULLMQ_PREFIX: z.string().min(1).default('mailfind:bull'),

  /**
   * Signature du cookie de session. Trente-deux caracteres au moins : plus
   * court, il se devine.
   */
  SESSION_SECRET: z.string().min(32),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().min(1),

  /**
   * L'agent de collecte s'annonce et donne une adresse de contact (F-404). Ne
   * jamais se faire passer pour un navigateur : un site doit pouvoir nous
   * reconnaitre, nous ecrire et nous exclure.
   */
  CRAWLER_USER_AGENT: z.string().min(1).default('MailFindBot/0.1 (+https://mailfind.app/bot)'),
  /** F-405 : une requete a la fois par domaine, une seconde entre deux. */
  CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN: z.coerce.number().positive().max(10).default(1),
  CRAWLER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CRAWLER_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(2_000_000),
  /** Redirections hors du domaine, F-405. */
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(2),

  /**
   * Chiffrement au repos (S-01), 32 octets en hexadecimal. Vide, les
   * fournisseurs d'enrichissement restent desactives : leurs reponses
   * contiennent des adresses nominatives et ne sont gardees que chiffrees.
   */
  ENCRYPTION_KEY: z.string().default(''),
  /** L'ancienne cle, gardee le temps d'une rotation pour dechiffrer ce qu'elle a chiffre. */
  ENCRYPTION_KEY_PREVIOUS: z.string().default(''),

  /** Identification legale des entreprises francaises (D-10). Gratuite, sans cle. */
  RECHERCHE_ENTREPRISES_BASE_URL: z
    .string()
    .min(1)
    .default('https://recherche-entreprises.api.gouv.fr'),

  /**
   * Recherche du site officiel (D-07). Vide, la recherche web est desactivee :
   * seules les entreprises importees avec leur domaine ou leur site sont
   * explorees.
   */
  BRAVE_SEARCH_API_KEY: z.string().default(''),
  BRAVE_SEARCH_BASE_URL: z.string().min(1).default('https://api.search.brave.com'),
  /** Enrichissement (D-08). Vide, Hunter n'est jamais appele. */
  HUNTER_API_KEY: z.string().default(''),
  HUNTER_BASE_URL: z.string().min(1).default('https://api.hunter.io'),
  /** D-14 : recherches par domaine, par utilisateur et par mois. */
  QUOTA_PROVIDER_SEARCHES_PER_USER_PER_MONTH: z.coerce.number().int().min(0).default(3),
  /** D-13, D-14 : les 30 credits mensuels de Hunter reserves a la recherche. */
  HUNTER_MONTHLY_SEARCH_CREDITS: z.coerce.number().int().min(0).default(30),
  /** D-14 : verifications de boite, par utilisateur et par mois (un demi-credit chacune). */
  QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH: z.coerce.number().int().min(0).default(4),
  /** D-13, D-14 : les 20 credits mensuels de Hunter reserves a la verification. */
  HUNTER_MONTHLY_VERIFICATION_CREDITS: z.coerce.number().int().min(0).default(20),
  /** F-603 : ordre de repli des fournisseurs, separes par des virgules. */
  PROVIDER_ORDER: z.string().default('hunter'),

  /** Niveau 4 de 6.7 : liste publique des domaines jetables, rechargee chaque semaine. */
  DISPOSABLE_DOMAINS_URL: z
    .string()
    .min(1)
    .default(
      'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf',
    ),

  /** D-14 : recherches de site officiel par utilisateur et par mois. */
  QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH: z.coerce.number().int().min(0).default(80),
  /**
   * D-13 : aucun appel payant. Au-dela des requetes offertes chaque mois par
   * Brave, la recherche s'arrete pour tout le monde, jusqu'au mois suivant.
   */
  BRAVE_MONTHLY_FREE_QUERIES: z.coerce.number().int().min(0).default(1000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide dans backend/.env\n${details}`);
  }

  return result.data;
}

let cached: Environment | undefined;

/** La configuration du processus. Memorisee pour rester coherente partout. */
export function getEnvironment(): Environment {
  cached ??= parseEnvironment();
  return cached;
}
