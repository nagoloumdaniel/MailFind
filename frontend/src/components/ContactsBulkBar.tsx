import { useState } from 'react';
import { ApiError } from '../lib/api';
import { BULK_VERIFY_MAX, bulkContacts, TYPE_FILTERS, type BulkAction } from '../lib/contacts';
import { ALL_EMAIL_TYPE_LABELS } from '../lib/imports';
import { parseTags } from '../lib/import-settings';
import { Button } from './Button';

const LIBELLES: Record<BulkAction['action'], string> = {
  type: 'Type change',
  tag: 'Etiquette ajoutee',
  untag: 'Etiquette retiree',
  exclude: 'Exclue(s) des exports',
  include: 'Rendue(s) aux exports',
  verify: 'Verification de boite faite',
  reverify: 'Controles refaits',
};

/**
 * Les actions en masse sur la selection (F-1005). La suppression passe par sa
 * confirmation ; le reste s'applique tout de suite et le dit.
 */
export function ContactsBulkBar({
  ids,
  onDone,
  onDelete,
  onExport,
  onClear,
}: {
  ids: string[];
  onDone: (message: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const [envoi, setEnvoi] = useState(false);
  const [etiquette, setEtiquette] = useState('');
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const tropPourVerifier = ids.length > BULK_VERIFY_MAX;

  async function appliquer(action: BulkAction) {
    setEnvoi(true);
    setErreur(undefined);
    try {
      const { updated, notes } = await bulkContacts(ids, action);
      const nombre =
        action.action === 'verify' || action.action === 'reverify' ? ids.length : updated;
      onDone(
        [
          `${LIBELLES[action.action]} : ${nombre.toLocaleString('fr-FR')} contact${nombre > 1 ? 's' : ''}.`,
          ...notes,
        ].join(' '),
      );
      if (action.action === 'tag' || action.action === 'untag') setEtiquette('');
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "L'action n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  const etiquettes = parseTags(etiquette);
  return (
    <div
      role="toolbar"
      aria-label="Actions sur la selection"
      className="mb-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 font-medium" data-numeric>
          {ids.length.toLocaleString('fr-FR')} selectionne{ids.length > 1 ? 's' : ''}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Changer le type</span>
          <select
            value=""
            disabled={envoi}
            onChange={(event) => {
              if (event.target.value !== '')
                void appliquer({ action: 'type', type: event.target.value });
            }}
            className="rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-text"
          >
            <option value="">Changer le type</option>
            {TYPE_FILTERS.map((type) => (
              <option key={type} value={type}>
                {ALL_EMAIL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center">
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
          disabled={envoi || etiquettes.length === 0}
          onClick={() => void appliquer({ action: 'tag', tags: etiquettes })}
        >
          Etiqueter
        </Button>
        <Button
          disabled={envoi || etiquettes.length === 0}
          onClick={() => void appliquer({ action: 'untag', tags: etiquettes })}
        >
          Retirer
        </Button>
        <Button disabled={envoi} onClick={() => void appliquer({ action: 'exclude' })}>
          Exclure
        </Button>
        <Button disabled={envoi} onClick={() => void appliquer({ action: 'include' })}>
          Inclure
        </Button>
        <Button
          disabled={envoi || tropPourVerifier}
          title="Refait les controles gratuits, meme sur une adresse verifiee il y a moins de 30 jours."
          onClick={() => void appliquer({ action: 'reverify' })}
        >
          Reverifier
        </Button>
        <Button
          disabled={envoi || tropPourVerifier}
          title="Interroge le fournisseur sur chaque boite : un demi-credit par adresse, dans la limite du mois."
          onClick={() => void appliquer({ action: 'verify' })}
        >
          Verifier les boites
        </Button>
        <Button disabled={envoi} onClick={onExport}>
          Exporter
        </Button>
        <Button tone="danger" disabled={envoi} onClick={onDelete}>
          Supprimer
        </Button>
        <button type="button" className="ml-1 text-accent underline" onClick={onClear}>
          Deselectionner
        </button>
      </div>
      {tropPourVerifier && (
        <p className="mt-2 text-xs text-text-soft">
          La verification porte sur {BULK_VERIFY_MAX} contacts au plus a la fois.
        </p>
      )}
      {erreur !== undefined && (
        <p role="alert" className="mt-2 text-negative">
          {erreur}
        </p>
      )}
    </div>
  );
}
