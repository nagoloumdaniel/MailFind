import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../components/Button';
import { Skeleton, TableSkeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import {
  cancelImport,
  fetchImport,
  isInProgress,
  STATUS_LABELS,
  type ImportStatus,
  type ImportSummary,
  type RejectedRow,
} from '../lib/imports';

/**
 * Ce que devient un import une fois lance. La page se rafraichit seule tant
 * que quelque chose le fait avancer, et s'arrete de demander ensuite.
 *
 * La progression affichee est celle que la base enregistre lot par lot, pas
 * une estimation : une barre qui avance sans que rien ne soit fait mentirait.
 */
const RAFRAICHISSEMENT_MS = 2000;

/** Le serveur n'en rend que deux cents : au-dela, on le dit. */
const LIGNES_ECARTEES_MAX = 200;

const TONS: Record<ImportStatus, string> = {
  pending: 'border-line-strong text-text-soft',
  planning: 'border-accent/50 text-accent',
  running: 'border-accent/50 text-accent',
  completed: 'border-accent bg-accent/10 text-accent',
  cancelled: 'border-caution/50 text-caution',
  failed: 'border-negative/50 text-negative',
};

interface Etat {
  import: ImportSummary;
  rejectedRows: RejectedRow[];
}

export function ImportDetailPage() {
  const { id = '' } = useParams();
  const [etat, setEtat] = useState<Etat | undefined>(undefined);
  const [introuvable, setIntrouvable] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [confirmer, setConfirmer] = useState(false);
  const [annulation, setAnnulation] = useState(false);

  const statut = etat?.import.status;

  useEffect(() => {
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;

    async function charger() {
      try {
        const lu = await fetchImport(id);
        if (!actif) return;
        setEtat(lu);
        setErreur(undefined);
        if (isInProgress(lu.import.status)) {
          minuterie = setTimeout(() => void charger(), RAFRAICHISSEMENT_MS);
        }
      } catch (error) {
        if (!actif) return;
        if (error instanceof ApiError && error.status === 404) {
          setIntrouvable(true);
          return;
        }
        // Une coupure passagere ne doit pas arreter le suivi : on redemande,
        // plus lentement.
        setErreur("La progression n'a pas pu etre relue. Nouvelle tentative dans un instant.");
        minuterie = setTimeout(() => void charger(), RAFRAICHISSEMENT_MS * 3);
      }
    }

    void charger();
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, [id]);

  async function annuler() {
    setAnnulation(true);
    try {
      const annule = await cancelImport(id);
      setEtat((actuel) => (actuel === undefined ? actuel : { ...actuel, import: annule }));
    } catch (error) {
      setErreur(
        error instanceof ApiError ? (error.detail ?? error.title) : "L'annulation n'a pas abouti.",
      );
    } finally {
      setAnnulation(false);
      setConfirmer(false);
    }
  }

  if (introuvable) {
    return (
      <div className="max-w-[70ch]">
        <h1 className="text-2xl font-bold">Import introuvable</h1>
        <p className="mt-2 text-sm text-text-soft">
          Cet import n&apos;existe pas, ou il appartient a un autre compte.
        </p>
        <Link to="/import" className="mt-4 inline-block text-sm text-accent underline">
          Importer un fichier
        </Link>
      </div>
    );
  }

  if (etat === undefined) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-2 w-full max-w-xl" />
        <TableSkeleton rows={3} />
      </div>
    );
  }

  const { import: importe, rejectedRows } = etat;
  const pourcentage =
    importe.totalRows === 0 ? 0 : Math.round((importe.processedRows / importe.totalRows) * 100);
  const enCours = statut !== undefined && isInProgress(statut);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold break-all">{importe.filename}</h1>
        <span
          className={`rounded-sm border px-1.5 py-0.5 text-xs font-medium ${TONS[importe.status]}`}
        >
          {STATUS_LABELS[importe.status]}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-faint">
        Lance le{' '}
        {new Date(importe.createdAt).toLocaleString('fr-FR', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
      </p>

      <section className="mt-8 max-w-xl" aria-label="Progression">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Lignes traitees</span>
          <span className="text-text-soft" data-numeric>
            {importe.processedRows.toLocaleString('fr-FR')} sur{' '}
            {importe.totalRows.toLocaleString('fr-FR')}
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-sm bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pourcentage}
        >
          <div
            className={`h-full transition-[width] duration-500 ${
              importe.status === 'failed' ? 'bg-negative' : 'bg-accent'
            }`}
            style={{ width: `${String(pourcentage)}%` }}
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Chiffre libelle="Lignes du fichier" valeur={importe.totalRows} />
          <Chiffre libelle="Retenues" valeur={importe.acceptedRows} />
          <Chiffre
            libelle="Deja connues"
            valeur={importe.duplicateRows}
            aide="Rattachees a une entreprise du fichier ou de la bibliotheque, sans en creer une autre."
          />
          <Chiffre libelle="Ecartees" valeur={importe.rejectedRows} alerte />
        </dl>
      </section>

      <div className="mt-6 max-w-[70ch] space-y-3 text-sm" aria-live="polite">
        {erreur !== undefined && <p className="text-caution">{erreur}</p>}
        {importe.status === 'pending' && (
          <p className="text-text-soft">
            L&apos;import attend son tour. Vous pouvez quitter cette page : il continue sans vous.
          </p>
        )}
        {importe.status === 'planning' && (
          <p className="text-text-soft">
            Noms, domaines et adresses de site sont nettoyes, et chaque ligne est rattachee a une
            entreprise, nouvelle ou deja dans votre bibliotheque.
          </p>
        )}
        {importe.status === 'completed' && (
          <p className="text-text-soft">
            Les entreprises de ce fichier sont rangees dans votre bibliotheque, sans doublon.
            L&apos;identification des domaines et la recherche des adresses ne sont pas encore
            disponibles.
          </p>
        )}
        {importe.status === 'cancelled' && (
          <p className="text-text-soft">
            Import annule. Les entreprises deja traitees restent dans votre bibliotheque.
          </p>
        )}
        {importe.status === 'failed' && (
          <p role="alert" className="text-negative">
            {importe.error ?? "L'import a echoue."}
          </p>
        )}
      </div>

      {enCours && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {confirmer ? (
            <>
              <Button tone="danger" disabled={annulation} onClick={() => void annuler()}>
                {annulation ? 'Annulation' : "Confirmer l'annulation"}
              </Button>
              <Button
                disabled={annulation}
                onClick={() => {
                  setConfirmer(false);
                }}
              >
                Continuer l&apos;import
              </Button>
              <span className="text-xs text-text-soft">
                Ce qui est deja traite reste. Ce qui ne l&apos;est pas ne le sera pas.
              </span>
            </>
          ) : (
            <Button
              tone="danger"
              onClick={() => {
                setConfirmer(true);
              }}
            >
              Annuler l&apos;import
            </Button>
          )}
        </div>
      )}

      {rejectedRows.length > 0 && (
        <section className="mt-10">
          <h2 className="text-base font-semibold">Lignes ecartees</h2>
          <p className="mt-1 text-sm text-text-soft">
            Corrigez-les dans votre fichier si elles comptent, puis importez-les a nouveau : les
            entreprises deja presentes ne seront pas creees deux fois.
          </p>
          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-raised text-xs text-text-faint">
                <tr>
                  <th scope="col" className="w-20 px-4 py-2 text-left font-medium">
                    Ligne
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Motif
                  </th>
                </tr>
              </thead>
              <tbody>
                {rejectedRows.map((ligne) => (
                  <tr key={ligne.line} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2 text-xs text-text-faint" data-numeric>
                      {ligne.line}
                    </td>
                    <td className="px-4 py-2 text-negative">{ligne.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importe.rejectedRows > LIGNES_ECARTEES_MAX && (
            <p className="mt-2 text-xs text-text-faint">
              Les {LIGNES_ECARTEES_MAX} premieres sur {importe.rejectedRows.toLocaleString('fr-FR')}
              .
            </p>
          )}
        </section>
      )}

      <div className="mt-10 border-t border-line pt-6">
        <Link to="/import" className="text-sm text-accent underline">
          Importer un autre fichier
        </Link>
      </div>
    </div>
  );
}

function Chiffre({
  libelle,
  valeur,
  aide,
  alerte = false,
}: {
  libelle: string;
  valeur: number;
  aide?: string;
  alerte?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-text-faint" title={aide}>
        {libelle}
      </dt>
      <dd
        className={`mt-0.5 text-lg font-semibold ${alerte && valeur > 0 ? 'text-negative' : ''}`}
        data-numeric
      >
        {valeur.toLocaleString('fr-FR')}
      </dd>
    </div>
  );
}
