import { Navigate, Outlet, useLocation } from 'react-router';
import { TableSkeleton } from '../components/Skeleton';
import { useSession } from '../lib/session';

/**
 * Trois etats, pas deux. Tant que la session n'est pas connue, on n'envoie
 * personne nulle part : rediriger pendant le chargement ferait clignoter
 * l'ecran de connexion devant quelqu'un de deja connecte.
 */
export function RequireSession() {
  const { state } = useSession();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <TableSkeleton rows={4} />
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/connexion" replace />;
  }

  // Les conditions se signent avant tout le reste (F-102), sauf sur la page
  // qui sert precisement a les signer.
  if (!state.user.termsAccepted && location.pathname !== '/conditions') {
    return <Navigate to="/conditions" replace />;
  }

  return <Outlet />;
}
