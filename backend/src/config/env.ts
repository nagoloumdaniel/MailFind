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
