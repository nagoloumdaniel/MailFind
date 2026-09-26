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
  // « Tableau de bord » ne tient pas a cote des deux autres sur un telephone.
  { to: '/', label: 'Tableau de bord', short: 'Accueil', end: true },
  { to: '/import', label: 'Importer', short: 'Importer', end: false },
  { to: '/compte', label: 'Compte', short: 'Compte', end: false },
];

export function AppLayout() {
  const { state } = useSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        {/* Sur un telephone, le nom a cote du logo et les marges larges
            faisaient deborder la barre : la page entiere defilait de cote.
            Le logo seul suffit a dire ou l'on est. */}
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 sm:gap-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 text-text">
            <Logo size={24} title="MailFind" />
            <span className="hidden font-display text-[15px] font-semibold sm:inline">
              MailFind
            </span>
          </NavLink>

          <nav
            aria-label="Navigation principale"
            className="flex min-w-0 items-center overflow-x-auto sm:gap-1"
          >
            {DESTINATIONS.map(({ to, label, short, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-sm px-1.5 py-1.5 text-sm whitespace-nowrap sm:px-2.5 ${
                    isActive
                      ? 'bg-raised font-medium text-text'
                      : 'text-text-soft hover:bg-raised hover:text-text'
                  }`
                }
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ThemeToggle />
            {state.status === 'authenticated' && (
              <span className="hidden text-xs text-text-faint sm:inline">{state.user.email}</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8">
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
