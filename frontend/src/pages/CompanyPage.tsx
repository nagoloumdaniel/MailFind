import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../components/Button';
import { ScoreBadge } from '../components/ScoreBadge';
import { Skeleton } from '../components/Skeleton';
import { ApiError } from '../lib/api';
import {
  correctDomain,
  CRAWL_STATUS_LABELS,
  DOMAIN_STATUS_LABELS,
  fetchCompany,
  STEP_LABELS,
  STEP_STATUS_LABELS,
  updateCompany,
  type CompanyDetail,
  type CompanySource,
} from '../lib/companies';
import { TYPE_FILTERS } from '../lib/contacts';
import { parseTags } from '../lib/import-settings';
import {
  ALL_EMAIL_TYPE_LABELS,
  EMAIL_STATUS_LABELS,
  NOTE_LABELS,
  ORIGIN_LABELS,
  STATUS_TONES,
  type CrawlNote,
} from '../lib/imports';

const CHAMP =
  'block w-full rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-text';

/** Une URL n'est un lien que si elle est en http ou https (S-06). */
function lienSur(url: string | null): string | undefined {
  if (url === null) return undefined;
  try {
    const lue = new URL(url);
    return lue.protocol === 'http:' || lue.protocol === 'https:' ? lue.toString() : undefined;
  } catch {
    return undefined;
  }
}

function LienExterne({ url, children }: { url: string | null; children?: string }) {
  const lien = lienSur(url);
  if (lien === undefined) return <span className="text-text-faint">-</span>;
  return (
    <a
      href={lien}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all text-accent underline"
    >
      {children ?? lien}
    </a>
  );
}

function Source({ source }: { source: CompanySource }) {
  const date = new Date(source.discoveredAt).toLocaleDateString('fr-FR');
  const lien = lienSur(source.url);
  let quoi: React.ReactNode;
  if (source.kind === 'website' && lien !== undefined) {
    quoi = (
      <>
        Page{' '}
        <a
          href={lien}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all text-accent underline"
        >
          {new URL(lien).pathname}
        </a>
      </>
    );
  } else if (source.kind === 'provider') {
    quoi = <>Fournisseur {source.provider ?? ''}</>;
  } else if (source.kind === 'deduction') {
    quoi = <>Regle de deduction</>;
  } else if (source.kind === 'manual') {
    quoi = <>Saisie</>;
  } else {
    quoi = <>{source.kind}</>;
  }
  return (
    <li>
      {quoi}, le {date}
      {source.excerpt !== null && (
        // Texte venu d'une page qu'on ne controle pas : React l'echappe (S-06).
        <span className="block text-text-faint">« {source.excerpt} »</span>
      )}
    </li>
  );
}

/** Fiche entreprise (F-1004), correction du domaine (F-307). */
export function CompanyPage() {
  const { id = '' } = useParams();
  const [fiche, setFiche] = useState<CompanyDetail | 'introuvable' | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [etiquettes, setEtiquettes] = useState('');
  const [domaine, setDomaine] = useState('');
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | undefined>(
    undefined,
  );
  const [envoi, setEnvoi] = useState(false);

  function poser(lue: CompanyDetail) {
    setFiche(lue);
    setNotes(lue.company.notes ?? '');
    setEtiquettes(lue.company.tags.join(', '));
    setDomaine(lue.company.domain ?? '');
  }

  useEffect(() => {
    let actif = true;
    fetchCompany(id)
      .then((lue) => {
        if (actif) poser(lue);
      })
      .catch((error: unknown) => {
        if (actif) {
          setFiche(error instanceof ApiError && error.status === 404 ? 'introuvable' : undefined);
          if (!(error instanceof ApiError && error.status === 404)) {
            setMessage({ ton: 'erreur', texte: "La fiche n'a pas pu etre chargee." });
          }
        }
      });
    return () => {
      actif = false;
    };
  }, [id]);

  async function enregistrer(event: FormEvent) {
    event.preventDefault();
    setEnvoi(true);
    setMessage(undefined);
    try {
      poser(await updateCompany(id, { notes, tags: parseTags(etiquettes) }));
      setMessage({ ton: 'ok', texte: 'Notes et etiquettes enregistrees.' });
    } catch (error) {
      setMessage({
        ton: 'erreur',
        texte: error instanceof ApiError ? error.message : "L'enregistrement n'a pas abouti.",
      });
    } finally {
      setEnvoi(false);
    }
  }

  async function corriger(event: FormEvent) {
    event.preventDefault();
    setEnvoi(true);
    setMessage(undefined);
    try {
      const resultat = await correctDomain(id, domaine);
      poser(resultat);
      setMessage({
        ton: 'ok',
        texte: `Domaine corrige : la collecte repart sur ${resultat.company.domain ?? domaine}.`,
      });
    } catch (error) {
      setMessage({
        ton: 'erreur',
        texte: error instanceof ApiError ? error.message : "La correction n'a pas abouti.",
      });
    } finally {
      setEnvoi(false);
    }
  }

  if (fiche === 'introuvable') {
    return (
      <div>
        <h1 className="text-2xl font-bold">Entreprise introuvable</h1>
        <p className="mt-2 text-sm text-text-soft">
          Elle a peut-etre ete supprimee ou fusionnee.{' '}
          <Link to="/entreprises" className="text-accent underline">
            Retour aux entreprises
          </Link>
        </p>
      </div>
    );
  }
  if (fiche === undefined) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-4 w-96" />
        {message !== undefined && <p className="mt-4 text-sm text-negative">{message.texte}</p>}
      </div>
    );
  }

  const { company: c, emails, history } = fiche;
  const parType = TYPE_FILTERS.map((type) => ({
    type,
    adresses: emails.filter((e) => e.type === type),
  })).filter((groupe) => groupe.adresses.length > 0);

  return (
    <div className="max-w-5xl">
      <p className="text-sm">
        <Link to="/entreprises" className="text-accent underline">
          Entreprises
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{c.name}</h1>
      {c.legalName !== null && c.legalName !== c.name && (
        <p className="text-sm text-text-soft">{c.legalName}</p>
      )}

      <p
        role="status"
        className={`mt-3 text-sm empty:hidden ${message?.ton === 'erreur' ? 'text-negative' : 'text-accent'}`}
      >
        {message?.texte}
      </p>

      <section className="mt-6" aria-labelledby="identite">
        <h2 id="identite" className="text-base font-semibold">
          Identite
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-text-faint">Domaine</dt>
          <dd>
            {c.domain ?? '-'}
            <span className="ml-2 text-xs text-text-faint">
              {DOMAIN_STATUS_LABELS[c.domainStatus] ?? c.domainStatus}
            </span>
          </dd>
          <dt className="text-text-faint">SIREN</dt>
          <dd data-numeric>{c.siren ?? '-'}</dd>
          <dt className="text-text-faint">Ville</dt>
          <dd>{[c.city, c.country].filter(Boolean).join(', ') || '-'}</dd>
          <dt className="text-text-faint">Secteur</dt>
          <dd>{c.industry ?? '-'}</dd>
          <dt className="text-text-faint">Effectif</dt>
          <dd>{c.employeeRange ?? '-'}</dd>
          <dt className="text-text-faint">Collecte</dt>
          <dd>
            {CRAWL_STATUS_LABELS[c.crawlStatus]}
            {c.crawledAt !== null && (
              <span className="ml-2 text-xs text-text-faint">
                le {new Date(c.crawledAt).toLocaleDateString('fr-FR')}
              </span>
            )}
          </dd>
        </dl>
        {c.crawlNotes.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-text-soft">
            {c.crawlNotes.map((note) => (
              <li key={note}>{NOTE_LABELS[note as CrawlNote] ?? note}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="canaux">
        <h2 id="canaux" className="text-base font-semibold">
          Canaux
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-text-faint">Site</dt>
          <dd>
            <LienExterne url={c.websiteUrl} />
          </dd>
          <dt className="text-text-faint">Page carrieres</dt>
          <dd>
            <LienExterne url={c.careersUrl} />
          </dd>
          <dt className="text-text-faint">Formulaire de contact</dt>
          <dd>
            <LienExterne url={c.contactFormUrl} />
          </dd>
          <dt className="text-text-faint">LinkedIn</dt>
          <dd>
            <LienExterne url={c.linkedinUrl} />
          </dd>
          <dt className="text-text-faint">Telephone</dt>
          <dd>{c.phone ?? '-'}</dd>
        </dl>
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="adresses">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="adresses" className="text-base font-semibold">
            Adresses
          </h2>
          <Link to={`/contacts?companyId=${c.id}`} className="text-sm text-accent underline">
            Gerer dans Contacts
          </Link>
        </div>
        {parType.length === 0 ? (
          <p className="mt-2 text-sm text-text-soft">Aucune adresse pour cette entreprise.</p>
        ) : (
          parType.map(({ type, adresses }) => (
            <div key={type} className="mt-4">
              <h3 className="text-sm font-semibold text-text-soft">
                {ALL_EMAIL_TYPE_LABELS[type]}
              </h3>
              <ul className="mt-2 space-y-3">
                {adresses.map((e) => (
                  <li key={e.id} className="rounded-md border border-line bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="font-mono text-sm">{e.address}</span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className={STATUS_TONES[e.status]}>
                          {EMAIL_STATUS_LABELS[e.status]}
                        </span>
                        <ScoreBadge score={e.score} breakdown={e.scoreBreakdown} />
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-faint">
                      {ORIGIN_LABELS[e.origin]}
                      {e.contactName !== null && `, ${e.contactName}`}
                      {e.verificationReason !== null && ` : ${e.verificationReason}`}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-text-soft">
                      {e.sources.map((source, index) => (
                        <Source key={index} source={source} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="notes">
        <h2 id="notes" className="text-base font-semibold">
          Notes et etiquettes
        </h2>
        <form onSubmit={(event) => void enregistrer(event)} className="mt-3 max-w-2xl space-y-3">
          <label className="block text-sm">
            <span className="text-text-soft">Notes</span>
            <textarea
              value={notes}
              maxLength={5000}
              rows={4}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
              className={`mt-1 ${CHAMP}`}
            />
          </label>
          <label className="block text-sm">
            <span className="text-text-soft">Etiquettes, separees par des virgules</span>
            <input
              value={etiquettes}
              onChange={(event) => {
                setEtiquettes(event.target.value);
              }}
              className={`mt-1 ${CHAMP}`}
            />
          </label>
          <Button type="submit" disabled={envoi}>
            Enregistrer
          </Button>
        </form>
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="domaine">
        <h2 id="domaine" className="text-base font-semibold">
          Corriger le domaine
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-text-soft">
          Le domaine sert a explorer le site et a juger les adresses. Corrige, il est tenu pour
          confirme et la collecte repart sur le bon site ; les adresses deja trouvees restent, a
          vous de supprimer celles qui ne sont pas de cette entreprise.
        </p>
        <form
          onSubmit={(event) => void corriger(event)}
          className="mt-3 flex max-w-xl flex-wrap items-end gap-2"
        >
          <label className="min-w-0 flex-1 text-sm">
            <span className="text-text-soft">Domaine</span>
            <input
              value={domaine}
              required
              placeholder="entreprise.fr"
              onChange={(event) => {
                setDomaine(event.target.value);
              }}
              className={`mt-1 ${CHAMP}`}
            />
          </label>
          <Button
            type="submit"
            disabled={envoi || domaine.trim() === '' || domaine.trim() === c.domain}
          >
            Corriger et relancer
          </Button>
        </form>
      </section>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="historique">
        <h2 id="historique" className="text-base font-semibold">
          Historique des traitements
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-text-soft">Aucun traitement pour l&apos;instant.</p>
        ) : (
          <div className="relative mt-3 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-line bg-raised text-xs text-text-faint">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Etape
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Etat
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Import
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, index) => (
                  <tr key={index} className="border-b border-line align-top last:border-b-0">
                    <td className="px-4 py-2 text-text-soft" data-numeric>
                      {new Date(h.completedAt ?? h.startedAt ?? h.createdAt).toLocaleString(
                        'fr-FR',
                        {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        },
                      )}
                    </td>
                    <td className="px-4 py-2">{STEP_LABELS[h.step] ?? h.step}</td>
                    <td className="px-4 py-2">
                      <span className={h.status === 'failed' ? 'text-negative' : 'text-text-soft'}>
                        {STEP_STATUS_LABELS[h.status] ?? h.status}
                      </span>
                      {h.error !== null && (
                        <span className="block text-xs text-text-faint">{h.error}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {h.importId === null ? (
                        '-'
                      ) : (
                        <Link to={`/imports/${h.importId}`} className="text-accent underline">
                          {h.filename ?? 'Import'}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
