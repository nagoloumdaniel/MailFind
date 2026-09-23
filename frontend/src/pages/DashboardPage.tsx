import { EmptyState } from '../components/EmptyState';
import { useSession } from '../lib/session';

/**
 * Le tableau de bord reel (F-1001 : entreprises, adresses par statut, imports
 * en cours, credits du mois) arrive en Phase 6, quand ces chiffres existeront.
 * En attendant, l'ecran dit la verite : il n'y a rien, et l'import arrive.
 */
export function DashboardPage() {
  const { state } = useSession();
  const prenom = state.status === 'authenticated' ? (state.user.name?.split(' ')[0] ?? null) : null;

  return (
    <div>
      <h1 className="text-2xl font-bold" style={{ fontStretch: '115%' }}>
        {prenom === null ? 'Tableau de bord' : `Bonjour ${prenom}`}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-text-soft">
        Votre bibliotheque est vide. Elle se remplira a partir d&apos;un fichier CSV
        d&apos;entreprises : noms, domaines, sites web ou pages carrieres.
      </p>

      <div className="mt-8">
        <EmptyState
          title="Aucune entreprise pour l'instant"
          description="L'import CSV arrive avec la prochaine phase du produit. Il lira votre fichier, identifiera chaque entreprise et son domaine officiel, puis cherchera les adresses publiees sur son site."
        />
      </div>
    </div>
  );
}
