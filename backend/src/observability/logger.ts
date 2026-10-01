import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import { getEnvironment } from '../config/env.js';
import { scrubText, scrubValue } from './scrub.js';

/**
 * Journaux JSON structures (section 12 du cahier des charges).
 *
 * La liste de censure n'est pas une precaution de confort : S-03 interdit
 * qu'un secret, un jeton ou une adresse email se retrouve dans un journal.
 * Tout ce qui transporte une identite est donc coupe a la source, avant meme
 * la serialisation : les chemins connus par leur nom, et tout le reste par
 * motif (observability/scrub.ts), messages et erreurs compris.
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

/**
 * La requete telle que pino-http la journalise, URL masquee : un retour de
 * connexion porte un code et un jeton d'etat dans sa chaine de requete (S-03).
 *
 * Les champs sont recopies un a un : pino rend un objet a prototype propre,
 * que le parcours generique laisse passer tel quel.
 */
export function scrubbedRequest(req: Parameters<typeof stdSerializers.req>[0]): unknown {
  const serialisee = stdSerializers.req(req);
  return scrubValue({ ...serialisee });
}

export function createLogger(destination?: DestinationStream, level?: string): Logger {
  const environment = getEnvironment();

  return pino(
    {
      level: level ?? environment.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[coupe]' },
      serializers: {
        // Le format de log (plus bas) a deja ramene l'erreur a un objet simple
        // et masque ; ce serialiseur couvre un enfant qui contournerait ce format.
        err: (erreur: Error) =>
          erreur instanceof Error ? scrubValue(erreur) : scrubValue(stdSerializers.err(erreur)),
        req: scrubbedRequest,
      },
      hooks: {
        // Le message lui-meme : `log.info('refus de %s', adresse)` ne passe
        // par aucun champ.
        logMethod(args, method) {
          const masques = args.map((argument: unknown) =>
            typeof argument === 'string' ? scrubText(argument) : argument,
          ) as Parameters<typeof method>;
          method.apply(this, masques);
        },
      },
      // En production, la sortie JSON brute part vers l'agregateur. En
      // developpement, elle reste lisible a l'oeil sans dependance
      // supplementaire.
      formatters: {
        level: (label) => ({ level: label }),
        log: (objet) => scrubValue(objet),
      },
    },
    destination,
  );
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
