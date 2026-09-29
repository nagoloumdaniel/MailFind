import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import { Button } from './Button';

interface Resultat {
  added: number;
  alreadyListed: number;
  invalid: number;
  libraryUpdated: number;
}

/**
 * Liste de suppression (R-04) : les adresses a ne plus jamais collecter ni
 * transmettre. Le serveur n'en garde que l'empreinte ; l'ecran montre donc un
 * nombre, pas une liste.
 */
export function SuppressionList() {
  const [nombre, setNombre] = useState<number | undefined>(undefined);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | undefined>(
    undefined,
  );

  useEffect(() => {
    let actif = true;
    apiFetch<{ count: number }>('/api/suppressions')
      .then(({ count }) => {
        if (actif) setNombre(count);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, []);

  const adresses = saisie
    .split(/[\s,;]+/)
    .map((adresse) => adresse.trim())
    .filter((adresse) => adresse !== '');

  async function ajouter() {
    setEnvoi(true);
    setMessage(undefined);
    try {
      const resultat = await apiFetch<Resultat>('/api/suppressions', {
        method: 'POST',
        body: JSON.stringify({ addresses: adresses }),
      });
      const morceaux = [
        `${String(resultat.added)} adresse${resultat.added > 1 ? 's' : ''} ajoutee${resultat.added > 1 ? 's' : ''}`,
      ];
      if (resultat.alreadyListed > 0)
        morceaux.push(`${String(resultat.alreadyListed)} deja dans la liste`);
      if (resultat.invalid > 0)
        morceaux.push(
          `${String(resultat.invalid)} mal formee${resultat.invalid > 1 ? 's' : ''}, ignoree${resultat.invalid > 1 ? 's' : ''}`,
        );
      if (resultat.libraryUpdated > 0) {
        morceaux.push(
          `${String(resultat.libraryUpdated)} retiree${resultat.libraryUpdated > 1 ? 's' : ''} de votre bibliotheque`,
        );
      }
      setMessage({ ton: 'ok', texte: `${morceaux.join(', ')}.` });
      setNombre((actuel) => (actuel ?? 0) + resultat.added);
      setSaisie('');
    } catch (error) {
      setMessage({
        ton: 'erreur',
        texte:
          error instanceof ApiError ? (error.detail ?? error.title) : "L'ajout n'a pas abouti.",
      });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-base font-semibold">Liste de suppression</h2>
      <p className="mt-2 text-sm text-text-soft">
        Les adresses que vous ne voulez plus jamais voir collectees ni transmises, par exemple
        celles de personnes qui vous l&apos;ont demande. Elles ne reviennent dans aucun import, et
        celles deja dans votre bibliotheque sont retirees des exports. MailFind n&apos;en garde
        qu&apos;une empreinte : la liste elle-meme ne peut pas etre relue.
      </p>
      <p className="mt-3 text-sm">
        {nombre === undefined
          ? ' '
          : `${nombre.toLocaleString('fr-FR')} adresse${nombre > 1 ? 's' : ''} dans la liste.`}
      </p>
      <label htmlFor="suppressions" className="sr-only">
        Adresses a ajouter a la liste de suppression
      </label>
      <textarea
        id="suppressions"
        value={saisie}
        onChange={(event) => {
          setSaisie(event.target.value);
        }}
        rows={3}
        placeholder="Une adresse par ligne, ou separees par des virgules"
        className="mt-3 w-full rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-sm"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={adresses.length === 0 || envoi} onClick={() => void ajouter()}>
          {envoi ? 'Ajout en cours' : 'Ajouter a la liste'}
        </Button>
        {message !== undefined && (
          <p
            role={message.ton === 'erreur' ? 'alert' : 'status'}
            className={`text-sm ${message.ton === 'erreur' ? 'text-negative' : 'text-text-soft'}`}
          >
            {message.texte}
          </p>
        )}
      </div>
    </section>
  );
}
