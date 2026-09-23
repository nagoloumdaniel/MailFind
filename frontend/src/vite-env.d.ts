/// <reference types="vite/client" />

/**
 * Variables lues par l'application. Sans cette declaration, `import.meta.env`
 * rend du `any`, et tout ce qui en descend echappe au typage.
 *
 * Rien de secret ici : tout ce qui est prefixe VITE_ part dans le navigateur.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
