import type { Router } from 'express';
import type { Enqueue } from '../../pipeline/start.js';
import { registerCompanies } from './companies.js';
import { registerImports } from './imports.js';
import { registerUsage } from './usage.js';

export interface V1Deps {
  /** La file des etapes par entreprise ; les tests la remplacent par une liste. */
  readonly enqueue: Enqueue;
}

/** Les points d'acces de l'API publique (6.13), montes apres les conventions communes. */
export function registerV1Routes(router: Router, deps: V1Deps): void {
  registerImports(router);
  registerCompanies(router, deps.enqueue);
  registerUsage(router);
}
