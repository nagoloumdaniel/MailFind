import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/Button';
import { DeleteCompaniesDialog, MergeDialog } from '../components/CompanyDialogs';
import { ExportDialog } from '../components/ExportDialog';
import { MultiFilter } from '../components/MultiFilter';
import { Pagination } from '../components/Pagination';
import { TableSkeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import {
  bulkCompanies,
  companyFiltersFromSearch,
  companyFiltersToSearch,
  CRAWL_STATUS_LABELS,
  CRAWL_STATUSES,
  fetchCompanies,
  fetchCompanyFacets,
  nextCompanySort,
  type CompanyFacets,
  type CompanyFilters,
  type CompanySort,
  type CompanySummary,
} from '../lib/companies';
import { TYPE_FILTERS } from '../lib/contacts';
import { parseTags } from '../lib/import-settings';
import { ALL_EMAIL_TYPE_LABELS } from '../lib/imports';

const FRAPPE_MS = 300;

const COLONNES: { sort?: CompanySort; label: string; className?: string }[] = [
  { sort: 'name', label: 'Entreprise' },
  { sort: 'city', label: 'Ville' },
  { label: 'Secteur' },
  { sort: 'emails', label: 'Adresses', className: 'text-right' },
  { label: 'Types' },
  { sort: 'score', label: 'Meilleur score', className: 'text-right' },
  { label: 'Collecte' },
  { sort: 'created', label: 'Ajoutee le' },
];

function Facette({
  label,
  valeurs,
  valeur,
  onChange,
}: {
  label: string;
  valeurs: string[];
  valeur: string;
  onChange: (valeur: string) => void;
}) {
  if (valeurs.length === 0 && valeur === '') return null;
  return (
    <label className="flex items-center gap-1.5 text-sm text-text-soft">
      {label}
      <select
        value={valeur}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="max-w-44 rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-text"
      >
        <option value="">Toutes</option>
        {valeurs.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Vue Entreprises (F-1002) : la bibliotheque, une ligne par entreprise. */
export function CompaniesPage() {
  const [params, setParams] = useSearchParams();
  const filtres = companyFiltersFromSearch(params);
  const cle = companyFiltersToSearch(filtres).toString();
  const [saisie, setSaisie] = useState(filtres.q);
  const [facettes, setFacettes] = useState<CompanyFacets | undefined>(undefined);
  const [etat, setEtat] = useState<
    { total: number; companies: CompanySummary[] } | { erreur: string } | undefined
  >(undefined);
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<{ cle: string; ids: Set<string> }>({
    cle: '',
    ids: new Set(),
  });
  const [dialogue, setDialogue] = useState<'fusion' | 'suppression' | 'export' | undefined>(
    undefined,
  );
  const [etiquette, setEtiquette] = useState('');

  function appliquer(suivants: CompanyFilters) {
    setParams(companyFiltersToSearch(suivants));
  }

  useEffect(() => {
    if (saisie === filtres.q) return;
    const minuterie = setTimeout(() => {
      appliquer({ ...filtres, q: saisie, page: 1 });
    }, FRAPPE_MS);
    return () => {
      clearTimeout(minuterie);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la frappe relance la minuterie
  }, [saisie]);

  useEffect(() => {
    let actif = true;
    fetchCompanyFacets()
      .then((lues) => {
        if (actif) setFacettes(lues);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    let actif = true;
    fetchCompanies(companyFiltersFromSearch(new URLSearchParams(cle)))
      .then((resultat) => {
        if (actif) setEtat(resultat);
      })
      .catch((error: unknown) => {
        if (actif) {
          setEtat({
            erreur: error instanceof ApiError ? error.message : "La liste n'a pas pu etre chargee.",
          });
        }
      });
    return () => {
      actif = false;
    };
  }, [cle, version]);

  const choisis = selection.cle === cle ? selection.ids : new Set<string>();
  const basculer = (ids: string[], coche: boolean) => {
    const suivants = new Set(choisis);
    for (const id of ids) {
      if (coche) suivants.add(id);
      else suivants.delete(id);
    }
    setSelection({ cle, ids: suivants });
  };
  const choisies =
    etat !== undefined && 'companies' in etat
      ? etat.companies.filter((entreprise) => choisis.has(entreprise.id))
      : [];

  const [premiere, seconde] = choisies.length === 2 ? choisies : [];

  async function etiqueter(action: 'tag' | 'untag') {
    try {
      const { updated } = await bulkCompanies([...choisis], { action, tags: parseTags(etiquette) });
      setMessage(
        `Etiquette ${action === 'tag' ? 'ajoutee a' : 'retiree de'} ${updated.toLocaleString('fr-FR')} entreprise${updated > 1 ? 's' : ''}.`,
      );
      setEtiquette('');
      setVersion((v) => v + 1);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "L'action n'a pas abouti.");
    }
  }

  const filtresActifs =
    filtres.q !== '' ||
    filtres.city !== '' ||
    filtres.country !== '' ||
    filtres.industry !== '' ||
    filtres.tag !== '' ||
    filtres.crawlStatus.length + filtres.hasType.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold">Entreprises</h1>
        {etat !== undefined && 'total' in etat && (
          <p className="text-sm text-text-soft" data-numeric>
            {etat.total.toLocaleString('fr-FR')} entreprise{etat.total > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <p role="status" className="mt-3 text-sm text-accent empty:hidden">
        {message}
      </p>
      {dialogue === 'fusion' && premiere !== undefined && seconde !== undefined && (
        <MergeDialog
          entreprises={[premiere, seconde]}
          onClose={() => {
            setDialogue(undefined);
          }}
          onMerged={(targetId) => {
            void navigate(`/entreprises/${targetId}`);
          }}
        />
      )}
      {dialogue === 'export' && (
        <ExportDialog
          scope={{ kind: 'companies', ids: [...choisis] }}
          scopeLabel={`${choisis.size.toLocaleString('fr-FR')} entreprise${choisis.size > 1 ? 's' : ''} selectionnee${choisis.size > 1 ? 's' : ''}.`}
          onClose={() => {
            setDialogue(undefined);
          }}
        />
      )}
      {dialogue === 'suppression' && (
        <DeleteCompaniesDialog
          ids={[...choisis]}
          onClose={() => {
            setDialogue(undefined);
          }}
          onDeleted={({ updated, suppressed }) => {
            setMessage(
              `${updated.toLocaleString('fr-FR')} entreprise${updated > 1 ? 's' : ''} supprimee${updated > 1 ? 's' : ''}${
                suppressed > 0
                  ? `, ${suppressed.toLocaleString('fr-FR')} adresse${suppressed > 1 ? 's' : ''} ajoutee${suppressed > 1 ? 's' : ''} a la liste de suppression`
                  : ''
              }.`,
            );
            setDialogue(undefined);
            setSelection({ cle, ids: new Set() });
            setVersion((v) => v + 1);
          }}
        />
      )}

      <search className="mt-6 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-64">
          <span className="sr-only">Rechercher</span>
          <input
            type="search"
            value={saisie}
            onChange={(event) => {
              setSaisie(event.target.value);
            }}
            placeholder="Nom, domaine, ville ou SIREN"
            className="w-full rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm text-text"
          />
        </label>
        <Facette
          label="Ville"
          valeurs={facettes?.cities ?? []}
          valeur={filtres.city}
          onChange={(city) => {
            appliquer({ ...filtres, city, page: 1 });
          }}
        />
        <Facette
          label="Pays"
          valeurs={facettes?.countries ?? []}
          valeur={filtres.country}
          onChange={(country) => {
            appliquer({ ...filtres, country, page: 1 });
          }}
        />
        <Facette
          label="Secteur"
          valeurs={facettes?.industries ?? []}
          valeur={filtres.industry}
          onChange={(industry) => {
            appliquer({ ...filtres, industry, page: 1 });
          }}
        />
        <Facette
          label="Etiquette"
          valeurs={facettes?.tags ?? []}
          valeur={filtres.tag}
          onChange={(tag) => {
            appliquer({ ...filtres, tag, page: 1 });
          }}
        />
        <MultiFilter
          label="Collecte"
          options={CRAWL_STATUSES}
          labels={CRAWL_STATUS_LABELS}
          selected={filtres.crawlStatus}
          onChange={(crawlStatus) => {
            appliquer({ ...filtres, crawlStatus, page: 1 });
          }}
        />
        <MultiFilter
          label="A une adresse"
          options={TYPE_FILTERS}
          labels={ALL_EMAIL_TYPE_LABELS}
          selected={filtres.hasType}
          onChange={(hasType) => {
            appliquer({ ...filtres, hasType, page: 1 });
          }}
        />
        {filtresActifs && (
          <button
            type="button"
            className="px-2 text-sm text-accent underline"
            onClick={() => {
              setSaisie('');
              appliquer({
                ...filtres,
                q: '',
                city: '',
                country: '',
                industry: '',
                tag: '',
                crawlStatus: [],
                hasType: [],
                page: 1,
              });
            }}
          >
            Effacer les filtres
          </button>
        )}
      </search>

      <div className="mt-4">
        {etat === undefined ? (
          <TableSkeleton rows={8} />
        ) : 'erreur' in etat ? (
          <p role="alert" className="text-sm text-negative">
            {etat.erreur}
          </p>
        ) : etat.total === 0 && !filtresActifs ? (
          <p className="rounded-md border border-line bg-surface px-4 py-8 text-center text-sm text-text-soft">
            Aucune entreprise pour l&apos;instant.{' '}
            <Link to="/import" className="text-accent underline">
              Importez une liste d&apos;entreprises
            </Link>{' '}
            pour commencer.
          </p>
        ) : (
          <>
            {choisis.size > 0 && (
              <div
                role="toolbar"
                aria-label="Actions sur la selection"
                className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm"
              >
                <span className="mr-2 font-medium" data-numeric>
                  {choisis.size.toLocaleString('fr-FR')} selectionnee{choisis.size > 1 ? 's' : ''}
                </span>
                <label>
                  <span className="sr-only">Etiquette</span>
                  <input
                    value={etiquette}
                    placeholder="Etiquette"
                    onChange={(event) => {
                      setEtiquette(event.target.value);
                    }}
                    className="w-32 rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-text"
                  />
                </label>
                <Button
                  disabled={parseTags(etiquette).length === 0}
                  onClick={() => void etiqueter('tag')}
                >
                  Etiqueter
                </Button>
                <Button
                  disabled={parseTags(etiquette).length === 0}
                  onClick={() => void etiqueter('untag')}
                >
                  Retirer
                </Button>
                <Button
                  disabled={choisies.length !== 2}
                  title="Selectionnez exactement deux entreprises."
                  onClick={() => {
                    setMessage(undefined);
                    setDialogue('fusion');
                  }}
                >
                  Fusionner
                </Button>
                <Button
                  onClick={() => {
                    setDialogue('export');
                  }}
                >
                  Exporter
                </Button>
                <Button
                  tone="danger"
                  onClick={() => {
                    setMessage(undefined);
                    setDialogue('suppression');
                  }}
                >
                  Supprimer
                </Button>
                <button
                  type="button"
                  className="ml-1 text-accent-strong underline"
                  onClick={() => {
                    setSelection({ cle, ids: new Set() });
                  }}
                >
                  Deselectionner
                </button>
              </div>
            )}
            <div className="relative overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label="Tout selectionner sur cette page"
                        checked={
                          etat.companies.length > 0 &&
                          etat.companies.every((entreprise) => choisis.has(entreprise.id))
                        }
                        onChange={(event) => {
                          basculer(
                            etat.companies.map((entreprise) => entreprise.id),
                            event.target.checked,
                          );
                        }}
                      />
                    </th>
                    {COLONNES.map((colonne) => {
                      const actif = colonne.sort !== undefined && filtres.sort === colonne.sort;
                      return (
                        <th
                          key={colonne.label}
                          scope="col"
                          aria-sort={
                            colonne.sort === undefined
                              ? undefined
                              : actif
                                ? filtres.dir === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                          }
                          className={`px-4 py-2 text-left font-medium ${colonne.className ?? ''}`}
                        >
                          {colonne.sort === undefined ? (
                            colonne.label
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (colonne.sort !== undefined) {
                                  appliquer(nextCompanySort(filtres, colonne.sort));
                                }
                              }}
                              className={`inline-flex items-center gap-1 hover:text-text ${actif ? 'text-text' : ''}`}
                            >
                              {colonne.label}
                              <span aria-hidden="true">
                                {actif ? (filtres.dir === 'asc' ? '▲' : '▼') : ''}
                              </span>
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {etat.companies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLONNES.length + 1}
                        className="px-4 py-8 text-center text-text-soft"
                      >
                        Aucune entreprise ne correspond a cette recherche.
                      </td>
                    </tr>
                  ) : (
                    etat.companies.map((entreprise) => (
                      <tr
                        key={entreprise.id}
                        className="border-b border-line align-top last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Selectionner ${entreprise.name}`}
                            checked={choisis.has(entreprise.id)}
                            onChange={(event) => {
                              basculer([entreprise.id], event.target.checked);
                            }}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            to={`/entreprises/${entreprise.id}`}
                            className="font-medium text-text underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                          >
                            {entreprise.name}
                          </Link>
                          {entreprise.domain !== null && (
                            <span className="block text-xs text-text-faint">
                              {entreprise.domain}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-text-soft">{entreprise.city ?? '-'}</td>
                        <td className="px-4 py-2 text-text-soft">{entreprise.industry ?? '-'}</td>
                        <td className="px-4 py-2 text-right" data-numeric>
                          {entreprise.emailCount.toLocaleString('fr-FR')}
                          {entreprise.validCount > 0 && (
                            <span className="block text-xs text-accent">
                              dont {entreprise.validCount.toLocaleString('fr-FR')} valide
                              {entreprise.validCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-soft">
                          {entreprise.types.length === 0
                            ? '-'
                            : TYPE_FILTERS.filter((t) => entreprise.types.includes(t))
                                .map((t) => ALL_EMAIL_TYPE_LABELS[t])
                                .join(', ')}
                        </td>
                        <td className="px-4 py-2 text-right" data-numeric>
                          {entreprise.bestScore ?? '-'}
                        </td>
                        <td className="px-4 py-2 text-text-soft">
                          {CRAWL_STATUS_LABELS[entreprise.crawlStatus]}
                        </td>
                        <td className="px-4 py-2 text-text-soft" data-numeric>
                          {new Date(entreprise.createdAt).toLocaleDateString('fr-FR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={filtres.page}
              pageSize={filtres.pageSize}
              total={etat.total}
              onPage={(page) => {
                appliquer({ ...filtres, page });
              }}
              onPageSize={(pageSize) => {
                appliquer({ ...filtres, pageSize, page: 1 });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
