/**
 * Theme clair, sombre, ou celui du systeme.
 *
 * Le choix vit dans le stockage local du navigateur, donc il peut revenir vide
 * en navigation privee ou avec les donnees de site bloquees : chaque lecture et
 * chaque ecriture est donc gardee, et l'absence de valeur signifie simplement
 * « comme le systeme ».
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'mailfind.theme';

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Stockage inaccessible : on suit le systeme.
  }
  return 'system';
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }

  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Le theme s'applique quand meme, il ne survivra pas au rechargement.
  }
}
