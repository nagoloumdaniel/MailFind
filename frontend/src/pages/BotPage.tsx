import { useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { ApiError, apiFetch } from '../lib/api';

/**
 * La page publique de l&apos;agent de collecte (R-07).
 *
 * Hors session : un webmestre qui veut nous arreter n&apos;a pas de compte chez
 * nous, et lui en demander un reviendrait a ne pas repondre. Le formulaire ne
 * demande ni nom ni adresse : rien de personnel n&apos;est garde.
 *
 * Le texte dit d&apos;abord ce que le robot ne fait pas. C&apos;est ce qu&apos;on
 * veut savoir quand on decouvre un robot dans ses journaux.
 */
export function BotPage() {
  const [domaine, setDomaine] = useState('');
  const [etat, setEtat] = useState<'saisie' | 'envoi' | 'enregistre'>('saisie');
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [adresse, setAdresse] = useState('');
  const [etatEffacement, setEtatEffacement] = useState<'saisie' | 'envoi'>('saisie');
  const [efface, setEfface] = useState<number | undefined>(undefined);

  function soumettreEffacement(evenement: React.FormEvent) {
    evenement.preventDefault();
    void effacer();
  }

  async function effacer() {
    setEtatEffacement('envoi');
    setErreur(undefined);
    try {
      const reponse = await apiFetch<{ erased: number }>('/api/bot/effacement', {
        method: 'POST',
        body: JSON.stringify({ address: adresse.trim() }),
      });
      setEfface(reponse.erased);
    } catch (error) {
      setErreur(
        error instanceof ApiError ? error.message : "L'effacement n'a pas pu etre enregistre.",
      );
      setEtatEffacement('saisie');
    }
  }

  function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    void demander();
  }

  async function demander() {
    setEtat('envoi');
    setErreur(undefined);
    try {
      await apiFetch('/api/bot/exclusion', {
        method: 'POST',
        body: JSON.stringify({ domain: domaine.trim() }),
      });
      setEtat('enregistre');
    } catch (error) {
      setErreur(
        error instanceof ApiError ? error.message : "La demande n'a pas pu etre enregistree.",
      );
      setEtat('saisie');
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4">
        <div className="flex h-14 items-center justify-between">
          <Link to="/connexion" className="flex items-center gap-2">
            <Logo size={26} title="MailFind" />
          </Link>
          <ThemeToggle />
        </div>

        <div className="mx-auto w-full max-w-[72ch] py-12">
          <h1 className="text-3xl font-bold">MailFindBot</h1>
          <p className="mt-4 text-text-soft">
            MailFind lit les pages publiques du site d&apos;une entreprise pour y relever les
            adresses de contact qu&apos;elle y publie, et garde pour chacune la page exacte
            d&apos;ou elle vient. Si vous avez vu <code className="font-mono">MailFindBot</code>{' '}
            dans vos journaux, cette page dit ce qu&apos;il fait, et comment lui demander de ne plus
            venir.
          </p>

          <h2 className="mt-10 text-lg font-semibold">Ce qu&apos;il ne fait pas</h2>
          <ul className="mt-3 space-y-2 text-sm text-text-soft">
            <li>Il ne se connecte a aucun espace protege, et ne remplit aucun formulaire.</li>
            <li>
              Il ne tente pas de decoder une adresse que vous avez masquee volontairement, par une
              image ou par du JavaScript.
            </li>
            <li>Il ne contourne ni CAPTCHA, ni limite de debit, ni blocage.</li>
            <li>Il ne lit aucune page que votre robots.txt lui interdit.</li>
          </ul>

          <h2 className="mt-10 text-lg font-semibold">Comment il se comporte</h2>
          <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
            <div className="grid grid-cols-[12rem_1fr] gap-3 py-2">
              <dt className="text-text-faint">Il s&apos;annonce</dt>
              <dd className="font-mono text-xs break-all">
                MailFindBot/0.1 (+https://mailfind.app/bot)
              </dd>
            </div>
            <div className="grid grid-cols-[12rem_1fr] gap-3 py-2">
              <dt className="text-text-faint">Rythme</dt>
              <dd>Une requete par seconde au plus, et une seule a la fois, par domaine.</dd>
            </div>
            <div className="grid grid-cols-[12rem_1fr] gap-3 py-2">
              <dt className="text-text-faint">Pages lues</dt>
              <dd>
                L&apos;accueil, et quelques pages ciblees : contact, carrieres, mentions legales,
                equipe. Vingt-cinq au plus, selon la profondeur choisie.
              </dd>
            </div>
            <div className="grid grid-cols-[12rem_1fr] gap-3 py-2">
              <dt className="text-text-faint">robots.txt</dt>
              <dd>Respecte, y compris le delai que vous y demandez.</dd>
            </div>
          </dl>

          <h2 className="mt-10 text-lg font-semibold">Demander a ne plus etre explore</h2>
          <p className="mt-3 text-sm text-text-soft">
            Indiquez votre domaine. La demande prend effet tout de suite, pour tous les comptes
            MailFind, et couvre vos sous-domaines. Nous ne vous demandons ni nom ni adresse.
          </p>

          {etat === 'enregistre' ? (
            <p
              role="status"
              className="mt-5 rounded-sm border border-line bg-surface px-3 py-2.5 text-sm"
            >
              C&apos;est enregistre. <strong>{domaine.trim()}</strong> et ses sous-domaines ne
              seront plus explores. Vous n&apos;avez rien d&apos;autre a faire.
            </p>
          ) : (
            <form onSubmit={soumettre} className="mt-5 flex flex-wrap items-start gap-2">
              <label className="sr-only" htmlFor="domaine">
                Domaine
              </label>
              <input
                id="domaine"
                value={domaine}
                onChange={(evenement) => {
                  setDomaine(evenement.target.value);
                }}
                placeholder="acme.fr"
                required
                className="min-w-[16rem] flex-1 rounded-sm border border-line bg-surface px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={etat === 'envoi'}
                className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-strong disabled:opacity-60"
              >
                {etat === 'envoi' ? 'Enregistrement...' : 'Ne plus explorer ce site'}
              </button>
            </form>
          )}

          {erreur !== undefined && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {erreur}
            </p>
          )}

          <h2 className="mt-12 text-lg font-semibold">Faire effacer une adresse</h2>
          <p className="mt-3 text-sm text-text-soft">
            Si votre adresse figure dans nos resultats et que vous voulez qu&apos;elle en parte,
            indiquez-la. Elle est effacee de tous les comptes et ne sera plus collectee. Nous
            n&apos;en gardons qu&apos;une empreinte, qui ne permet pas de la relire, et qui sert a
            la reconnaitre si elle reapparait.
          </p>

          {efface === undefined ? (
            <form onSubmit={soumettreEffacement} className="mt-5 flex flex-wrap items-start gap-2">
              <label className="sr-only" htmlFor="adresse">
                Adresse email
              </label>
              <input
                id="adresse"
                type="email"
                value={adresse}
                onChange={(evenement) => {
                  setAdresse(evenement.target.value);
                }}
                placeholder="prenom.nom@acme.fr"
                required
                className="min-w-[16rem] flex-1 rounded-sm border border-line bg-surface px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={etatEffacement === 'envoi'}
                className="rounded-sm border border-line bg-surface px-4 py-2 text-sm font-semibold hover:border-text-faint disabled:opacity-60"
              >
                {etatEffacement === 'envoi' ? 'Effacement...' : 'Effacer cette adresse'}
              </button>
            </form>
          ) : (
            <p
              role="status"
              className="mt-5 rounded-sm border border-line bg-surface px-3 py-2.5 text-sm"
            >
              C&apos;est fait.{' '}
              {efface === 0
                ? 'Cette adresse ne figurait dans aucun compte. Elle ne pourra plus y entrer.'
                : `${String(efface)} occurrence(s) effacee(s), dans tous les comptes. L'adresse ne pourra plus etre collectee.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
