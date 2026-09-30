import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../lib/api';
import { campaignMailerApi, pushIsOver, type CampaignMailerPush } from '../lib/campaign-mailer';
import { STATUS_FILTER_LABELS, STATUS_FILTERS, type StatusFilter } from '../lib/exports';
import { Button } from './Button';

/** Tant que l'envoi court, la page relit son etat toutes les deux secondes. */
const INTERVALLE_MS = 2000;

/**
 * Envoi d'une selection vers une campagne en brouillon de Campaign Mailer
 * (F-1202). Le processus de traitement fait l'envoi lot par lot ; le dialogue
 * le suit, puis donne le lien vers le brouillon. Rien n'est lance : seul
 * Campaign Mailer lance une campagne, quand l'utilisateur le decide.
 */
export function SendToCampaignMailerDialog({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const champNom = useId();
  const [nom, setNom] = useState('');
  const [statuts, setStatuts] = useState<StatusFilter>('valid_accept_all');
  const [envoi, setEnvoi] = useState<CampaignMailerPush | undefined>(undefined);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const enCours = envoi !== undefined && !pushIsOver(envoi);
  const idEnvoi = envoi?.id;
  useEffect(() => {
    if (!enCours || idEnvoi === undefined) return;
    const minuteur = setInterval(() => {
      campaignMailerApi
        .pushStatus(idEnvoi)
        .then(({ push }) => {
          setEnvoi(push);
        })
        .catch(() => undefined);
    }, INTERVALLE_MS);
    return () => {
      clearInterval(minuteur);
    };
  }, [enCours, idEnvoi]);

  async function lancer() {
    setOccupe(true);
    setErreur(undefined);
    try {
      const { push } = await campaignMailerApi.push(nom.trim(), { kind: 'contacts', ids }, statuts);
      setEnvoi(push);
    } catch (error) {
      setErreur(
        error instanceof ApiError ? (error.detail ?? error.title) : "L'envoi n'a pas pu partir.",
      );
    } finally {
      setOccupe(false);
    }
  }

  const n = ids.length;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titre}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/40"
    >
      <h2 id={titre} className="text-lg font-semibold">
        Envoyer vers Campaign Mailer
      </h2>
      <p className="mt-1 text-sm text-text-soft">
        {n.toLocaleString('fr-FR')} contact{n > 1 ? 's' : ''} selectionne{n > 1 ? 's' : ''}, pour
        une campagne en brouillon. Rien ne part avant que vous la lanciez dans Campaign Mailer.
      </p>

      {envoi === undefined ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void lancer();
          }}
        >
          <label htmlFor={champNom} className="block text-sm font-medium">
            Nom de la campagne
          </label>
          <input
            id={champNom}
            value={nom}
            maxLength={200}
            onChange={(event) => {
              setNom(event.target.value);
            }}
            placeholder="Par exemple : Alternance 2027"
            className="mt-1.5 block w-full rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
          />
          <fieldset className="mt-4 space-y-2 text-sm">
            <legend className="font-medium">Adresses envoyees</legend>
            {STATUS_FILTERS.map((valeur) => (
              <label key={valeur} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="statuts-envoi"
                  checked={statuts === valeur}
                  onChange={() => {
                    setStatuts(valeur);
                  }}
                />
                {STATUS_FILTER_LABELS[valeur]}
              </label>
            ))}
            <p className="text-xs text-text-faint">
              Chaque adresse part avec sa source et son statut : Campaign Mailer ne presente comme
              confirmees que les boites verifiees. Les adresses exclues ne partent pas.
            </p>
          </fieldset>
          {erreur !== undefined && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {erreur}
              {erreur.includes('page Compte') && (
                <>
                  {' '}
                  <Link to="/compte" className="text-accent underline">
                    Aller a la page Compte
                  </Link>
                </>
              )}
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
            <Button type="submit" tone="primary" disabled={occupe || nom.trim() === ''}>
              {occupe ? 'Envoi' : 'Envoyer'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 text-sm" role="status">
          {!pushIsOver(envoi) && (
            <p>
              Envoi en cours
              {envoi.batchesTotal !== null
                ? ` : lot ${String(Math.min(envoi.batchesDone + 1, envoi.batchesTotal))} sur ${String(envoi.batchesTotal)}.`
                : '.'}
            </p>
          )}
          {envoi.status === 'done' && (
            <p>
              {envoi.imported.toLocaleString('fr-FR')} adresse{envoi.imported > 1 ? 's' : ''}{' '}
              ajoutee{envoi.imported > 1 ? 's' : ''} a la campagne « {envoi.campaignName} »
              {envoi.rejected > 0
                ? `, ${String(envoi.rejected)} refusee(s) par Campaign Mailer`
                : ''}
              {envoi.skipped > 0 ? `, ${String(envoi.skipped)} laissee(s) de cote` : ''}.
            </p>
          )}
          {envoi.status === 'failed' && (
            <p role="alert" className="text-negative">
              {envoi.error ?? "L'envoi a echoue."}
            </p>
          )}
          {envoi.campaignUrl !== null && (
            <p className="mt-2">
              <a
                href={envoi.campaignUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Ouvrir le brouillon dans Campaign Mailer
              </a>
            </p>
          )}
          <div className="mt-6 flex justify-end">
            <Button
              type="button"
              onClick={() => {
                ref.current?.close();
              }}
            >
              Fermer
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
