import type { Router } from 'express';
import type { Enqueue } from '../../pipeline/start.js';
import type { VerifyDeps } from '../../pipeline/verify.js';
import { registerCompanies } from './companies.js';
import { registerEmails } from './emails.js';
import { registerImports } from './imports.js';
import { registerUsage } from './usage.js';

export interface V1Deps {
  /** La file des etapes par entreprise ; les tests la remplacent par une liste. */
  readonly enqueue: Enqueue;
  /** Verification des adresses modifiees, construite au premier besoin. */
  readonly verifyDeps: () => VerifyDeps;
}

/** Les points d'acces de l'API publique (6.13), montes apres les conventions communes. */
export function registerV1Routes(router: Router, deps: V1Deps): void {
  registerImports(router);
  registerCompanies(router, deps.enqueue);
  registerEmails(router, deps.verifyDeps);
  registerUsage(router);
}
