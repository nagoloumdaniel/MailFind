import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { deleteContacts } from '../lib/contacts';
import { Button } from './Button';

/**
 * Confirmation d'une suppression (F-1015). Definitive, et dite comme telle ;
 * la liste de suppression est proposee, pas imposee : effacer une adresse
 * mal saisie n'est pas refuser de la revoir.
 */
export function DeleteContactsDialog({
  ids,
  label,
  onClose,
  onDeleted,
}: {
  ids: string[];
  /** L'adresse quand il n'y en a qu'une, pour que la question soit concrete. */
  label?: string;
  onClose: () => void;
  onDeleted: (resultat: { deleted: number; suppressed: number }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const [supprimer, setSupprimer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function confirmer() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      onDeleted(await deleteContacts(ids, supprimer));
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "La suppression n'a pas abouti.");
      setEnvoi(false);
    }
  }

  const n = ids.length;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titre}
      onClose={onClose}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/40"
    >
      <h2 id={titre} className="text-lg font-semibold">
        {n === 1 && label !== undefined
          ? `Supprimer ${label} ?`
          : `Supprimer ${n.toLocaleString('fr-FR')} contact${n > 1 ? 's' : ''} ?`}
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        La suppression est definitive : l&apos;adresse, ses sources et l&apos;historique de ses
        verifications sont effaces.
      </p>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={supprimer}
          onChange={(event) => {
            setSupprimer(event.target.checked);
          }}
        />
        <span>
          Ajouter aussi a la liste de suppression, pour que MailFind ne collecte plus jamais{' '}
          {n > 1 ? 'ces adresses' : 'cette adresse'}.
        </span>
      </label>
      {erreur !== undefined && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {erreur}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button
          type="button"
          onClick={() => {
            ref.current?.close();
          }}
        >
          Annuler
        </Button>
        <Button type="button" tone="danger" disabled={envoi} onClick={() => void confirmer()}>
          {envoi ? 'Suppression' : 'Supprimer definitivement'}
        </Button>
      </div>
    </dialog>
  );
}
