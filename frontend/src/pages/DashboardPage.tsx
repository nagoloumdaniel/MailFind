import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { apiFetch } from '../lib/api';
import { FORMAT_LABELS, type ExportFormat } from '../lib/exports';
import {
  EMAIL_STATUS_LABELS,
  STATUS_LABELS,
  type EmailStatus,
  type ImportStatus,
} from '../lib/imports';
import { useSession } from '../lib/session';

interface Dashboard {
  companies: number;
  emailsByStatus: Partial<Record<EmailStatus, number>>;
  importsInProgress: {
    id: string;
    filename: string;
    status: ImportStatus;
    createdAt: string;
    finishedSteps: number;
    totalSteps: number;
  }[];
  credits: { provider: string; operation: string; used: number; limit: number }[];
  recentExports: {
    id: string;
    format: ExportFormat;
    status: string;
    rowCount: number | null;
    createdAt: string;
  }[];
}

/** L'ordre de lecture : ce qui est confirme d'abord, ce qui est ecarte en dernier. */
const ORDRE: EmailStatus[] = [
  'valid',
  'accept_all',
  'risky',
  'unknown',
  'unverified',
  'invalid',
  'disposable',
  'suppressed',
];

/**
 * La couleur d'un statut reprend celle du reste de l'interface ; elle
 * accompagne toujours son libelle et son nombre, jamais seule.
 */
const BARRES: Record<EmailStatus, string> = {
  valid: 'bg-accent',
  accept_all: 'bg-caution',
  risky: 'bg-caution',
  unknown: 'bg-text-faint',
  unverified: 'bg-text-faint',
  invalid: 'bg-negative',
  disposable: 'bg-negative',
  suppressed: 'bg-negative',
};

const CREDITS: Record<string, { label: string; unite: string }> = {
  'brave/web_search': { label: 'Recherche du site officiel', unite: 'recherches' },
  'hunter/domain_search': { label: 'Enrichissement par domaine', unite: 'recherches' },
  'hunter/verification': { label: 'Verification de boite', unite: 'verifications' },
};

function Tuile({ libelle, valeur, lien }: { libelle: string; valeur: number; lien?: string }) {
  const contenu = (
    <>
      <span className="block text-xs text-text-faint">{libelle}</span>
      <span className="mt-1 block font-display text-3xl font-bold" data-numeric>
        {valeur.toLocaleString('fr-FR')}
      </span>
    </>
  );
  return lien === undefined ? (
    <div className="rounded-md border border-line bg-surface px-4 py-3">{contenu}</div>
  ) : (
    <Link
      to={lien}
      className="block rounded-md border border-line bg-surface px-4 py-3 hover:border-accent/60"
    >
      {contenu}
    </Link>
  );
}

/** Une jauge : la part consommee, avec le nombre ecrit a cote. */
function Jauge({
  libelle,
  valeur,
  total,
  detail,
}: {
  libelle: string;
  valeur: number;
  total: number;
  detail: string;
}) {
  const part = total === 0 ? 0 : Math.min(100, Math.round((valeur / total) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{libelle}</span>
        <span className="text-text-soft" data-numeric>
          {detail}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-sm bg-line"
        role="meter"
        aria-label={libelle}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(valeur, total)}
        aria-valuetext={detail}
      >
        <div
          className={`h-full rounded-sm ${part >= 100 ? 'bg-negative' : 'bg-accent'}`}
          style={{ width: `${String(part)}%` }}
        />
      </div>
    </div>
  );
}

/** Tableau de bord (F-1001) : ce que la bibliotheque contient, ce qui tourne, ce qui a ete consomme. */
export function DashboardPage() {
  const { state } = useSession();
  const prenom = state.status === 'authenticated' ? (state.user.name?.split(' ')[0] ?? null) : null;
  const [tableau, setTableau] = useState<Dashboard | 'erreur' | undefined>(undefined);

  useEffect(() => {
    let actif = true;
    apiFetch<Dashboard>('/api/dashboard')
      .then((lu) => {
        if (actif) setTableau(lu);
      })
      .catch(() => {
        if (actif) setTableau('erreur');
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

  const titre = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">
        {prenom === null ? 'Tableau de bord' : `Bonjour ${prenom}`}
      </h1>
      {lienImporter}
    </div>
  );

  if (tableau === 'erreur') {
    return (
      <div>
        {titre}
        <p role="alert" className="mt-4 text-sm text-negative">
          Le tableau de bord n&apos;a pas pu etre charge. Rechargez la page dans un instant.
        </p>
      </div>
    );
  }
  if (tableau === undefined) {
    return (
      <div aria-busy="true">
        {titre}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  const adresses = ORDRE.reduce((n, s) => n + (tableau.emailsByStatus[s] ?? 0), 0);
  if (tableau.companies === 0 && tableau.importsInProgress.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">
          {prenom === null ? 'Tableau de bord' : `Bonjour ${prenom}`}
        </h1>
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
      </div>
    );
  }

  const plusGrand = Math.max(1, ...ORDRE.map((s) => tableau.emailsByStatus[s] ?? 0));
  return (
    <div>
      {titre}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Tuile libelle="Entreprises" valeur={tableau.companies} lien="/entreprises" />
        <Tuile libelle="Adresses" valeur={adresses} lien="/contacts" />
        <Tuile
          libelle="Adresses valides"
          valeur={tableau.emailsByStatus.valid ?? 0}
          lien="/contacts?status=valid"
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="statuts">
          <h2 id="statuts" className="text-base font-semibold">
            Adresses par statut
          </h2>
          <p className="mt-1 text-xs text-text-faint">
            Seul « Valide » dit qu&apos;une boite a ete confirmee.
          </p>
          <ul className="mt-4 space-y-2.5">
            {ORDRE.filter((s) => (tableau.emailsByStatus[s] ?? 0) > 0).map((statut) => {
              const n = tableau.emailsByStatus[statut] ?? 0;
              const part = Math.round((n / Math.max(1, adresses)) * 100);
              return (
                <li key={statut}>
                  <Link
                    to={`/contacts?status=${statut}`}
                    className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3 text-sm hover:text-accent"
                    title={`${EMAIL_STATUS_LABELS[statut]} : ${n.toLocaleString('fr-FR')} adresse${n > 1 ? 's' : ''}, ${String(part)} %`}
                  >
                    <span className="truncate">{EMAIL_STATUS_LABELS[statut]}</span>
                    <span className="h-2.5 rounded-sm bg-line" aria-hidden="true">
                      <span
                        className={`block h-full rounded-sm ${BARRES[statut]}`}
                        style={{ width: `${String(Math.max(2, (n / plusGrand) * 100))}%` }}
                      />
                    </span>
                    <span className="text-right text-text-soft" data-numeric>
                      {n.toLocaleString('fr-FR')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="credits">
          <h2 id="credits" className="text-base font-semibold">
            Credits du mois
          </h2>
          <p className="mt-1 text-xs text-text-faint">
            Vos plafonds mensuels. Un appel en echec n&apos;est pas compte.
          </p>
          <div className="mt-4 space-y-4">
            {tableau.credits.map((c) => {
              const libelle = CREDITS[`${c.provider}/${c.operation}`] ?? {
                label: c.operation,
                unite: 'appels',
              };
              return (
                <Jauge
                  key={`${c.provider}/${c.operation}`}
                  libelle={libelle.label}
                  valeur={c.used}
                  total={c.limit}
                  detail={`${c.used.toLocaleString('fr-FR')} sur ${c.limit.toLocaleString('fr-FR')} ${libelle.unite}`}
                />
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="en-cours">
          <h2 id="en-cours" className="text-base font-semibold">
            Imports en cours
          </h2>
          {tableau.importsInProgress.length === 0 ? (
            <p className="mt-2 text-sm text-text-soft">Aucun import en cours.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {tableau.importsInProgress.map((i) => (
                <li key={i.id}>
                  <Jauge
                    libelle={i.filename}
                    valeur={i.finishedSteps}
                    total={i.totalSteps}
                    detail={
                      i.totalSteps === 0
                        ? STATUS_LABELS[i.status]
                        : `${i.finishedSteps.toLocaleString('fr-FR')} etapes sur ${i.totalSteps.toLocaleString('fr-FR')}`
                    }
                  />
                  <Link
                    to={`/imports/${i.id}`}
                    className="mt-1 inline-block text-xs text-accent underline"
                  >
                    Suivre cet import
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="exports">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="exports" className="text-base font-semibold">
              Derniers exports
            </h2>
            <Link to="/exports" className="text-sm text-accent underline">
              Tous les exports
            </Link>
          </div>
          {tableau.recentExports.length === 0 ? (
            <p className="mt-2 text-sm text-text-soft">Aucun export pour l&apos;instant.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface text-sm">
              {tableau.recentExports.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2"
                >
                  <span>{FORMAT_LABELS[e.format].label}</span>
                  <span className="text-text-soft" data-numeric>
                    {e.rowCount === null ? '-' : `${e.rowCount.toLocaleString('fr-FR')} adresses`},{' '}
                    {new Date(e.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
