import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { TableSkeleton } from '../components/Skeleton';
import { fetchImports, STATUS_LABELS, type ImportSummary } from '../lib/imports';
import { useSession } from '../lib/session';

/**
 * Le tableau de bord reel (F-1001 : entreprises, adresses par statut, imports
 * en cours, credits du mois) arrive en Phase 6, quand ces chiffres existeront.
 * En attendant, l'ecran dit ce qui est vrai : les imports lances, et rien de
 * plus. Annoncer une bibliotheque vide a quelqu'un qui vient d'importer cinq
 * cents entreprises serait faux.
 */
const IMPORTS_AFFICHES = 10;

export function DashboardPage() {
  const { state } = useSession();
  const prenom = state.status === 'authenticated' ? (state.user.name?.split(' ')[0] ?? null) : null;
  const [imports, setImports] = useState<ImportSummary[] | undefined>(undefined);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let actif = true;
    fetchImports()
      .then((lus) => {
        if (actif) setImports(lus);
      })
      .catch(() => {
        if (actif) setErreur(true);
      });
    return () => {
      actif = false;
    };
  }, []);

  const lienImporter = (
    <Link
      to="/import"
      className="inline-flex items-center rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
    >
      Importer un fichier
    </Link>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {prenom === null ? 'Tableau de bord' : `Bonjour ${prenom}`}
      </h1>

      {erreur && (
        <p role="alert" className="mt-4 text-sm text-negative">
          Vos imports n&apos;ont pas pu etre charges. Rechargez la page dans un instant.
        </p>
      )}

      {imports === undefined && !erreur && (
        <div className="mt-8">
          <TableSkeleton rows={3} />
        </div>
      )}

      {imports?.length === 0 && (
        <>
          <p className="mt-2 max-w-[62ch] text-sm text-text-soft">
            Votre bibliotheque est vide. Elle se remplira a partir d&apos;un fichier CSV
            d&apos;entreprises : noms, domaines, sites web ou pages carrieres.
          </p>
          <div className="mt-8">
            <EmptyState
              title="Aucune entreprise pour l'instant"
              action={lienImporter}
              description="Deposez un fichier CSV d'entreprises. MailFind identifiera chaque societe et son domaine officiel, puis cherchera les adresses publiees sur son site."
            />
          </div>
        </>
      )}

      {imports !== undefined && imports.length > 0 && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Imports recents</h2>
            {lienImporter}
          </div>
          <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-raised text-xs text-text-faint">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Fichier
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Etat
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Lignes retenues
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Lance le
                  </th>
                </tr>
              </thead>
              <tbody>
                {imports.slice(0, IMPORTS_AFFICHES).map((importe) => (
                  <tr key={importe.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2">
                      <Link to={`/imports/${importe.id}`} className="text-accent underline">
                        {importe.filename}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-soft">{STATUS_LABELS[importe.status]}</td>
                    <td className="px-4 py-2 text-right" data-numeric>
                      {importe.acceptedRows.toLocaleString('fr-FR')} sur{' '}
                      {importe.totalRows.toLocaleString('fr-FR')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-text-soft">
                      {new Date(importe.createdAt).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
