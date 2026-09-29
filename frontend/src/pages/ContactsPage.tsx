import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../components/Button';
import { ContactDialog } from '../components/ContactDialog';
import { ContactsBulkBar } from '../components/ContactsBulkBar';
import { DeleteContactsDialog } from '../components/DeleteContactsDialog';
import { ExportDialog } from '../components/ExportDialog';
import { MultiFilter } from '../components/MultiFilter';
import { Pagination } from '../components/Pagination';
import { ScoreBadge } from '../components/ScoreBadge';
import { TableSkeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import {
  fetchContacts,
  filtersFromSearch,
  filtersToSearch,
  nextSort,
  ORIGIN_FILTERS,
  STATUS_FILTERS,
  TYPE_FILTERS,
  type Contact,
  type ContactFilters,
  type ContactSort,
} from '../lib/contacts';
import {
  ALL_EMAIL_TYPE_LABELS,
  EMAIL_STATUS_LABELS,
  ORIGIN_LABELS,
  STATUS_TONES,
} from '../lib/imports';

/** Delai avant de chercher pendant la frappe : une requete par pause, pas par touche. */
const FRAPPE_MS = 300;

const COLONNES: { sort: ContactSort; label: string; className?: string }[] = [
  { sort: 'address', label: 'Adresse' },
  { sort: 'name', label: 'Nom' },
  { sort: 'company', label: 'Entreprise' },
  { sort: 'type', label: 'Type' },
  { sort: 'status', label: 'Statut' },
  { sort: 'score', label: 'Score', className: 'text-right' },
  { sort: 'origin', label: 'Origine' },
  { sort: 'created', label: 'Ajoutee le' },
];

/**
 * Page Contacts (F-1010 a F-1012) : toutes les adresses de la bibliotheque,
 * quelle que soit leur origine. Les filtres, le tri et la page sont dans
 * l'adresse de la page.
 */
export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const filtres = filtersFromSearch(params);
  const cle = filtersToSearch(filtres).toString();

  const [saisie, setSaisie] = useState(filtres.q);
  const [edition, setEdition] = useState<Contact | 'nouveau' | undefined>(undefined);
  const [version, setVersion] = useState(0);
  // La selection vaut pour la liste affichee : un autre filtre ou une autre
  // page la vide, sans effet a synchroniser.
  const [selection, setSelection] = useState<{ cle: string; ids: Set<string> }>({
    cle: '',
    ids: new Set(),
  });
  const [aExporter, setAExporter] = useState<string[] | undefined>(undefined);
  const [aSupprimer, setASupprimer] = useState<{ ids: string[]; label?: string } | undefined>(
    undefined,
  );
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [etat, setEtat] = useState<
    { total: number; contacts: Contact[] } | { erreur: string } | undefined
  >(undefined);

  function appliquer(suivants: ContactFilters) {
    setParams(filtersToSearch(suivants));
  }

  // La recherche part apres une pause dans la frappe, et revient a la page 1.
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
    fetchContacts(filtersFromSearch(new URLSearchParams(cle)))
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

  const filtresActifs =
    filtres.companyId !== '' ||
    filtres.q !== '' ||
    filtres.status.length + filtres.type.length + filtres.origin.length > 0 ||
    filtres.tag !== '';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">Contacts</h1>
          {etat !== undefined && 'total' in etat && (
            <p className="text-sm text-text-soft" data-numeric>
              {etat.total.toLocaleString('fr-FR')} adresse{etat.total > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          tone="primary"
          onClick={() => {
            setMessage(undefined);
            setEdition('nouveau');
          }}
        >
          Nouveau contact
        </Button>
      </div>
      <p role="status" className="mt-3 text-sm text-accent empty:hidden">
        {message}
      </p>
      {aExporter !== undefined && (
        <ExportDialog
          scope={{ kind: 'contacts', ids: aExporter }}
          scopeLabel={`${aExporter.length.toLocaleString('fr-FR')} contact${aExporter.length > 1 ? 's' : ''} selectionne${aExporter.length > 1 ? 's' : ''}.`}
          onClose={() => {
            setAExporter(undefined);
          }}
        />
      )}
      {aSupprimer !== undefined && (
        <DeleteContactsDialog
          ids={aSupprimer.ids}
          {...(aSupprimer.label === undefined ? {} : { label: aSupprimer.label })}
          onClose={() => {
            setASupprimer(undefined);
          }}
          onDeleted={({ deleted, suppressed }) => {
            setMessage(
              `${deleted.toLocaleString('fr-FR')} contact${deleted > 1 ? 's' : ''} supprime${deleted > 1 ? 's' : ''}${
                suppressed > 0
                  ? `, ${suppressed.toLocaleString('fr-FR')} ajoute${suppressed > 1 ? 's' : ''} a la liste de suppression`
                  : ''
              }.`,
            );
            setASupprimer(undefined);
            setSelection({ cle, ids: new Set() });
            setVersion((v) => v + 1);
          }}
        />
      )}
      {edition !== undefined && (
        <ContactDialog
          {...(edition === 'nouveau' ? {} : { contact: edition })}
          onClose={() => {
            setEdition(undefined);
          }}
          onSaved={(contact) => {
            setMessage(
              edition === 'nouveau'
                ? `Contact ${contact.address} cree.`
                : `Contact ${contact.address} enregistre.`,
            );
            setEdition(undefined);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <p className="mt-2 max-w-[70ch] text-sm text-text-soft">
        Toutes les adresses de votre bibliotheque, trouvees, fournies, deduites ou saisies. Chacune
        garde sa source et son statut : seul « Valide » dit qu&apos;une boite a ete confirmee.
      </p>

      <search className="mt-6 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-64">
          <span className="sr-only">Rechercher</span>
          <input
            type="search"
            value={saisie}
            onChange={(event) => {
              setSaisie(event.target.value);
            }}
            placeholder="Adresse, nom, entreprise ou domaine"
            className="w-full rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-sm text-text"
          />
        </label>
        <MultiFilter
          label="Statut"
          options={STATUS_FILTERS}
          labels={EMAIL_STATUS_LABELS}
          selected={filtres.status}
          onChange={(status) => {
            appliquer({ ...filtres, status, page: 1 });
          }}
        />
        <MultiFilter
          label="Type"
          options={TYPE_FILTERS}
          labels={ALL_EMAIL_TYPE_LABELS}
          selected={filtres.type}
          onChange={(type) => {
            appliquer({ ...filtres, type, page: 1 });
          }}
        />
        <MultiFilter
          label="Origine"
          options={ORIGIN_FILTERS}
          labels={ORIGIN_LABELS}
          selected={filtres.origin}
          onChange={(origin) => {
            appliquer({ ...filtres, origin, page: 1 });
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
                status: [],
                type: [],
                origin: [],
                tag: '',
                companyId: '',
                page: 1,
              });
            }}
          >
            Effacer les filtres
          </button>
        )}
      </search>
      {filtres.companyId !== '' && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-soft">
          Adresses de{' '}
          {etat !== undefined && 'contacts' in etat && etat.contacts[0] !== undefined ? (
            <Link
              to={`/entreprises/${filtres.companyId}`}
              className="font-medium text-text underline"
            >
              {etat.contacts[0].company.name}
            </Link>
          ) : (
            'une entreprise'
          )}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              appliquer({ ...filtres, companyId: '', page: 1 });
            }}
          >
            Voir toutes les adresses
          </button>
        </p>
      )}

      <div className="mt-4">
        {etat === undefined ? (
          <TableSkeleton rows={8} />
        ) : 'erreur' in etat ? (
          <p role="alert" className="text-sm text-negative">
            {etat.erreur}
          </p>
        ) : etat.total === 0 && !filtresActifs ? (
          <p className="rounded-md border border-line bg-surface px-4 py-8 text-center text-sm text-text-soft">
            Aucune adresse pour l&apos;instant.{' '}
            <Link to="/import" className="text-accent underline">
              Importez une liste d&apos;entreprises
            </Link>{' '}
            pour commencer.
          </p>
        ) : (
          <>
            {choisis.size > 0 && (
              <ContactsBulkBar
                ids={[...choisis]}
                onDone={(texte) => {
                  setMessage(texte);
                  setVersion((v) => v + 1);
                }}
                onDelete={() => {
                  setMessage(undefined);
                  setASupprimer({ ids: [...choisis] });
                }}
                onExport={() => {
                  setAExporter([...choisis]);
                }}
                onClear={() => {
                  setSelection({ cle, ids: new Set() });
                }}
              />
            )}
            <div className="relative overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[60rem] text-sm">
                <caption className="sr-only">
                  Contacts, tries par {COLONNES.find((c) => c.sort === filtres.sort)?.label}{' '}
                  {filtres.dir === 'asc' ? 'croissant' : 'decroissant'}
                </caption>
                <thead className="border-b border-line bg-raised text-xs text-text-faint">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label="Tout selectionner sur cette page"
                        checked={
                          etat.contacts.length > 0 &&
                          etat.contacts.every((contact) => choisis.has(contact.id))
                        }
                        onChange={(event) => {
                          basculer(
                            etat.contacts.map((contact) => contact.id),
                            event.target.checked,
                          );
                        }}
                      />
                    </th>
                    {COLONNES.map((colonne) => {
                      const actif = filtres.sort === colonne.sort;
                      return (
                        <th
                          key={colonne.sort}
                          scope="col"
                          aria-sort={
                            actif ? (filtres.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          className={`px-4 py-2 text-left font-medium ${colonne.className ?? ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              appliquer(nextSort(filtres, colonne.sort));
                            }}
                            className={`inline-flex items-center gap-1 hover:text-text ${actif ? 'text-text' : ''}`}
                          >
                            {colonne.label}
                            <span aria-hidden="true">
                              {actif ? (filtres.dir === 'asc' ? '▲' : '▼') : ''}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {etat.contacts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLONNES.length + 2}
                        className="px-4 py-8 text-center text-text-soft"
                      >
                        Aucune adresse ne correspond a cette recherche.
                      </td>
                    </tr>
                  ) : (
                    etat.contacts.map((contact) => (
                      <tr
                        key={contact.id}
                        className="border-b border-line align-top last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Selectionner ${contact.address}`}
                            checked={choisis.has(contact.id)}
                            onChange={(event) => {
                              basculer([contact.id], event.target.checked);
                            }}
                          />
                        </td>
                        <td className="px-4 py-2 font-mono whitespace-nowrap">{contact.address}</td>
                        <td className="px-4 py-2">
                          {contact.contactName ?? <span className="text-text-faint">-</span>}
                        </td>
                        <td className="px-4 py-2 text-text-soft">{contact.company.name}</td>
                        <td className="px-4 py-2">
                          {ALL_EMAIL_TYPE_LABELS[contact.type] ?? contact.type}
                        </td>
                        <td className="px-4 py-2">
                          <span className={STATUS_TONES[contact.status]}>
                            {EMAIL_STATUS_LABELS[contact.status]}
                          </span>
                          {contact.excluded && (
                            <span className="block text-xs text-text-faint">Hors des exports</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <ScoreBadge score={contact.score} breakdown={contact.scoreBreakdown} />
                        </td>
                        <td className="px-4 py-2 text-text-soft">
                          {ORIGIN_LABELS[contact.origin]}
                          {contact.origin === 'deduced' && contact.status !== 'valid' && (
                            <span className="block text-xs text-text-faint">non confirmee</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-text-soft" data-numeric>
                          {new Date(contact.createdAt).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            className="inline-flex min-h-6 items-center text-sm text-accent underline"
                            aria-label={`Modifier ${contact.address}`}
                            onClick={() => {
                              setMessage(undefined);
                              setEdition(contact);
                            }}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            className="ml-3 inline-flex min-h-6 items-center text-sm text-negative underline"
                            aria-label={`Supprimer ${contact.address}`}
                            onClick={() => {
                              setMessage(undefined);
                              setASupprimer({ ids: [contact.id], label: contact.address });
                            }}
                          >
                            Supprimer
                          </button>
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
