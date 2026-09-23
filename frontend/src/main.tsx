import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { router } from './app/router';
import { applyThemeChoice, readThemeChoice } from './lib/theme';
import { SessionProvider } from './lib/SessionProvider';

// Avant le premier rendu : appliquer le theme apres coup ferait clignoter la
// page en clair chez qui a choisi le sombre.
applyThemeChoice(readThemeChoice());

const container = document.getElementById('root');

if (!container) {
  throw new Error("L'element racine #root est absent de index.html.");
}

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
