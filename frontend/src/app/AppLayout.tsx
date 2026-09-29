import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../lib/session';

/**
 * Barre haute plutot que rail lateral : les vues qui comptent, Entreprises et
 * Contacts, sont des tableaux larges, et chaque pixel pris a gauche est une
 * colonne perdue.
 *
 * La navigation ne montre que des destinations qui existent. Un onglet vers un
 * ecran a venir serait une promesse que le produit ne tient pas encore.
 */
const DESTINATIONS = [
  { to: '/', label: 'Tableau de bord', end: true },
  { to: '/entreprises', label: 'Entreprises', end: false },
  { to: '/contacts', label: 'Contacts', end: false },
  { to: '/import', label: 'Importer', end: false },
  { to: '/verifier', label: 'Verifier', end: false },
  { to: '/exports', label: 'Exports', end: false },
  { to: '/compte', label: 'Compte', end: false },
];

function lien({ isActive }: { isActive: boolean }): string {
  return `block rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap ${
    isActive ? 'bg-raised font-medium text-text' : 'text-text-soft hover:bg-raised hover:text-text'
  }`;
}

export function AppLayout() {
  const { state } = useSession();
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      {/* WCAG 2.4.1 : au clavier, sept onglets a traverser avant chaque page. */}
      <a
        href="#contenu"
        className="sr-only z-30 rounded-sm bg-surface px-3 py-2 text-sm text-text focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Aller au contenu
      </a>
      <header className="relative border-b border-line bg-surface">
        {/* Sur un telephone, les onglets passent dans un menu : cinq ne
            tiennent pas sur 360 pixels, et une barre qui defile de cote cache
            des destinations sans le dire. */}
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 lg:gap-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 text-text">
            <Logo size={24} title="MailFind" />
            <span className="font-display text-[15px] font-semibold">MailFind</span>
          </NavLink>

          <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
            {DESTINATIONS.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={lien}>
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ThemeToggle />
            {state.status === 'authenticated' && (
              <span className="hidden text-xs text-text-faint xl:inline">{state.user.email}</span>
            )}
            <button
              type="button"
              className="rounded-sm border border-line-strong px-3 py-1.5 text-sm lg:hidden"
              aria-expanded={menu}
              aria-controls="menu-principal"
              onClick={() => {
                setMenu((ouvert) => !ouvert);
              }}
            >
              Menu
            </button>
          </div>
        </div>
        {menu && (
          <nav
            id="menu-principal"
            aria-label="Navigation principale"
            className="border-t border-line bg-surface px-4 py-2 lg:hidden"
          >
            {DESTINATIONS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={lien}
                // Une destination choisie referme le menu.
                onClick={() => {
                  setMenu(false);
                }}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main
        id="contenu"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 focus:outline-none"
      >
        <Outlet />
      </main>

      <footer className="border-t border-line px-4 py-4 text-xs text-text-faint">
        <div className="mx-auto w-full max-w-[1400px]">
          MailFind conserve la source de chaque adresse, et ne presente jamais comme verifiee une
          adresse qui ne l&apos;est pas.
        </div>
      </footer>
    </div>
  );
}
