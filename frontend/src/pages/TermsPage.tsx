import { useState } from 'react';
import { Navigate } from 'react-router';
import { Button } from '../components/Button';
import { ApiError, apiFetch } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Version en vigueur, la meme que celle du serveur. Le jour ou le texte change,
 * les deux changent ensemble et l&apos;accord est redemande (F-102).
 */
const CURRENT_TERMS_VERSION = '2026-09-23';

export function TermsPage() {
  const { state, refresh } = useSession();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  if (state.status === 'anonymous') return <Navigate to="/connexion" replace />;
  if (state.status === 'authenticated' && state.user.termsAccepted)
    return <Navigate to="/" replace />;

  async function accepter() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      await apiFetch('/api/auth/terms', {
        method: 'POST',
        body: JSON.stringify({ version: CURRENT_TERMS_VERSION }),
      });
      await refresh();
    } catch (error) {
      setErreur(
        error instanceof ApiError ? error.message : "L'acceptation n'a pas pu etre enregistree.",
      );
      setEnvoi(false);
    }
  }

  return (
    <div className="mx-auto max-w-[70ch]">
      <h1 className="text-2xl font-bold" style={{ fontStretch: '115%' }}>
        Avant de commencer
      </h1>

      <p className="mt-3 text-sm text-text-soft">
        MailFind collecte des donnees publiques sur les sites des entreprises que vous lui donnez.
        Voici ce que cela engage, de votre cote comme du notre.
      </p>

      <ul className="mt-6 space-y-4 border-t border-line pt-6 text-sm">
        <li>
          <span className="font-semibold text-text">Vous restez responsable de vos envois.</span>{' '}
          <span className="text-text-soft">
            La prospection entre professionnels suppose un message en rapport avec la fonction du
            destinataire, et la possibilite de s&apos;y opposer a chaque envoi.
          </span>
        </li>
        <li>
          <span className="font-semibold text-text">
            Vous informez les personnes que vous contactez.
          </span>{' '}
          <span className="text-text-soft">
            Quand une adresse nominative a ete collectee, la personne doit l&apos;apprendre au plus
            tard lors du premier message. MailFind vous fournit la source et une mention type.
          </span>
        </li>
        <li>
          <span className="font-semibold text-text">Nous gardons la provenance.</span>{' '}
          <span className="text-text-soft">
            Chaque adresse porte l&apos;URL, la methode et la date de sa collecte. Vous pouvez
            exporter ou supprimer l&apos;ensemble de vos donnees a tout moment depuis la page
            Compte.
          </span>
        </li>
      </ul>

      <p className="mt-6 text-xs text-text-faint">
        Version du {CURRENT_TERMS_VERSION}. Le texte complet des conditions et la politique de
        confidentialite seront publies avant l&apos;ouverture au public.
      </p>

      {erreur !== undefined && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {erreur}
        </p>
      )}

      <div className="mt-8">
        <Button
          tone="primary"
          disabled={envoi}
          onClick={() => {
            void accepter();
          }}
        >
          {envoi ? 'Enregistrement' : "J'accepte et je continue"}
        </Button>
      </div>
    </div>
  );
}
