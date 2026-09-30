import type { Router } from 'express';
import type { ExportStorage } from '../../exports/storage.js';
import type { Enqueue } from '../../pipeline/start.js';
import type { VerifyDeps } from '../../pipeline/verify.js';
import type { MailDns } from '../../verification/local.js';
import { registerCompanies } from './companies.js';
import { registerEmails } from './emails.js';
import { registerExports } from './exports.js';
import { registerFind } from './find.js';
import { registerImports } from './imports.js';
import { registerIntegrations } from './integrations.js';
import { registerUsage } from './usage.js';
import { registerVerify } from './verify.js';
import { registerWebhooks } from './webhooks.js';
import type { Cipher } from '../../security/crypto.js';

export interface V1Deps {
  /** La file des etapes par entreprise ; les tests la remplacent par une liste. */
  readonly enqueue: Enqueue;
  /** Verification des adresses modifiees, construite au premier besoin. */
  readonly verifyDeps: () => VerifyDeps;
  /** Ou deposer les exports, et leur mise en file. */
  readonly exportStorage: () => ExportStorage | undefined;
  readonly enqueueExport: (exportId: string, userId: string) => Promise<void>;
  /** Le DNS de la verification d'une liste ; simule dans les tests. */
  readonly dns?: MailDns;
  /** Le chiffrement des secrets de webhook (S-01). */
  readonly cipher: () => Cipher | undefined;
  /** La mise en file d'un envoi vers Campaign Mailer. */
  readonly enqueuePush: (pushId: string) => Promise<void>;
}

/** Les points d'acces de l'API publique (6.13), montes apres les conventions communes. */
export function registerV1Routes(router: Router, deps: V1Deps): void {
  registerImports(router);
  registerFind(router);
  registerCompanies(router, deps.enqueue);
  registerEmails(router, deps.verifyDeps);
  registerVerify(router, deps.dns === undefined ? {} : { dns: deps.dns });
  registerExports(router, { storage: deps.exportStorage, enqueue: deps.enqueueExport });
  registerWebhooks(router, deps.cipher);
  registerIntegrations(router, deps.enqueuePush);
  registerUsage(router);
}
