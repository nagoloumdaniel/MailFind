import type { Router } from 'express';
import { registerImports } from './imports.js';
import { registerUsage } from './usage.js';

/** Les points d'acces de l'API publique (6.13), montes apres les conventions communes. */
export function registerV1Routes(router: Router): void {
  registerImports(router);
  registerUsage(router);
}
