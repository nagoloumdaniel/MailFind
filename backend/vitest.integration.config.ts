import { defineConfig } from 'vitest/config';

/**
 * Tests qui ont besoin d'un vrai PostgreSQL : ceux qui prouvent ce que les
 * tests unitaires ne peuvent pas voir, les index d'unicite, les transactions,
 * la reprise d'un import interrompu (F-206).
 *
 *   TEST_DATABASE_URL=postgresql://...mailfind_test?sslmode=disable npm run test:integration
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/test/integration/global-setup.ts'],
    setupFiles: ['./src/test/integration/setup-env.ts'],
    // Une seule base pour toute la suite : deux fichiers qui la videraient en
    // meme temps se marcheraient dessus.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
