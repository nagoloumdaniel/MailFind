import * as Sentry from '@sentry/node';
import { getEnvironment } from '../config/env.js';
import { scrubText, scrubValue } from './scrub.js';

/**
 * Rapport d'erreurs vers Sentry, pour l'API et le processus de traitement.
 *
 * Inactif sans SENTRY_DSN : chaque appel ci-dessous ne fait alors rien, et
 * c'est ainsi que tournent le developpement et les tests.
 *
 * Ce qui part chez Sentry est ce que les journaux autorisent, pas davantage
 * (S-03). Aucune donnee personnelle par defaut, donc ni IP ni cookie ; le
 * compte reduit a son identifiant ; la requete reduite a une methode et un
 * chemin, sans chaine de requete ; et chaque texte passe par le masquage
 * d'observability/scrub.ts. Sentry est un tiers : une adresse citee par une
 * erreur de pilote ou de fournisseur n'a pas a y arriver.
 *
 * Pas de traces de performance : une incidence a besoin d'erreurs, et les
 * traces depenseraient le quota sur des requetes qui se sont bien passees.
 */
type Evenement = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0];

/** De quoi retrouver la requete ou la tache, jamais leur contenu. */
export interface ErrorContext {
  readonly service?: 'api' | 'worker';
  readonly userId?: string;
  readonly requestId?: string;
  readonly method?: string;
  readonly path?: string;
  readonly job?: string;
  readonly jobId?: string;
  readonly attempt?: number;
}

export function scrubEvent(evenement: Evenement): Evenement {
  const requete = evenement.request;
  if (requete !== undefined) {
    delete requete.cookies;
    delete requete.headers;
    delete requete.data;
    delete requete.query_string;
    if (requete.url !== undefined) requete.url = requete.url.split('?')[0] ?? '';
  }

  // Un identifiant de compte, rien d'autre : ni adresse, ni IP.
  if (evenement.user !== undefined) {
    evenement.user = evenement.user.id === undefined ? {} : { id: evenement.user.id };
  }

  if (evenement.message !== undefined) evenement.message = scrubText(evenement.message);
  for (const exception of evenement.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubText(exception.value);
  }
  if (evenement.breadcrumbs !== undefined) {
    evenement.breadcrumbs = evenement.breadcrumbs.map((miette) => scrubValue({ ...miette }));
  }
  if (evenement.extra !== undefined) evenement.extra = scrubValue({ ...evenement.extra });

  return evenement;
}

let actif = false;

/** A appeler une fois au demarrage de l'API et du processus de traitement. */
export function initErrorReporting(service: 'api' | 'worker'): void {
  const environment = getEnvironment();
  if (environment.SENTRY_DSN === '' || actif) return;

  Sentry.init({
    dsn: environment.SENTRY_DSN,
    environment: environment.NODE_ENV,
    // Railway le pose a chaque deploiement : chaque erreur porte le commit.
    ...(environment.RAILWAY_GIT_COMMIT_SHA === ''
      ? {}
      : { release: environment.RAILWAY_GIT_COMMIT_SHA }),
    // Jamais d'IP, de cookie ni de corps de requete : S-03 avant tout confort
    // de diagnostic.
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: (miette) => scrubValue({ ...miette }),
  });
  actif = true;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!actif) return;
  Sentry.withScope((scope) => {
    const { userId, ...reste } = context;
    if (userId !== undefined) scope.setUser({ id: userId });
    for (const [cle, valeur] of Object.entries(reste)) {
      if (valeur !== undefined) scope.setTag(cle, String(valeur));
    }
    Sentry.captureException(error);
  });
}

/** Attend l'envoi des erreurs en attente, a l'arret du processus. */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (actif) await Sentry.flush(timeoutMs);
}
