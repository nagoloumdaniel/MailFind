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
  { to: '/compte', label: 'Compte', end: false },
];

export function AppLayout() {
  const { state } = useSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 text-text">
            <Logo size={24} title="MailFind" />
            <span className="text-[15px] font-semibold" style={{ fontStretch: '115%' }}>
              MailFind
            </span>
          </NavLink>

          <nav aria-label="Navigation principale" className="flex items-center gap-1">
            {DESTINATIONS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm ${
                    isActive
                      ? 'bg-raised font-medium text-text'
                      : 'text-text-soft hover:bg-raised hover:text-text'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
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
