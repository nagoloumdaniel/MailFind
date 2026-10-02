import { defineConfig } from 'vitest/config';

/**
 * La couverture, mesuree sur les deux suites a la fois.
 *
 * Separement, les chiffres mentent dans les deux sens : les tests unitaires ne
 * voient pas ce qui parle a la base, et les tests d'integration ne voient pas
 * la logique pure. Ce qui compte est ce que l'ensemble des tests prouve, donc
 * tout tourne ici, sur le schema jetable des tests d'integration.
 *
 *   npm run test:coverage
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/integration/global-setup.ts'],
    setupFiles: ['./src/test/integration/setup-env.ts'],
    // Une seule base pour toute la suite, comme en integration.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Le banc d'essai des tests, et les points d'entree : demarrer un
        // serveur ou un processus de traitement ne se teste pas en les
        // important, cela ouvrirait des connexions.
        'src/test/**',
        'src/index.ts',
        'src/worker.ts',
        'src/scripts/**',
        'src/db/migrate.ts',
      ],
      /**
       * Les seuils sont poses sous le niveau atteint, pas au-dessus : ils
       * servent a empecher une regression, pas a fixer un objectif que
       * personne ne tiendrait. La roadmap demande 70 % au global et 90 % dans
       * les services ; le global est largement au-dessus, donc le plancher
       * suit.
       *
       * Les « services » de MailFind sont ses modules de domaine : ceux qui
       * decident ce qu'est une adresse, ce qu'elle vaut, et ce qu'on a le
       * droit d'en faire. Les modules de bordure (demarrage, client R2,
       * strategie Google, Sentry) sont sous le global : ils ne se testent
       * qu'en les executant pour de vrai, ce que fait le parcours de bout en
       * bout.
       */
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 75,

        'src/emails/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/providers/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
        'src/crawler/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
        'src/contacts/**': { lines: 90, statements: 90, functions: 85, branches: 75 },
        'src/companies/**': { lines: 90, statements: 85, functions: 85, branches: 75 },
        'src/campaign-mailer/**': { lines: 90, statements: 85, functions: 90, branches: 65 },
        'src/api/v1/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
        'src/quotas/**': { lines: 90, statements: 85, functions: 85, branches: 70 },

        'src/verification/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
      },
    },
  },
});
