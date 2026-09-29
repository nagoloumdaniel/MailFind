import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { bulkCompanies, mergeCompanies, type CompanySummary } from '../lib/companies';
import { Button } from './Button';

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

const DIALOGUE =
  'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/40';

/**
 * Fusion de deux entreprises (F-1006). L'utilisateur choisit celle qui reste :
 * c'est son nom qui est garde, et les champs qu'elle n'a pas sont pris a
 * l'autre.
 */
export function MergeDialog({
  entreprises,
  onClose,
  onMerged,
}: {
  entreprises: [CompanySummary, CompanySummary];
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const ref = useModal();
  const titre = useId();
  const [gardee, setGardee] = useState(entreprises[0].id);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const autre = entreprises.find((e) => e.id !== gardee) ?? entreprises[1];

  async function fusionner() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      await mergeCompanies(gardee, autre.id);
      onMerged(gardee);
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "La fusion n'a pas abouti.");
      setEnvoi(false);
    }
  }

  return (
    <dialog ref={ref} aria-labelledby={titre} onClose={onClose} className={DIALOGUE}>
      <h2 id={titre} className="text-lg font-semibold">
        Fusionner deux entreprises
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        Les adresses, leurs sources, les lignes d&apos;import et l&apos;historique passent sur
        l&apos;entreprise gardee ; une adresse presente des deux cotes n&apos;en fait plus
        qu&apos;une. L&apos;autre fiche disparait.
      </p>
      <fieldset className="mt-4 space-y-2 text-sm">
        <legend className="font-medium">Entreprise a garder</legend>
        {entreprises.map((e) => (
          <label key={e.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="gardee"
              checked={gardee === e.id}
              onChange={() => {
                setGardee(e.id);
              }}
            />
            {e.name}
            {e.domain !== null && <span className="text-text-faint">{e.domain}</span>}
            <span className="text-text-faint">
              ({e.emailCount.toLocaleString('fr-FR')} adresse{e.emailCount > 1 ? 's' : ''})
            </span>
          </label>
        ))}
      </fieldset>
      {erreur !== undefined && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {erreur}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" onClick={() => ref.current?.close()}>
          Annuler
        </Button>
        <Button type="button" tone="primary" disabled={envoi} onClick={() => void fusionner()}>
          {envoi ? 'Fusion' : `Garder ${entreprises.find((e) => e.id === gardee)?.name ?? ''}`}
        </Button>
      </div>
    </dialog>
  );
}

/** Suppression d'entreprises (R-05), definitive, avec la liste de suppression proposee. */
export function DeleteCompaniesDialog({
  ids,
  onClose,
  onDeleted,
}: {
  ids: string[];
  onClose: () => void;
  onDeleted: (resultat: { updated: number; suppressed: number }) => void;
}) {
  const ref = useModal();
  const titre = useId();
  const [supprimer, setSupprimer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  async function confirmer() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      onDeleted(await bulkCompanies(ids, { action: 'delete', suppress: supprimer }));
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "La suppression n'a pas abouti.");
      setEnvoi(false);
    }
  }

  const n = ids.length;
  return (
    <dialog ref={ref} aria-labelledby={titre} onClose={onClose} className={DIALOGUE}>
      <h2 id={titre} className="text-lg font-semibold">
        Supprimer {n.toLocaleString('fr-FR')} entreprise{n > 1 ? 's' : ''} ?
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        La suppression est definitive : l&apos;entreprise, ses adresses, leurs sources et leurs
        verifications sont effacees.
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
          Ajouter aussi leurs adresses a la liste de suppression, pour que MailFind ne les collecte
          plus jamais.
        </span>
      </label>
      {erreur !== undefined && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {erreur}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" onClick={() => ref.current?.close()}>
          Annuler
        </Button>
        <Button type="button" tone="danger" disabled={envoi} onClick={() => void confirmer()}>
          {envoi ? 'Suppression' : 'Supprimer definitivement'}
        </Button>
      </div>
    </dialog>
  );
}
