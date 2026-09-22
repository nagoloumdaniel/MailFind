/**
 * Identite de l'application, partagee par les journaux, les en-tetes et les
 * exports. Une seule source pour ces valeurs evite qu'un nom diverge d'un
 * endroit a l'autre.
 */
export const APP_NAME = 'MailFind';

export const APP_VERSION = '0.0.0';

export function describeApp(): string {
  return `${APP_NAME} ${APP_VERSION}`;
}
