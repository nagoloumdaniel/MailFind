import { describeApp } from './app-info.js';

// L'API Express, les journaux pino et les files BullMQ arrivent en Phase 1.
// Ce point d'entree existe des la Phase 0 pour que la chaine complete
// (compilation, demarrage, deploiement) soit verifiable avant le premier
// morceau de logique metier.
process.stdout.write(`${describeApp()} : socle pret, API a venir en Phase 1.\n`);
