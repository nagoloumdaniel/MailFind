import { useEffect, useId, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  campaignMailerApi,
  looksLikeCampaignMailerToken,
  type CampaignMailerConnection as Connexion,
} from '../lib/campaign-mailer';
import { Button } from './Button';

function messageDe(error: unknown, repli: string): string {
  return error instanceof ApiError ? (error.detail ?? error.title) : repli;
}

/**
 * Connexion a Campaign Mailer (F-1201). L'utilisateur cree un jeton
 * d'integration dans sa page Compte de Campaign Mailer et le colle ici ; le
 * serveur le garde chiffre et ne le rend plus jamais.
 */
export function CampaignMailerConnection() {
  const [connexion, setConnexion] = useState<Connexion | undefined>(undefined);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const champ = useId();

  useEffect(() => {
    let actif = true;
    campaignMailerApi
      .connection()
      .then((c) => {
        if (actif) setConnexion(c);
      })
      .catch(() => {
        if (actif) setErreur("L'etat de la connexion n'a pas pu etre lu.");
      });
    return () => {
      actif = false;
    };
  }, []);

  async function agir(action: () => Promise<Connexion>, repli: string) {
    setEnvoi(true);
    setErreur(undefined);
    try {
      setConnexion(await action());
      setSaisie('');
    } catch (error) {
      setErreur(messageDe(error, repli));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-base font-semibold">Campaign Mailer</h2>
      <p className="mt-2 text-sm text-text-soft">
        Envoyez une selection d&apos;adresses vers une campagne en brouillon de Campaign Mailer.
        Rien ne part sans vous : seul Campaign Mailer lance l&apos;envoi, quand vous le decidez.
      </p>

      {connexion?.available === false && (
        <p className="mt-3 text-sm text-text-faint">
          L&apos;envoi vers Campaign Mailer n&apos;est pas configure sur ce serveur.
        </p>
      )}

      {connexion?.connected === true && (
        <div className="mt-4 text-sm">
          <p>
            Connecte avec le jeton{' '}
            <span className="font-mono">{connexion.tokenPrefix ?? ''}...</span>
            {connexion.connectedAt !== null &&
              `, depuis le ${new Date(connexion.connectedAt).toLocaleDateString('fr-FR')}`}
            {connexion.lastUsedAt !== null &&
              `, dernier envoi le ${new Date(connexion.lastUsedAt).toLocaleDateString('fr-FR')}`}
            .
          </p>
          <div className="mt-3">
            <Button
              type="button"
              disabled={envoi}
              onClick={() =>
                void agir(() => campaignMailerApi.disconnect(), "La deconnexion n'a pas abouti.")
              }
            >
              Deconnecter
            </Button>
          </div>
        </div>
      )}

      {connexion !== undefined && connexion.available && (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void agir(() => campaignMailerApi.connect(saisie), "La connexion n'a pas abouti.");
          }}
        >
          <label htmlFor={champ} className="block text-sm text-text-soft">
            {connexion.connected ? 'Remplacer le jeton' : "Jeton d'integration de Campaign Mailer"}
          </label>
          <p className="mt-1 text-xs text-text-faint">
            A creer dans Campaign Mailer, page Mon compte, carte Jetons d&apos;integration, avec les
            deux autorisations.
          </p>
          <input
            id={champ}
            type="password"
            value={saisie}
            onChange={(event) => {
              setSaisie(event.target.value);
            }}
            autoComplete="off"
            placeholder="cm_..."
            className="mt-2 block w-full max-w-md rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-sm"
          />
          <div className="mt-3">
            <Button type="submit" disabled={envoi || !looksLikeCampaignMailerToken(saisie)}>
              {connexion.connected ? 'Remplacer' : 'Connecter'}
            </Button>
          </div>
        </form>
      )}

      {erreur !== undefined && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {erreur}
        </p>
      )}
    </section>
  );
}
