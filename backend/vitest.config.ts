import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup-env.ts'],

    // Les valeurs par defaut de Vitest, 5 et 10 secondes, sont trop serrees
    // pour un demarrage a froid : deux fichiers de tests ont expire le meme
    // jour, au meme instant, pendant qu'un telechargement occupait le disque,
    // et sont repasses verts quatre fois de suite ensuite. Aucun test ici ne
    // sort du processus, donc un vrai blocage echouera quand meme, seulement
    // plus tard. Ce qui est evite, c'est le rouge qui ne veut rien dire.
    testTimeout: 15_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
