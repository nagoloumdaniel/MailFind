import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { ApiError, apiFetch } from '../lib/api';
import { useSession } from '../lib/session';

export function AccountPage() {
  const { state, signOut } = useSession();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState('');
  const [suppression, setSuppression] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function seDeconnecter() {
    await signOut();
    void navigate('/connexion');
  }

  async function supprimer() {
    setSuppression(true);
    setErreur(undefined);
    try {
      await apiFetch('/api/account', { method: 'DELETE' });
      void navigate('/connexion');
    } catch (error) {
      setErreur(error instanceof ApiError ? error.message : "La suppression n'a pas abouti.");
      setSuppression(false);
    }
  }

  return (
    <div className="max-w-[70ch]">
      <h1 className="text-2xl font-bold" style={{ fontStretch: '115%' }}>
        Compte
      </h1>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-base font-semibold">Identite</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-text-faint">Adresse</dt>
          <dd className="font-mono">{user.email}</dd>
          <dt className="text-text-faint">Nom</dt>
          <dd>{user.name ?? 'Non communique par Google'}</dd>
          <dt className="text-text-faint">Conditions</dt>
          <dd>
            {user.termsAccepted
              ? `Version ${user.termsVersion ?? ''} acceptee`
              : 'En attente d’acceptation'}
          </dd>
        </dl>
        <p className="mt-4 text-sm text-text-soft">
          Ces informations viennent de Google et se mettent a jour a chaque connexion. MailFind
          n&apos;a acces a rien d&apos;autre de votre compte Google.
        </p>
        <div className="mt-4">
          <Button
            onClick={() => {
              void seDeconnecter();
            }}
          >
            Se deconnecter
          </Button>
        </div>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-base font-semibold">Exporter mes donnees</h2>
        <p className="mt-2 text-sm text-text-soft">
          Un fichier JSON contenant votre compte, vos entreprises, vos adresses et la source de
          chacune. Rien n&apos;est retenu : ce que MailFind sait de vous tient dans ce fichier.
        </p>
        <div className="mt-4">
          {/*
            Un lien et non un appel en arriere plan : le navigateur sait
            telecharger un fichier, et l'API l'envoie en piece jointe.
          */}
          <a
            href="/api/account/export"
            className="inline-flex items-center rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-raised"
          >
            Telecharger mes donnees
          </a>
        </div>
      </section>

      <section className="mt-8 border-t border-negative/40 pt-6">
        <h2 className="text-base font-semibold">Supprimer mon compte</h2>
        <p className="mt-2 text-sm text-text-soft">
          La suppression est definitive et immediate. Le compte, les entreprises, les adresses et
          leurs sources sont effaces. Il n&apos;y a pas de corbeille et pas de restauration.
        </p>

        <label className="mt-4 block text-sm">
          <span className="text-text-soft">
            Pour confirmer, tapez <span className="font-mono font-semibold">SUPPRIMER</span>
          </span>
          <input
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            className="mt-1.5 block w-56 rounded-[var(--radius-sm)] border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-sm text-text"
            autoComplete="off"
          />
        </label>

        {erreur !== undefined && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {erreur}
          </p>
        )}

        <div className="mt-4">
          <Button
            tone="danger"
            disabled={confirmation !== 'SUPPRIMER' || suppression}
            onClick={() => {
              void supprimer();
            }}
          >
            {suppression ? 'Suppression' : 'Supprimer definitivement mon compte'}
          </Button>
        </div>
      </section>
    </div>
  );
}
