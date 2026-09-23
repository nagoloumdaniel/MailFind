import { Navigate, useSearchParams } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../lib/session';

const ERREURS: Record<string, string> = {
  refus: 'La connexion a ete interrompue. Reessayez quand vous voulez.',
  technique: 'La connexion a echoue de notre cote. Reessayez dans un instant.',
};

/**
 * Une adresse telle que MailFind la rend : jamais seule, toujours accompagnee
 * de l'endroit exact ou elle a ete trouvee, de la methode et de la date.
 *
 * La deuxieme fiche est la plus importante des deux. Elle montre le cas ou le
 * produit ne sait pas, et le dit. Un ecran d'accueil qui n'exposerait que des
 * adresses verifiees promettrait ce qu'aucun outil ne peut tenir.
 */
function Specimen() {
  return (
    <div className="space-y-3">
      <article className="overflow-hidden rounded-md border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <p className="font-mono text-sm">contact@acme.fr</p>
          <p className="mt-0.5 text-xs text-text-faint">Acme SAS, acme.fr</p>
        </header>
        <dl className="divide-y divide-line text-xs">
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Statut</dt>
            <dd className="flex items-start gap-1.5">
              {/* Un disque plein. La forme distingue, pas la couleur. */}
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-text" />
              Boite existante, verifiee le 18 septembre
            </dd>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Source</dt>
            <dd className="font-mono break-all">acme.fr/contact</dd>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Methode</dt>
            <dd>Lien mailto dans la page</dd>
          </div>
        </dl>
      </article>

      <article className="overflow-hidden rounded-md border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <p className="font-mono text-sm">recrutement@beta.io</p>
          <p className="mt-0.5 text-xs text-text-faint">Beta Group, beta.io</p>
        </header>
        <dl className="divide-y divide-line text-xs">
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Statut</dt>
            <dd className="flex items-start gap-1.5">
              {/* Un cercle vide : on ne sait pas, et ca se voit au premier regard. */}
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-text-faint" />
              Le serveur accepte tout, impossible de conclure
            </dd>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Source</dt>
            <dd className="font-mono break-all">beta.io/carrieres</dd>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 px-4 py-2">
            <dt className="text-text-faint">Methode</dt>
            <dd>Texte de la page carrieres</dd>
          </div>
        </dl>
      </article>

      <p className="text-xs text-text-faint">
        Deux adresses reelles telles que MailFind les rend. La seconde ne sera jamais presentee
        comme verifiee.
      </p>
    </div>
  );
}

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
      {/*
        Meme conteneur et memes gouttieres que les pages de l'application : une
        marge qui change d'un ecran a l'autre se voit, et donne l'impression de
        deux produits colles ensemble.
      */}
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4">
        <div className="flex h-14 items-center justify-between">
          <Logo size={26} title="MailFind" />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col justify-center py-16">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_440px]">
            <div>
              <h1 className="max-w-[16ch] text-4xl leading-[1.05] font-bold sm:text-5xl">
                Des adresses professionnelles, avec leur source.
              </h1>

              <p className="mt-5 max-w-[56ch] text-base text-text-soft">
                Importez une liste d&apos;entreprises. MailFind identifie chaque societe, relit les
                pages publiques de son site, verifie les adresses trouvees et garde, pour chacune,
                la page exacte d&apos;ou elle vient et la date.
              </p>

              {erreur !== null && (
                <p
                  role="alert"
                  className="mt-6 max-w-[56ch] rounded-sm border border-negative/40 bg-negative/5 px-3 py-2 text-sm text-negative"
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
                  className="inline-flex items-center rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
                >
                  Se connecter avec Google
                </a>
              </div>
            </div>

            <Specimen />
          </div>

          <dl className="mt-14 grid gap-8 border-t border-line pt-8 sm:grid-cols-3 sm:gap-6">
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
