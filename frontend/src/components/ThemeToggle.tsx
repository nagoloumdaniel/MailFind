import { useState } from 'react';
import { applyThemeChoice, readThemeChoice, resolveTheme } from '../lib/theme';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="4.2" strokeWidth="1.6" />
      <g strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
        <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4z"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Un seul bouton, qui bascule vers l'autre theme et montre l'icone de ce vers
 * quoi il va : la lune quand on est en clair, le soleil quand on est en
 * sombre. Aucune legende n'est necessaire.
 *
 * Le troisieme etat, celui du systeme, reste la valeur de depart. Il
 * disparait au premier clic, parce qu'a partir de la l'utilisateur a decide.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => resolveTheme(readThemeChoice()));
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Passer au theme sombre' : 'Passer au theme clair';

  return (
    <button
      type="button"
      onClick={() => {
        applyThemeChoice(next);
        setTheme(next);
      }}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-text-soft transition-colors hover:bg-raised hover:text-text"
    >
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
