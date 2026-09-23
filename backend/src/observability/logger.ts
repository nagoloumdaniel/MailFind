import { pino, type Logger } from 'pino';
import { getEnvironment } from '../config/env.js';

/**
 * Journaux JSON structures (section 12 du cahier des charges).
 *
 * La liste de censure n'est pas une precaution de confort : S-03 interdit
 * qu'un secret, un jeton ou une adresse email se retrouve dans un journal.
 * Tout ce qui transporte une identite est donc coupe a la source, avant meme
 * la serialisation.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'secret',
  '*.password',
  '*.token',
  '*.secret',
];

export function createLogger(): Logger {
  const environment = getEnvironment();

  return pino({
    level: environment.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[coupe]' },
    // En production, la sortie JSON brute part vers l'agregateur. En
    // developpement, elle reste lisible a l'oeil sans dependance
    // supplementaire.
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

let cached: Logger | undefined;

/**
 * Le journal du processus, cree au premier appel. Paresseux a dessein : un
 * journal cree a l'import obligerait tout fichier de test a disposer d'une
 * configuration valide avant meme sa premiere ligne.
 */
export function getLogger(): Logger {
  cached ??= createLogger();
  return cached;
}
