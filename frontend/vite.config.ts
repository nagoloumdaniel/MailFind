import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * L'API tourne a part en developpement, sur le port 3000. Le parcours de bout
 * en bout la lance ailleurs, et le dit par VITE_BACKEND_URL : le proxy suit,
 * plutot que d'imposer au parcours le port du developpement.
 */
const API = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    // Le proxy evite le CORS et garde les cookies de session sur la meme
    // origine que l'application.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      // L'API publique, dont la page de documentation lit le document OpenAPI.
      '/v1': { target: API, changeOrigin: true },
      // La porte du parcours de bout en bout, qui ouvre une session sans Google.
      '/e2e': { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
