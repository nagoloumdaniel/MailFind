import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signature des webhooks (F-1308, S-10), a la maniere de Stripe :
 *
 *   MailFind-Signature: t=1790700000,v1=5f2b...
 *
 * `v1` est le HMAC-SHA256, en hexadecimal, de `t` suivi d'un point et du
 * corps exact, avec le secret de l'abonnement. L'horodatage est signe avec le
 * corps : un corps intercepte et rejoue plus tard porte un `t` trop ancien,
 * que le destinataire refuse.
 */

export const SIGNATURE_HEADER = 'MailFind-Signature';
/** Ecart admis entre `t` et l'horloge du destinataire, en secondes. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function hmac(secret: string, horodatage: number, corps: string): string {
  return createHmac('sha256', secret)
    .update(`${String(horodatage)}.${corps}`, 'utf8')
    .digest('hex');
}

export function signWebhook(secret: string, corps: string, maintenant = new Date()): string {
  const horodatage = Math.floor(maintenant.getTime() / 1000);
  return `t=${String(horodatage)},v1=${hmac(secret, horodatage, corps)}`;
}

/** Ce que fait un destinataire : l'en-tete correspond-il au corps, et est-il recent ? */
export function verifyWebhookSignature(
  secret: string,
  corps: string,
  entete: string,
  maintenant = new Date(),
): boolean {
  const morceaux = new Map(
    entete.split(',').map((m) => {
      const [cle, ...valeur] = m.trim().split('=');
      return [cle ?? '', valeur.join('=')] as const;
    }),
  );
  const horodatage = Number(morceaux.get('t'));
  const signature = morceaux.get('v1') ?? '';
  if (!Number.isInteger(horodatage)) return false;
  if (Math.abs(maintenant.getTime() / 1000 - horodatage) > SIGNATURE_TOLERANCE_SECONDS)
    return false;
  const attendue = Buffer.from(hmac(secret, horodatage, corps), 'hex');
  const recue = Buffer.from(signature, 'hex');
  return recue.length === attendue.length && timingSafeEqual(recue, attendue);
}
