import { getEnvironment } from '../config/env.js';
import { createHunterVerifier } from '../providers/hunter.js';
import { createCipher, type Cipher } from '../security/crypto.js';
import { createDisposableCache } from '../verification/disposable.js';
import { createMailDns } from '../verification/local.js';
import type { VerifyDeps } from './verify.js';

/** La cle de chiffrement au repos, ou rien si elle n'est pas configuree (F-604). */
export function createConfiguredCipher(): Cipher | undefined {
  const environment = getEnvironment();
  return environment.ENCRYPTION_KEY === ''
    ? undefined
    : createCipher(environment.ENCRYPTION_KEY, environment.ENCRYPTION_KEY_PREVIOUS);
}

/**
 * Ce que la verification demande, pour le processus de traitement comme pour
 * l'API, qui verifie une adresse saisie ou corrigee a la main.
 */
export function createVerifyDeps(cipher = createConfiguredCipher()): VerifyDeps {
  const environment = getEnvironment();
  return {
    mailDns: createMailDns(),
    disposableDomains: createDisposableCache(),
    ...(cipher === undefined ? {} : { cipher }),
    ...(cipher === undefined || environment.HUNTER_API_KEY === ''
      ? {}
      : {
          verifier: createHunterVerifier({
            apiKey: environment.HUNTER_API_KEY,
            baseUrl: environment.HUNTER_BASE_URL,
          }),
        }),
    // D-14 : les plafonds se comptent en credits, une verification en vaut un demi.
    verificationLimits: {
      perUserMonthly: environment.QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH / 2,
      globalMonthly: environment.HUNTER_MONTHLY_VERIFICATION_CREDITS,
    },
  };
}
