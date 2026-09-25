import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node suffit : ce qui est teste ici est de la logique pure, lecture de
    // fichier et correspondance de colonnes. Les composants React viendront
    // avec leur propre environnement le jour ou ils seront testes.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
