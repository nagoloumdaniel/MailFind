import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Les conditions d&apos;utilisation et la politique de confidentialite (R-03,
 * R-11), hors session : une personne qui veut savoir ce que MailFind fait de
 * ses donnees n&apos;a pas de compte chez nous, et le lire ne doit rien
 * demander.
 *
 * Le texte est ici, pas dans un fichier Markdown rendu a cote : c&apos;est
 * celui que l&apos;utilisateur accepte, et il doit changer avec la version
 * qu&apos;il accepte, dans le meme commit.
 */

/** La version en vigueur, la meme que celle du serveur (F-102). */
export const LEGAL_VERSION = '2026-10-02';

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{titre}</h2>
      <div className="mt-2 space-y-3 text-sm text-text-soft">{children}</div>
    </section>
  );
}

function Cadre({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4">
      <div className="flex h-14 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={26} title="MailFind" />
        </Link>
        <ThemeToggle />
      </div>
      <div className="mx-auto w-full max-w-[72ch] pb-16">{children}</div>
    </div>
  );
}

function Navigation() {
  const { pathname } = useLocation();
  const lien = (vers: string, texte: string) => (
    <Link
      to={vers}
      className={
        pathname === vers ? 'font-semibold text-text' : 'text-text-faint hover:text-text-soft'
      }
    >
      {texte}
    </Link>
  );
  return (
    <nav className="mt-6 flex flex-wrap gap-4 border-b border-line pb-4 text-sm">
      {lien('/conditions-utilisation', "Conditions d'utilisation")}
      {lien('/confidentialite', 'Politique de confidentialite')}
      {lien('/robot', 'Agent de collecte')}
    </nav>
  );
}

export function ConditionsPage() {
  return (
    <Cadre>
      <h1 className="mt-6 text-3xl font-bold">Conditions d&apos;utilisation</h1>
      <p className="mt-2 text-xs text-text-faint">Version du {LEGAL_VERSION}.</p>
      <Navigation />

      <Section titre="Ce que fait MailFind">
        <p>
          MailFind part d&apos;une liste d&apos;entreprises que vous fournissez, identifie chaque
          societe, lit les pages publiques de son site, interroge des fournisseurs
          d&apos;enrichissement par leur API officielle, verifie les adresses trouvees et conserve
          pour chacune la page exacte d&apos;ou elle vient, la methode et la date.
        </p>
        <p>
          MailFind n&apos;envoie aucun courrier et n&apos;a aucun acces a votre messagerie. La
          connexion Google ne transmet que votre nom et votre adresse. L&apos;envoi se fait dans
          Campaign Mailer, avec vos propres autorisations.
        </p>
      </Section>

      <Section titre="Ce que vous vous engagez a faire">
        <p>
          <strong className="text-text">Vous restez responsable de vos envois.</strong> La
          prospection entre professionnels suppose un message en rapport avec la fonction du
          destinataire, et la possibilite de s&apos;y opposer a chaque envoi.
        </p>
        <p>
          <strong className="text-text">Vous informez les personnes que vous contactez.</strong>{' '}
          Quand une adresse nominative a ete collectee sans que la personne vous l&apos;ait donnee,
          elle doit l&apos;apprendre au plus tard lors du premier message. MailFind vous fournit la
          source de chaque adresse et une mention type a reprendre.
        </p>
        <p>
          <strong className="text-text">Vous honorez les oppositions.</strong> Une personne qui
          demande a ne plus etre contactee doit l&apos;etre. La liste de suppression de votre compte
          empeche MailFind de collecter a nouveau une adresse que vous y mettez.
        </p>
        <p>
          <strong className="text-text">Vous n&apos;utilisez pas MailFind pour autre chose.</strong>{' '}
          Ni envoi non sollicite en masse, ni revente de listes, ni constitution d&apos;un fichier
          de personnes physiques hors d&apos;un cadre professionnel.
        </p>
      </Section>

      <Section titre="Ce que nous nous engageons a faire">
        <p>
          <strong className="text-text">Chaque adresse porte sa source.</strong> Une adresse sans
          source n&apos;est pas enregistree. Vous pouvez remonter a la page d&apos;origine de
          chacune.
        </p>
        <p>
          <strong className="text-text">La verification est un statut, pas une promesse.</strong>{' '}
          Une adresse dont le serveur accepte tout, ou que nous n&apos;avons pas pu conclure,
          n&apos;est jamais presentee ni exportee comme verifiee.
        </p>
        <p>
          <strong className="text-text">Nous respectons les sites.</strong> Le robot suit
          robots.txt, se limite a une requete par seconde et par domaine, s&apos;annonce, ne se
          connecte a rien et ne contourne aucune protection. Un site peut demander a ne plus etre
          explore depuis la{' '}
          <Link to="/robot" className="underline">
            page de l&apos;agent
          </Link>
          , et la demande vaut pour tous les comptes.
        </p>
      </Section>

      <Section titre="Votre compte">
        <p>
          Le compte est personnel. Vous pouvez exporter l&apos;ensemble de vos donnees ou supprimer
          votre compte a tout moment depuis la page Compte. La suppression efface vos entreprises,
          vos adresses et vos imports ; le journal d&apos;audit garde la trace de la suppression
          elle-meme, sans adresse.
        </p>
        <p>
          Le service est fourni en l&apos;etat, sans garantie que les adresses trouvees soient
          completes, a jour ou valides. Les quotas mensuels par compte sont indiques sur la page
          Compte et peuvent changer.
        </p>
      </Section>

      <Section titre="Droit applicable">
        <p>
          Ces conditions sont soumises au droit francais. Editeur : Daniel Nagoloum Talla. Le
          service est propose a titre professionnel.
        </p>
      </Section>
    </Cadre>
  );
}

export function PrivacyPage() {
  return (
    <Cadre>
      <h1 className="mt-6 text-3xl font-bold">Politique de confidentialite</h1>
      <p className="mt-2 text-xs text-text-faint">Version du {LEGAL_VERSION}.</p>
      <Navigation />

      <Section titre="Deux sortes de donnees, deux roles">
        <p>
          <strong className="text-text">Vos donnees de compte</strong> : votre adresse, votre nom et
          votre identifiant Google. Nous en sommes responsables de traitement. Elles servent a vous
          connecter et a rattacher votre travail a votre compte.
        </p>
        <p>
          <strong className="text-text">Les adresses que MailFind collecte</strong> pour vous : vous
          en etes responsable de traitement, et MailFind est votre sous-traitant. Vous decidez
          quelles entreprises sont traitees et ce que vous faites des resultats ; nous les traitons
          pour votre compte, selon ces conditions.
        </p>
      </Section>

      <Section titre="Ce que nous collectons, et pourquoi">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-text">Compte</strong> : identifiant Google, adresse, nom,
            version des conditions acceptee et sa date. Base legale : l&apos;execution du contrat.
          </li>
          <li>
            <strong className="text-text">Adresses collectees</strong> : l&apos;adresse, son type,
            son statut de verification, son score, et toujours sa source. Base legale :
            l&apos;interet legitime a la prospection entre professionnels, sous votre
            responsabilite.
          </li>
          <li>
            <strong className="text-text">Journal d&apos;audit</strong> : qui a fait quoi, et quand.
            Jamais d&apos;adresse en clair. Base legale : l&apos;interet legitime a pouvoir rendre
            compte.
          </li>
          <li>
            <strong className="text-text">Traces techniques</strong> : identifiant de requete, codes
            de reponse, erreurs. Les adresses et les jetons y sont masques avant enregistrement.
          </li>
        </ul>
      </Section>

      <Section titre="Combien de temps">
        <ul className="list-disc space-y-2 pl-5">
          <li>Une adresse et ses sources : douze mois sans servir, puis effacees.</li>
          <li>Le journal d&apos;audit : douze mois.</li>
          <li>Les traces techniques : quatre-vingt-dix jours.</li>
          <li>Les exports volumineux deposes en stockage : sept jours.</li>
          <li>Votre compte : jusqu&apos;a sa suppression, que vous declenchez.</li>
        </ul>
        <p>Ces durees sont appliquees par une tache automatique, tous les jours.</p>
      </Section>

      <Section titre="Qui d'autre y a acces">
        <p>
          Nos sous-traitants, et personne d&apos;autre. Aucune donnee n&apos;est vendue ni partagee
          a des fins publicitaires. La liste nominative, avec le role de chacun et le lieu
          d&apos;hebergement, est dans{' '}
          <a
            href="https://github.com/nagoloumdaniel/MailFind/blob/main/docs/legal/sous-traitants.md"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            la liste des sous-traitants
          </a>
          .
        </p>
      </Section>

      <Section titre="Vos droits, et ceux des personnes dont l'adresse est collectee">
        <p>
          Vous disposez d&apos;un droit d&apos;acces, de rectification, d&apos;effacement,
          d&apos;opposition et de portabilite. L&apos;acces et la portabilite sont immediats : la
          page Compte exporte l&apos;ensemble de vos donnees dans un fichier. L&apos;effacement
          aussi : la suppression du compte est definitive.
        </p>
        <p>
          Une personne dont l&apos;adresse a ete collectee peut demander son retrait. Une adresse
          signalee est retiree et ne peut plus etre collectee a nouveau. Un site peut demander a ne
          plus etre explore du tout, pour tous les comptes, depuis la{' '}
          <Link to="/robot" className="underline">
            page de l&apos;agent de collecte
          </Link>
          .
        </p>
      </Section>

      <Section titre="Securite">
        <p>
          Les secrets et les reponses des fournisseurs qui contiennent des adresses nominatives sont
          chiffres au repos en AES-256-GCM. Les mots de passe n&apos;existent pas : la connexion
          passe par Google. Les journaux et les rapports d&apos;erreur sont masques avant envoi : ni
          adresse, ni jeton, ni secret n&apos;y figurent.
        </p>
      </Section>

      <Section titre="Nous ecrire">
        <p>
          Pour toute question, ou pour exercer un droit : Daniel Nagoloum Talla, responsable du
          traitement. Les demandes de retrait d&apos;une adresse ou d&apos;un site passent par la{' '}
          <Link to="/robot" className="underline">
            page de l&apos;agent de collecte
          </Link>
          , qui ne demande aucune information personnelle.
        </p>
      </Section>
    </Cadre>
  );
}
