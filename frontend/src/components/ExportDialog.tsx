import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../lib/api';
import {
  createExport,
  EXPORT_FORMATS,
  FORMAT_LABELS,
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
  type ExportFormat,
  type ExportScope,
  type StatusFilter,
} from '../lib/exports';
import { Button } from './Button';

/**
 * Un export (6.11) : format, statuts, une adresse par type ou toutes,
 * separateur. Le perimetre vient de la page qui l'ouvre : la selection, un
 * import, une etiquette ou toute la bibliotheque (F-1101).
 */
export function ExportDialog({
  scope,
  scopeLabel,
  onClose,
}: {
  scope: ExportScope;
  scopeLabel: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const [format, setFormat] = useState<ExportFormat>('csv_emails');
  const [statuts, setStatuts] = useState<StatusFilter>('valid_accept_all');
  const [meilleure, setMeilleure] = useState(false);
  const [separateur, setSeparateur] = useState<',' | ';'>(';');
  const [envoi, setEnvoi] = useState(false);
  const [issue, setIssue] = useState<
    { ton: 'ok' | 'erreur'; texte: string; file?: boolean } | undefined
  >(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function exporter() {
    setEnvoi(true);
    setIssue(undefined);
    try {
      const resultat = await createExport({
        format,
        scope,
        statuses: statuts,
        bestOnly: meilleure,
        separator: separateur,
      });
      if (resultat.kind === 'queued') {
        setIssue({
          ton: 'ok',
          texte:
            "Plus de 2 000 adresses : l'export est prepare en arriere-plan et restera telechargeable sept jours.",
          file: true,
        });
      } else {
        const ecartees =
          resultat.skipped > 0
            ? ` ${resultat.skipped.toLocaleString('fr-FR')} adresse${resultat.skipped > 1 ? 's' : ''} que Campaign Mailer refuserait ${resultat.skipped > 1 ? 'sont restees' : 'est restee'} de cote.`
            : '';
        setIssue({
          ton: 'ok',
          texte: `${resultat.filename} : ${resultat.rows.toLocaleString('fr-FR')} adresse${resultat.rows > 1 ? 's' : ''}.${ecartees}`,
        });
      }
    } catch (error) {
      setIssue({
        ton: 'erreur',
        texte: error instanceof ApiError ? error.message : "L'export n'a pas abouti.",
      });
    } finally {
      setEnvoi(false);
    }
  }

  const csv = format === 'csv_emails' || format === 'csv_companies';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titre}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/40"
    >
      <h2 id={titre} className="text-lg font-semibold">
        Exporter
      </h2>
      <p className="mt-1 text-sm text-text-soft">{scopeLabel}</p>

      <fieldset className="mt-4 space-y-2 text-sm">
        <legend className="font-medium">Format</legend>
        {EXPORT_FORMATS.map((valeur) => (
          <label key={valeur} className="flex items-start gap-2">
            <input
              type="radio"
              name="format"
              className="mt-1"
              checked={format === valeur}
              onChange={() => {
                setFormat(valeur);
              }}
            />
            <span>
              {FORMAT_LABELS[valeur].label}
              <span className="block text-xs text-text-faint">
                {FORMAT_LABELS[valeur].description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="mt-4 space-y-2 text-sm">
        <legend className="font-medium">Adresses exportees</legend>
        {STATUS_FILTERS.map((valeur) => (
          <label key={valeur} className="flex items-center gap-2">
            <input
              type="radio"
              name="statuts"
              checked={statuts === valeur}
              onChange={() => {
                setStatuts(valeur);
              }}
            />
            {STATUS_FILTER_LABELS[valeur]}
          </label>
        ))}
        <p className="text-xs text-text-faint">
          Chaque adresse garde son statut dans le fichier : aucune n&apos;y est presentee comme
          verifiee si elle ne l&apos;est pas. Les adresses exclues n&apos;y figurent pas.
        </p>
      </fieldset>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={meilleure}
          onChange={(event) => {
            setMeilleure(event.target.checked);
          }}
        />
        Seulement la meilleure adresse par entreprise et par type
      </label>

      {csv && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          Separateur
          <select
            value={separateur}
            onChange={(event) => {
              setSeparateur(event.target.value === ',' ? ',' : ';');
            }}
            className="rounded-sm border border-line-strong bg-surface px-2 py-1 text-text"
          >
            <option value=";">Point-virgule (Excel en francais)</option>
            <option value=",">Virgule</option>
          </select>
        </label>
      )}

      {issue !== undefined && (
        <p
          role={issue.ton === 'erreur' ? 'alert' : 'status'}
          className={`mt-4 text-sm ${issue.ton === 'erreur' ? 'text-negative' : 'text-accent'}`}
        >
          {issue.texte}{' '}
          {issue.file === true && (
            <Link to="/exports" className="underline">
              Voir les exports
            </Link>
          )}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" onClick={() => ref.current?.close()}>
          Fermer
        </Button>
        <Button type="button" tone="primary" disabled={envoi} onClick={() => void exporter()}>
          {envoi ? 'Export en cours' : 'Exporter'}
        </Button>
      </div>
    </dialog>
  );
}
