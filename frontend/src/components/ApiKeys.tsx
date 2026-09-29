import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  API_SCOPES,
  createApiKey,
  lastUsedLabel,
  listApiKeys,
  revokeApiKey,
  scopeLabel,
  type ApiKey,
  type ApiScope,
} from '../lib/api-keys';
import { Button } from './Button';

function messageDe(error: unknown, repli: string): string {
  return error instanceof ApiError ? (error.detail ?? error.title) : repli;
}

/**
 * Cles de l'API publique (F-1302). Le secret n'est montre qu'une fois, juste
 * apres la creation : le serveur n'en garde que l'empreinte, et ne pourrait
 * pas le rendre une seconde fois.
 */
export function ApiKeys() {
  const [cles, setCles] = useState<ApiKey[] | undefined>(undefined);
  const [maximum, setMaximum] = useState(10);
  const [nom, setNom] = useState('');
  const [portees, setPortees] = useState<ApiScope[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const [copiee, setCopiee] = useState(false);
  const [aRevoquer, setARevoquer] = useState<ApiKey | undefined>(undefined);
  const champNom = useId();

  useEffect(() => {
    let actif = true;
    listApiKeys()
      .then(({ keys, maxActive }) => {
        if (!actif) return;
        setCles(keys);
        setMaximum(maxActive);
      })
      .catch(() => {
        if (actif) setErreur("Les cles n'ont pas pu etre chargees.");
      });
    return () => {
      actif = false;
    };
  }, []);

  const actives = cles?.filter((cle) => cle.revokedAt === null).length ?? 0;

  async function creer() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      const { key, secret: nouveau } = await createApiKey(nom.trim(), portees);
      setCles((actuelles) => [key, ...(actuelles ?? [])]);
      setSecret(nouveau);
      setCopiee(false);
      setNom('');
      setPortees([]);
    } catch (error) {
      setErreur(messageDe(error, "La creation n'a pas abouti."));
    } finally {
      setEnvoi(false);
    }
  }

  async function copier() {
    if (secret === undefined) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopiee(true);
    } catch {
      // Presse-papiers refuse (page non securisee, permission) : le champ
      // reste selectionnable a la main.
      setCopiee(false);
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-base font-semibold">Cles d&apos;API</h2>
      <p className="mt-2 text-sm text-text-soft">
        Une cle permet a une autre application d&apos;utiliser MailFind en votre nom, dans les
        limites des portees choisies. Donnez-lui seulement ce dont elle a besoin, et revoquez-la des
        qu&apos;elle ne sert plus.
      </p>

      {secret !== undefined && (
        <div role="status" className="mt-4 rounded-sm border border-accent bg-raised p-4">
          <p className="text-sm font-semibold">Copiez cette cle maintenant.</p>
          <p className="mt-1 text-sm text-text-soft">
            Elle ne sera plus jamais affichee. Si vous la perdez, revoquez-la et creez-en une autre.
          </p>
          <label className="sr-only" htmlFor={`${champNom}-secret`}>
            Nouvelle cle d&apos;API
          </label>
          <input
            id={`${champNom}-secret`}
            readOnly
            value={secret}
            onFocus={(event) => {
              event.target.select();
            }}
            className="mt-3 w-full rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-sm"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void copier()}>
              {copiee ? 'Copiee' : 'Copier'}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSecret(undefined);
              }}
            >
              J&apos;ai range la cle
            </Button>
          </div>
        </div>
      )}

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void creer();
        }}
      >
        <label htmlFor={champNom} className="block text-sm text-text-soft">
          Nom de la cle, pour la reconnaitre
        </label>
        <input
          id={champNom}
          value={nom}
          maxLength={100}
          onChange={(event) => {
            setNom(event.target.value);
          }}
          placeholder="Par exemple : CRM, script de prospection"
          className="mt-1.5 block w-full max-w-sm rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
          autoComplete="off"
        />
        <fieldset className="mt-4">
          <legend className="text-sm text-text-soft">Portees</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {API_SCOPES.map((scope) => (
              <label key={scope.value} className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={portees.includes(scope.value)}
                  onChange={(event) => {
                    const coche = event.target.checked;
                    setPortees((actuelles) =>
                      coche
                        ? [...actuelles, scope.value]
                        : actuelles.filter((p) => p !== scope.value),
                    );
                  }}
                />
                <span>{scope.label}</span>
                <span className="font-mono text-xs text-text-faint">{scope.value}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={nom.trim() === '' || portees.length === 0 || envoi || actives >= maximum}
          >
            {envoi ? 'Creation' : 'Creer une cle'}
          </Button>
          <span className="text-sm text-text-faint">
            {actives} sur {maximum} cles actives
          </span>
        </div>
        {erreur !== undefined && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {erreur}
          </p>
        )}
      </form>

      {cles !== undefined && cles.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {cles.map((cle) => (
            <li key={cle.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className={`min-w-0 text-sm ${cle.revokedAt === null ? '' : 'text-text-faint'}`}>
                <p className="font-medium">
                  {cle.name} <span className="font-mono text-text-faint">{cle.prefix}...</span>
                </p>
                <p className="mt-1 text-text-soft">{cle.scopes.map(scopeLabel).join(', ')}</p>
                <p className="mt-1 text-text-faint">
                  Creee le {new Date(cle.createdAt).toLocaleDateString('fr-FR')} ·{' '}
                  {cle.revokedAt === null
                    ? lastUsedLabel(cle)
                    : `Revoquee le ${new Date(cle.revokedAt).toLocaleDateString('fr-FR')}`}
                </p>
              </div>
              {cle.revokedAt === null && (
                <Button
                  type="button"
                  tone="danger"
                  onClick={() => {
                    setARevoquer(cle);
                  }}
                >
                  Revoquer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {aRevoquer !== undefined && (
        <RevokeDialog
          apiKey={aRevoquer}
          onClose={() => {
            setARevoquer(undefined);
          }}
          onRevoked={(revoquee) => {
            setCles((actuelles) =>
              actuelles?.map((cle) => (cle.id === revoquee.id ? revoquee : cle)),
            );
            setARevoquer(undefined);
          }}
        />
      )}
    </section>
  );
}

function RevokeDialog({
  apiKey,
  onClose,
  onRevoked,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onRevoked: (key: ApiKey) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titre = useId();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function confirmer() {
    setEnvoi(true);
    setErreur(undefined);
    try {
      onRevoked((await revokeApiKey(apiKey.id)).key);
    } catch (error) {
      setErreur(messageDe(error, "La revocation n'a pas abouti."));
      setEnvoi(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titre}
      onClose={onClose}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-5 text-text shadow-xl backdrop:bg-black/40"
    >
      <h2 id={titre} className="text-lg font-semibold">
        Revoquer la cle {apiKey.name} ?
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        Les applications qui l&apos;utilisent perdent l&apos;acces tout de suite. Une cle revoquee
        ne se retablit pas : il faudra en creer une autre.
      </p>
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
          {envoi ? 'Revocation' : 'Revoquer la cle'}
        </Button>
      </div>
    </dialog>
  );
}
