# MailFind

**Des adresses e-mail professionnelles d'entreprises, chacune avec sa source, son statut de vérification et son score.**

> **Bêta fermée. Code visible, tous droits réservés.**
> MailFind n'est pas ouvert au public : pas de facturation, budget de vérification limité (20 crédits Hunter par mois), documents légaux non relus par un juriste. Le code est publié pour être lu, pas pour être réutilisé : ce n'est **pas** un logiciel libre ni open source (voir [Licence](#licence)).

MailFind prend un fichier CSV d'entreprises et rend, pour chacune, les adresses e-mail professionnelles qu'il a trouvées. Chaque adresse garde l'URL ou le fournisseur d'où elle vient, la méthode, la date, un statut de vérification et un score de 0 à 100 dont le détail s'affiche critère par critère. Les résultats s'exportent, ou partent en brouillon de campagne dans [Campaign Mailer](https://github.com/nagoloumdaniel/Campaign-Mailer).

Application web : <https://mailfind.vercel.app> (Vercel). Pendant la bêta fermée, on y voit la page de connexion et quelques pages publiques ; le reste demande un compte.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/captures/mailfind-connexion-sombre.png">
  <img alt="Page de connexion de MailFind : deux adresses d'exemple fictives avec leur source, leur méthode et leur statut, dont une que le produit ne sait pas vérifier et le dit" src="docs/captures/mailfind-connexion.png">
</picture>

*La page de connexion. Les deux adresses affichées (`contact@acme.fr`, `recrutement@beta.io`) sont des **exemples fictifs**, pas des données collectées. Elles illustrent le format : la seconde porte le statut « le serveur accepte tout, impossible de conclure », que MailFind ne présente jamais comme vérifié.*

## Ce que MailFind fait

- **Importe** un CSV (5 000 lignes et 5 Mo au plus) de noms d'entreprises, de domaines ou d'adresses de sites.
- **Identifie** chaque entreprise : identité légale (SIREN) via l'API publique « Recherche d'entreprises », domaine officiel via Brave Search quand il n'est pas fourni.
- **Collecte** sur les pages publiques du site officiel (accueil, contact, carrières, mentions légales, équipe), avec un simple `fetch` et Cheerio, sans navigateur headless. Profondeur au choix : 3, 10 ou 25 pages par site.
- **Enrichit** par Hunter quand le site n'a pas donné le type d'adresse cherché, puis propose des adresses de rôle sur un domaine qui reçoit du courrier.
- **Vérifie** : sept contrôles locaux, et un huitième niveau, la vérification de boîte par Hunter, uniquement sur demande.
- **Exporte** en CSV, XLSX, JSON, ou envoie vers Campaign Mailer par lots de 500, en campagne **brouillon** : seul l'utilisateur la lance.
- **Expose une API publique `/v1`** : clés à portées (hachées), limite de débit par clé, idempotence, pagination par curseur, erreurs RFC 9457, webhooks signés, document OpenAPI 3.1.

## Ce que MailFind ne fait pas

- **Pas d'accès à votre messagerie.** Google ne transmet que le nom et l'adresse (portées d'identité). L'envoi se fait dans Campaign Mailer.
- **Pas de connexion SMTP, pas de port 25.** Aucun sondage de boîte depuis nos serveurs : la vérification de boîte passe par un fournisseur.
- **Pas de contournement.** Le robot suit `robots.txt`, se limite à une requête par seconde et par domaine, s'annonce, ne se connecte à rien, ne décode pas une adresse masquée volontairement, ne contourne ni CAPTCHA ni limite de débit, et ne lit pas les pages rendues uniquement par JavaScript.
- **Pas d'adresse sans source.** Un déclencheur de base de données (`emails_require_source`) refuse l'insertion d'une adresse dont on ne sait pas d'où elle vient.
- **Pas de promesse de vérification.** Une vérification est un statut (`valid`, `risky`, `accept_all`, `unknown`, `unverified`, `invalid`), jamais une garantie. `accept_all`, `unknown` et `unverified` ne sont ni présentés ni exportés comme vérifiés.
- **Pas de taux de couverture annoncé.** Il dépend des sites et du budget de vérification, et n'a pas été mesuré (voir [Chiffres de recette](#chiffres-de-recette)).

## Architecture

```mermaid
flowchart LR
    U[Navigateur] --> W["Application web<br/>React 19 + Vite<br/>Vercel"]
    W -- "/api et /v1" --> A["API Express 5<br/>Railway"]
    A --> PG[("PostgreSQL 18<br/>Neon")]
    A --> R[("Redis Cloud<br/>sessions + files BullMQ")]
    A --> S[("Cloudflare R2<br/>gros exports")]
    R --> K["Processus de traitement<br/>BullMQ<br/>Railway"]
    K --> PG
    K --> S
    K -- "pages publiques" --> SITES[Sites des entreprises]
    K -- "comptés, mis en cache, plafonnés" --> EXT["Fournisseurs<br/>Recherche d'entreprises, Brave, Hunter"]
    A -- "lots de 500, brouillon" --> CM[Campaign Mailer]
```

Deux processus, un dépôt, un schéma de base. L'API répond aux requêtes ; le processus de traitement vide les files. L'application web ne parle à l'API que par ses propres chemins `/api` et `/v1`, que Vercel renvoie vers Railway : le cookie de session reste sur une seule origine. Le détail est dans [docs/architecture.md](docs/architecture.md).

### Le pipeline en cinq étapes

Chaque étape est une tâche BullMQ indépendante : elle peut échouer, être rejouée et reprendre après un redémarrage sans refaire ce qui est fait.

```mermaid
flowchart LR
    P["import.plan<br/>normaliser, dédupliquer"] --> I["company.identify<br/>SIREN, domaine officiel"]
    I --> C["company.crawl<br/>pages publiques,<br/>adresses + sources"]
    C --> E["company.enrich<br/>types manquants :<br/>fournisseur, rôles"]
    E --> V["company.verify<br/>7 contrôles locaux,<br/>niveau 8 sur demande, score"]
```

### Principes tenus dans le code

| Principe | Où |
| --- | --- |
| Aucune adresse sans source | déclencheur `emails_require_source`, migration 0003 |
| Une vérification est un statut | `backend/src/emails/visibility.ts`, exports |
| Score de 0 à 100 décomposé : les lignes du détail totalisent toujours le score | `backend/src/emails/score.ts` (D-18) |
| Garde SSRF : aucune requête vers une adresse privée, après DNS et après chaque redirection | `backend/src/net/` |
| Appels payants comptés, mis en cache et plafonnés : réserver, appeler, régler | `backend/src/providers/credits.ts` |
| API `/v1` contractuelle : des tests échouent quand une route et le document OpenAPI divergent | `backend/src/api/openapi/` |
| Intégration Campaign Mailer par son API versionnée, jamais par sa base | `backend/src/campaign-mailer/` |

## Pile

| Couche | Choix |
| --- | --- |
| Langage | TypeScript (strict), Node.js 24 |
| Interface | React 19, Vite, Tailwind CSS 4 (SPA) |
| API | Express 5, pino, Sentry, Passport (Google, identité seulement) |
| Traitement | BullMQ sur ioredis, Cheerio |
| Données | PostgreSQL 18 (Neon), 18 migrations réversibles, 26 tables ; Redis Cloud (files BullMQ et sessions node-redis) ; Cloudflare R2 |
| Hébergement | Vercel (web), Railway (API et processus de traitement, décrits dans [`.railway/railway.ts`](.railway/railway.ts)) |
| Qualité | Vitest, un parcours de bout en bout Playwright, ESLint, Prettier, husky |

Choix gelés et leur justification : [docs/decisions.md](docs/decisions.md).

## Chiffres de recette

Recette du **2 octobre 2026** sur un CSV de 100 lignes (entreprises réelles : jeunes pousses, grands groupes, associations, universités), exécutée depuis la machine de l'auteur contre une branche Neon de développement. Détail : [docs/recette/phase-10-resultat.md](docs/recette/phase-10-resultat.md).

| Mesure | Résultat |
| --- | --- |
| Entreprises traitées | 99 (deux lignes désignaient le même domaine et ont été réunies) |
| Sites explorés | 94 |
| Adresses relevées | 636, dont **0 sans source** |
| Durée de bout en bout | 5 min 42 s, sans intervention |
| Statuts, sans vérification de boîte | 631 `unverified`, 5 `risky` |

Ces chiffres montrent que le pipeline va au bout et que la règle « pas d'adresse sans source » tient. Ils ne disent **pas** que ces adresses sont valides : aucune boîte n'a été vérifiée, faute de budget fournisseur (environ 318 crédits Hunter pour les 636 adresses, contre un plafond de 20 par mois). Le critère de couverture reste donc non mesuré.

Une recette antérieure de la collecte (Phase 3, clôturée le 29 septembre 2026) sur cinquante entreprises réelles a relevé 90 adresses, toutes retrouvées sur la page citée comme source.

## Limites et statut

- **Bêta fermée.** Phases 0 à 9 terminées, phase 10 (bêta) en cours. La phase 7B (vérification certifiée, annuaire partagé) est documentée, pas commencée.
- **Essai déployé MailFind vers Campaign Mailer jamais réalisé.** L'intégration est couverte par des tests de contrat contre une copie de l'API de Campaign Mailer, pas par un envoi réel entre les deux applications en ligne.
- **Vérification de boîte limitée par le budget** (20 crédits Hunter par mois) : l'essentiel des adresses reste `unverified`.
- **Pas de revue juridique.** Le registre des traitements, l'analyse d'impact et la mention d'information de [docs/legal/](docs/legal/) n'ont pas été relus par un juriste. MailFind ne prétend à aucune conformité.
- **Pas de facturation.**
- **Pages rendues par JavaScript non lues** : une entreprise peut repartir sans adresse, avec la raison enregistrée.
- **Contributions externes non acceptées.** Le projet est propriétaire et mené par une seule personne : les pull requests ne sont pas examinées. Un défaut de sécurité se signale selon [SECURITY.md](SECURITY.md).

## Tests

Environ 798 cas de test dans 94 fichiers (dont 36 de tests d'intégration contre un vrai PostgreSQL 18), plus un parcours de bout en bout Playwright (connexion, import, suivi, page Contacts, export). La couverture des lignes était de 89 % selon la [roadmap](ROADMAP.md) à la fin de la phase 9 ; elle n'a pas été remesurée depuis. GitHub Actions est restreint sur ce compte : [`scripts/ci.mjs`](scripts/ci.mjs) joue la CI en local, avec les mêmes étapes (voir plus bas).

## Progression

- [x] Phase 0 : Fondations et décisions gelées
- [x] Phase 1 : Comptes et socle applicatif
- [x] Phase 2 : Import CSV et entreprises
- [x] Phase 3 : Identification et collecte sur les sites
- [x] Phase 4 : Fournisseurs et adresses candidates
- [x] Phase 5 : Vérification avancée et score
- [x] Phase 6 : Bibliothèque, page Contacts et exports
- [x] Phase 7 : API publique et intégration Campaign Mailer
- [ ] Phase 7B : Vérification certifiée et annuaire partagé (documentée, pas commencée)
- [x] Phase 8 : Sécurité, conformité, quotas et coûts
- [x] Phase 9 : Tests, observabilité et documentation
- [ ] Phase 10 : Mise en production et bêta (mise en ligne faite, bêta en cours)

## Documents

| Document | Contenu |
| --- | --- |
| [Cahier des charges](docs/cahier-des-charges.md) ([PDF](docs/cahier-des-charges.pdf)) | Exigences fonctionnelles et techniques, modèle de données, sécurité, conformité, recette |
| [Roadmap](ROADMAP.md) | Phases, lots de travail, critères de fin de phase |
| [Décisions](docs/decisions.md) | Choix techniques gelés, fournisseurs, quotas, budget, avec leur justification |
| [Architecture](docs/architecture.md) | Comment les pièces tiennent ensemble, et où regarder |
| [Collecte et vérification](docs/collecte-et-verification.md) | Ce que le robot lit, et ce qu'un statut veut dire |
| [Guide de l'API](docs/guide-api.md) | Portées, idempotence, pagination, webhooks |
| [Guide de la bêta](docs/guide-beta.md) | Prise en main pour les testeurs |
| [Procédures d'incident](docs/runbook.md) | Quoi faire quand quelque chose ne va pas |
| [Provisionnement](docs/provisioning.md) | Les services en face de l'application, et la mise en ligne |
| [Sécurité](docs/security.md) et [SECURITY.md](SECURITY.md) | Ce qui est chiffré, rotation des clés, signalement d'une faille |
| [Conformité](docs/legal/) | Registre des traitements, analyse d'impact, sous-traitants, mention d'information (non relus par un juriste) |

## Captures manquantes

Une seule page est documentée en image : la connexion, ci-dessus. Il n'existe pas encore de capture à jour du tableau de bord, de l'import et de son suivi, de la page Contacts, du détail d'une adresse avec son score, des exports ni de la page de l'API. Elles seront ajoutées à partir de données d'exemple fictives, jamais d'adresses collectées.

## Organisation du dépôt

```text
mailfind/
├── frontend/           React 19 + Vite, point d'entrée src/main.tsx
├── backend/            API Express et processus BullMQ, point d'entrée src/index.ts
│   ├── src/            routes, services, pipeline, crawler, vérification
│   └── migrations/     SQL numéroté, chaque migration avec son retour arrière
├── e2e/                parcours de bout en bout Playwright
├── docs/               cahier des charges, décisions, provisionnement, sécurité
├── .railway/           l'infrastructure Railway, en TypeScript
├── vercel.json         build, renvois et en-têtes de l'application web
├── ROADMAP.md          le plan de référence, phase par phase
├── CLAUDE.md           règles de travail dans ce dépôt
└── package.json        racine des deux espaces de travail npm
```

## Démarrer en local

Réservé à l'auteur : il faut des comptes et des clés pour les services externes, qui ne sont pas fournis.

```text
npm install
cp backend/.env.example backend/.env   # puis remplir
npm run check:services                 # les services répondent
npm run migrate -- up                  # schéma à jour
npm run verify                         # format, lint, types, tests, build

npm run dev:backend                    # API sur le port 3000
npm run dev:worker                     # traitement des imports, à lancer à côté de l'API
npm run dev:frontend                   # interface sur le port 5173
```

### La CI tourne ici, pas sur GitHub

Le workflow de [`.github/workflows/verify.yml`](.github/workflows/verify.yml) est écrit mais personne ne l'exécute. [`scripts/ci.mjs`](scripts/ci.mjs) tient le rôle, avec les mêmes étapes et les mêmes services.

```text
npm run ci              tout, services compris, environ trois minutes
npm run ci -- --no-db   sans les services, donc sans les tests d'intégration
npm run ci -- --keep    garde les conteneurs, pour enquêter après un échec
```

Un hook de pre-push la lance avant que du code parte. Pour passer outre en connaissance de cause : `SKIP_CI=1 git push`.

Les tests d'intégration parlent à un vrai PostgreSQL 18, dont le nom de base doit contenir « test » : ils effacent son schéma avant de rejouer les migrations. `npm run ci` s'en occupe ; à la main :

```text
docker run -d -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=mailfind_test -p 5432:5432 postgres:18
$env:TEST_DATABASE_URL = "postgresql://test:test@localhost:5432/mailfind_test?sslmode=disable"   # PowerShell
$env:TEST_REDIS_URL = "redis://localhost:6379"                                                  # facultatif
npm run test:integration
```

`TEST_REDIS_URL` active les tests de la file de politesse par domaine, qui vit dans Redis (`docker run -d -p 6379:6379 redis:8`). Sans lui, ces tests sont sautés, les autres tournent.

Recette de la collecte sur de vraies entreprises (liste de cinquante domaines fournie) : chaque site est exploré avec les vraies règles, puis chaque adresse relevée est recherchée à nouveau dans la page citée comme source.

```text
npm run crawl:check -- docs/recette/phase-3-domaines.txt
```

### Exploiter

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run ci` | la barrière complète : verrou, format, lint, types, tests, build, vulnérabilités, intégration |
| `npm run verify` | format, lint, types, tests, build. La barrière avant chaque commit |
| `npm run check:services` | prouve que Neon, Redis, R2 et les identifiants Google répondent |
| `npm run migrate -- status` | liste les migrations ; `up` applique, `down` revient d'une |
| `npm run rotate:encryption` | réécrit les secrets avec la clé courante, après une rotation |

Santé de l'API : `GET /health`. Appliquer un changement d'infrastructure Railway : `railway config apply` (sous Windows, poser d'abord `$env:_` sur `railway.exe`, le SDK l'y cherche).

## Transparence sur l'IA

Ce projet est développé avec l'assistance de Claude Code (modèles Claude d'Anthropic) : une grande partie du code, des tests et de la documentation a été rédigée avec lui, et les commits concernés portent la mention `Co-Authored-By`. Les règles de travail données à l'assistant sont publiques dans [CLAUDE.md](CLAUDE.md). Les décisions de produit, les choix gelés de [docs/decisions.md](docs/decisions.md) et la validation des phases reviennent à l'auteur. MailFind n'utilise aucun modèle d'IA dans son fonctionnement : une adresse vient d'une page, d'un fournisseur, d'une règle de déduction documentée ou d'une saisie.

## Licence

Logiciel propriétaire. Copyright (c) 2026 Daniel Nagoloum Talla. **Code visible, tous droits réservés.** Voir [LICENSE](LICENSE).

Le dépôt est public pour qu'on puisse lire le code, ce qui ne donne aucun droit de l'utiliser, le copier, le modifier ou le redistribuer. Ce n'est pas un logiciel libre ni open source.
