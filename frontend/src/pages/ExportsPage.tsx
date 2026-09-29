import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { ExportDialog } from '../components/ExportDialog';
import { TableSkeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import { fetchCompanyFacets } from '../lib/companies';
import {
  downloadExport,
  fetchExports,
  FORMAT_LABELS,
  type ExportRecord,
  type ExportScope,
} from '../lib/exports';

const STATUTS: Record<ExportRecord['status'], string> = {
  pending: 'En attente',
  running: 'En preparation',
  done: 'Pret',
  failed: 'En echec',
  expired: 'Expire',
};

/** Tant qu'un export se prepare, la liste se relit seule. */
const RAFRAICHISSEMENT_MS = 3000;

/** Les exports (6.11) : en lancer un sur la bibliotheque ou une etiquette, retrouver les volumineux. */
export function ExportsPage() {
  const [liste, setListe] = useState<ExportRecord[] | { erreur: string } | undefined>(undefined);
  const [etiquettes, setEtiquettes] = useState<string[]>([]);
  const [etiquette, setEtiquette] = useState('');
  const [dialogue, setDialogue] = useState<{ scope: ExportScope; label: string } | undefined>(
    undefined,
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetchCompanyFacets()
      .then((f) => {
        setEtiquettes(f.tags);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const lire = () => {
      fetchExports()
        .then((lus) => {
          if (!actif) return;
          setListe(lus);
          if (lus.some((e) => e.status === 'pending' || e.status === 'running')) {
            minuterie = setTimeout(lire, RAFRAICHISSEMENT_MS);
          }
        })
        .catch((error: unknown) => {
          if (actif) {
            setListe({
              erreur: error instanceof ApiError ? error.message : "La liste n'a pas pu etre lue.",
            });
          }
        });
    };
    lire();
    return () => {
      actif = false;
      if (minuterie !== undefined) clearTimeout(minuterie);
    };
  }, [version]);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">Exports</h1>
      <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
        Exportez toute la bibliotheque ou une etiquette. Depuis les pages Contacts, Entreprises et
        d&apos;un import, vous exportez la selection ou l&apos;import. Au-dela de 2 000 adresses,
        l&apos;export est prepare en arriere-plan et reste telechargeable sept jours.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Button
          tone="primary"
          onClick={() => {
            setDialogue({ scope: { kind: 'library' }, label: 'Toute la bibliotheque.' });
          }}
        >
          Exporter la bibliotheque
        </Button>
        {etiquettes.length > 0 && (
          <>
            <label className="text-sm">
              <span className="text-text-soft">Etiquette</span>
              <select
                value={etiquette}
                onChange={(event) => {
                  setEtiquette(event.target.value);
                }}
                className="mt-1 block rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-text"
              >
                <option value="">Choisir</option>
                {etiquettes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={etiquette === ''}
              onClick={() => {
                setDialogue({
                  scope: { kind: 'tag', tag: etiquette },
                  label: `Entreprises et adresses etiquetees « ${etiquette} ».`,
                });
              }}
            >
              Exporter l&apos;etiquette
            </Button>
          </>
        )}
      </div>

      {dialogue !== undefined && (
        <ExportDialog
          scope={dialogue.scope}
          scopeLabel={dialogue.label}
          onClose={() => {
            setDialogue(undefined);
            setVersion((v) => v + 1);
          }}
        />
      )}

      <section className="mt-10" aria-labelledby="journal">
        <h2 id="journal" className="text-base font-semibold">
          Derniers exports
        </h2>
        <div className="mt-3">
          {liste === undefined ? (
            <TableSkeleton rows={3} />
          ) : 'erreur' in liste ? (
            <p role="alert" className="text-sm text-negative">
              {liste.erreur}
            </p>
          ) : liste.length === 0 ? (
            <p className="text-sm text-text-soft">Aucun export pour l&apos;instant.</p>
          ) : (
            <div className="relative overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Format
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Adresses
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Etat
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      <span className="sr-only">Telecharger</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {liste.map((e) => (
                    <tr key={e.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-text-soft" data-numeric>
                        {new Date(e.createdAt).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="px-4 py-2">{FORMAT_LABELS[e.format].label}</td>
                      <td className="px-4 py-2 text-right" data-numeric>
                        {e.rowCount?.toLocaleString('fr-FR') ?? '-'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={e.status === 'failed' ? 'text-negative' : 'text-text-soft'}
                        >
                          {STATUTS[e.status]}
                        </span>
                        {e.status === 'done' && e.expiresAt === null && (
                          <span className="block text-xs text-text-faint">
                            Telecharge a la creation
                          </span>
                        )}
                        {e.downloadable && e.expiresAt !== null && (
                          <span className="block text-xs text-text-faint">
                            jusqu&apos;au {new Date(e.expiresAt).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {e.downloadable && (
                          <button
                            type="button"
                            className="text-accent underline"
                            onClick={() => void downloadExport(e)}
                          >
                            Telecharger
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
