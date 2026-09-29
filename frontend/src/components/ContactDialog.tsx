import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import {
  contactPatch,
  createContact,
  lookupCompanies,
  TYPE_FILTERS,
  updateContact,
  type CompanyChoice,
  type Contact,
  type ContactInput,
} from '../lib/contacts';
import { ALL_EMAIL_TYPE_LABELS } from '../lib/imports';
import { parseTags } from '../lib/import-settings';
import { Button } from './Button';

type Entreprise =
  | { mode: 'existante'; choisie: CompanyChoice | undefined }
  | { mode: 'nouvelle'; nom: string; domaine: string };

const CHAMP =
  'mt-1 block w-full rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-text';

/**
 * Creation ou modification d'un contact (F-1013, F-1014). Un `dialog` natif
 * ouvert en modal : le focus y reste, Echap le ferme, et le reste de la page
 * est inerte pour un lecteur d'ecran.
 */
export function ContactDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact?: Contact;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const [adresse, setAdresse] = useState(contact?.address ?? '');
  const [entreprise, setEntreprise] = useState<Entreprise>({
    mode: 'existante',
    choisie: contact?.company,
  });
  const [nom, setNom] = useState(contact?.contactName ?? '');
  const [civilite, setCivilite] = useState(contact?.salutation ?? '');
  const [type, setType] = useState(contact?.type ?? '');
  const [etiquettes, setEtiquettes] = useState(contact?.tags.join(', ') ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function enregistrer(event: FormEvent) {
    event.preventDefault();
    setErreur(undefined);
    if (entreprise.mode === 'existante' && entreprise.choisie === undefined) {
      setErreur('Choisissez une entreprise, ou creez-en une.');
      return;
    }
    const saisie: ContactInput = {
      address: adresse.trim(),
      ...(entreprise.mode === 'existante'
        ? { companyId: entreprise.choisie?.id ?? '' }
        : {
            newCompany: {
              name: entreprise.nom.trim(),
              ...(entreprise.domaine.trim() === '' ? {} : { domain: entreprise.domaine.trim() }),
            },
          }),
      contactName: nom.trim() === '' ? null : nom.trim(),
      salutation: civilite.trim() === '' ? null : civilite.trim(),
      ...(type === '' ? {} : { type }),
      tags: parseTags(etiquettes),
    };
    setEnvoi(true);
    try {
      if (contact === undefined) {
        onSaved(await createContact(saisie));
      } else {
        const patch = contactPatch(contact, saisie);
        onSaved(Object.keys(patch).length === 0 ? contact : await updateContact(contact.id, patch));
      }
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "L'enregistrement n'a pas abouti.");
      setEnvoi(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titre}
      onClose={onClose}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-0 text-text shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={(event) => void enregistrer(event)} className="p-5">
        <h2 id={titre} className="text-lg font-semibold">
          {contact === undefined ? 'Nouveau contact' : 'Modifier le contact'}
        </h2>
        {contact !== undefined && (
          <p className="mt-1 text-xs text-text-faint">
            Corriger l&apos;adresse relance ses controles ; l&apos;historique de l&apos;ancienne est
            conserve.
          </p>
        )}

        <label className="mt-4 block text-sm">
          <span className="font-medium">Adresse</span>
          <input
            type="email"
            required
            value={adresse}
            onChange={(event) => {
              setAdresse(event.target.value);
            }}
            className={`${CHAMP} font-mono`}
            autoComplete="off"
          />
        </label>

        <ChoixEntreprise valeur={entreprise} onChange={setEntreprise} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Nom du contact</span>
            <input
              value={nom}
              maxLength={200}
              onChange={(event) => {
                setNom(event.target.value);
              }}
              className={CHAMP}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Civilite</span>
            <input
              value={civilite}
              maxLength={100}
              placeholder="Madame, Monsieur"
              onChange={(event) => {
                setCivilite(event.target.value);
              }}
              className={CHAMP}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Type</span>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
              }}
              className={CHAMP}
            >
              {contact === undefined && <option value="">Deduit de l&apos;adresse</option>}
              {TYPE_FILTERS.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {ALL_EMAIL_TYPE_LABELS[valeur]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Etiquettes</span>
            <input
              value={etiquettes}
              placeholder="salon 2026, lyon"
              onChange={(event) => {
                setEtiquettes(event.target.value);
              }}
              className={CHAMP}
            />
          </label>
        </div>

        {erreur !== undefined && (
          <p role="alert" className="mt-4 text-sm text-negative">
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
          <Button type="submit" tone="primary" disabled={envoi}>
            {envoi ? 'Enregistrement' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function ChoixEntreprise({
  valeur,
  onChange,
}: {
  valeur: Entreprise;
  onChange: (valeur: Entreprise) => void;
}) {
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<CompanyChoice[]>([]);
  const liste = useId();

  useEffect(() => {
    if (valeur.mode !== 'existante' || valeur.choisie !== undefined) return;
    let actif = true;
    const minuterie = setTimeout(() => {
      lookupCompanies(recherche)
        .then((trouvees) => {
          if (actif) setResultats(trouvees);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, [recherche, valeur]);

  if (valeur.mode === 'nouvelle') {
    return (
      <fieldset className="mt-4 rounded-sm border border-line p-3">
        <legend className="px-1 text-sm font-medium">Nouvelle entreprise</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span>Nom</span>
            <input
              required
              value={valeur.nom}
              maxLength={200}
              onChange={(event) => {
                onChange({ ...valeur, nom: event.target.value });
              }}
              className={CHAMP}
            />
          </label>
          <label className="block text-sm">
            <span>Domaine (facultatif)</span>
            <input
              value={valeur.domaine}
              placeholder="entreprise.fr"
              onChange={(event) => {
                onChange({ ...valeur, domaine: event.target.value });
              }}
              className={CHAMP}
            />
          </label>
        </div>
        <button
          type="button"
          className="mt-2 text-sm text-accent underline"
          onClick={() => {
            onChange({ mode: 'existante', choisie: undefined });
          }}
        >
          Choisir une entreprise existante
        </button>
      </fieldset>
    );
  }

  if (valeur.choisie !== undefined) {
    return (
      <div className="mt-4 text-sm">
        <span className="font-medium">Entreprise</span>
        <div className="mt-1 flex items-center justify-between gap-3 rounded-sm border border-line px-2.5 py-1.5">
          <span>
            {valeur.choisie.name}
            {valeur.choisie.domain !== null && (
              <span className="ml-2 text-text-faint">{valeur.choisie.domain}</span>
            )}
          </span>
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              onChange({ mode: 'existante', choisie: undefined });
            }}
          >
            Changer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 text-sm">
      <label className="block">
        <span className="font-medium">Entreprise</span>
        <input
          type="search"
          value={recherche}
          placeholder="Nom ou domaine"
          aria-controls={liste}
          onChange={(event) => {
            setRecherche(event.target.value);
          }}
          className={CHAMP}
        />
      </label>
      <ul id={liste} className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-line">
        {resultats.length === 0 ? (
          <li className="px-2.5 py-1.5 text-text-faint">Aucune entreprise trouvee.</li>
        ) : (
          resultats.map((choix) => (
            <li key={choix.id}>
              <button
                type="button"
                className="block w-full px-2.5 py-1.5 text-left hover:bg-raised"
                onClick={() => {
                  onChange({ mode: 'existante', choisie: choix });
                }}
              >
                {choix.name}
                {choix.domain !== null && (
                  <span className="ml-2 text-text-faint">{choix.domain}</span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        className="mt-2 text-accent underline"
        onClick={() => {
          onChange({ mode: 'nouvelle', nom: recherche, domaine: '' });
        }}
      >
        Nouvelle entreprise
      </button>
    </div>
  );
}
