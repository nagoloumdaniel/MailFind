import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MultiFilter } from '../components/MultiFilter';
import { Pagination } from '../components/Pagination';
import { TableSkeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import {
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
  }, [cle]);

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
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
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
                        colSpan={COLONNES.length}
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
