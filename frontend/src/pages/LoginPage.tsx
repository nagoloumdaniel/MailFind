import { Navigate, useSearchParams } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../lib/session';

const ERREURS: Record<string, string> = {
  refus: 'La connexion a ete interrompue. Reessayez quand vous voulez.',
  technique: 'La connexion a echoue de notre cote. Reessayez dans un instant.',
};

/**
 * Ce que fait MailFind, et surtout ce qu'il ne fait pas. Dire ici qu'aucun
 * acces a la messagerie n'est demande n'est pas un argument commercial : c'est
 * la seule facon de rendre verifiable la promesse que le bouton tient.
 */
export function LoginPage() {
  const { state } = useSession();
  const [params] = useSearchParams();
  const erreur = params.get('erreur');

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-6">
        <div className="flex items-center justify-between py-6">
          <Logo size={26} title="MailFind" />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col justify-center pb-24">
          <h1
            className="max-w-[16ch] text-4xl leading-[1.1] font-bold sm:text-5xl"
            style={{ fontStretch: '118%' }}
          >
            Des adresses professionnelles, avec leur source.
          </h1>

          <p className="mt-5 max-w-[62ch] text-base text-text-soft">
            Importez une liste d&apos;entreprises. MailFind identifie chaque societe, relit les
            pages publiques de son site, verifie les adresses trouvees et garde, pour chacune, la
            page exacte d&apos;ou elle vient et la date.
          </p>

          {erreur !== null && (
            <p
              role="alert"
              className="mt-6 max-w-[62ch] rounded-[var(--radius-sm)] border border-negative/40 bg-negative/5 px-3 py-2 text-sm text-negative"
            >
              {ERREURS[erreur] ?? 'La connexion a echoue. Reessayez.'}
            </p>
          )}

          <div className="mt-8">
            {/*
              Une vraie navigation, pas un appel en arriere plan : le serveur
              doit poser son jeton d'etat dans la session avant de partir chez
              Google.
            */}
            <a
              href="/api/auth/google"
              className="inline-flex items-center rounded-[var(--radius-sm)] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
            >
              Se connecter avec Google
            </a>
          </div>

          <dl className="mt-14 grid gap-px border-t border-line pt-8 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-semibold text-text">Aucun acces a votre messagerie</dt>
              <dd className="mt-1 max-w-[34ch] text-sm text-text-soft">
                Google ne nous transmet que votre nom et votre adresse. MailFind ne lit ni
                n&apos;envoie aucun courrier.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-text">Chaque adresse a une source</dt>
              <dd className="mt-1 max-w-[34ch] text-sm text-text-soft">
                L&apos;URL, la methode et la date sont conservees. Une adresse sans source
                n&apos;est pas enregistree.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-text">Les sites sont respectes</dt>
              <dd className="mt-1 max-w-[34ch] text-sm text-text-soft">
                Le robot suit robots.txt, se limite a une requete par seconde et par domaine, et
                s&apos;annonce.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
