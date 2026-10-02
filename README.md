# MailFind

Bibliothèque de contacts professionnels d'entreprises.

MailFind transforme une liste d'entreprises en adresses email professionnelles vérifiées, classées par entreprise et prêtes à l'envoi. L'utilisateur importe un fichier CSV (noms d'entreprises, domaines, sites web ou pages carrières) ; MailFind identifie chaque entreprise, explore les pages publiques pertinentes de son site, interroge des fournisseurs d'enrichissement disposant d'une API officielle, vérifie chaque adresse et en conserve la source. Les résultats s'exportent en CSV, XLSX ou JSON, ou partent directement dans [Campaign Mailer](https://github.com/nagoloumdaniel/Campaign-Mailer) sous forme de campagne en brouillon.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/captures/mailfind-connexion-sombre.png">
  <img alt="Page d'accueil de MailFind : deux adresses réelles avec leur source, leur méthode et leur statut, dont une que le produit ne sait pas vérifier et le dit" src="docs/captures/mailfind-connexion.png">
</picture>

## Statut

**En ligne depuis le 1er octobre 2026 : <https://mailfind.vercel.app>.** L'application web est sur Vercel, l'API et le processus de traitement sur Railway, décrits en code dans [`.railway/railway.ts`](.railway/railway.ts) et [`vercel.json`](vercel.json). Le détail de la mise en service est dans [docs/provisioning.md](docs/provisioning.md).

**Phases 0 à 7 terminées, Phase 8 commencée.** Il reste à MailFind sept lots de la Phase 8 (quotas, plafond de dépense, purge, page du robot, documents légaux, registre des traitements, revue de sécurité), puis les Phases 9 et 10. La mise en ligne, prévue en Phase 10, a été avancée pour disposer d'une URL et de clés de production.

**Ce qui fonctionne.** Un import CSV déclenche le pipeline, étape par étape sur deux files : identification de l'entreprise et de son domaine officiel, collecte sur les pages publiques de son site, enrichissement par fournisseur quand le site n'a pas donné un type d'adresse recherché, puis vérification. Chaque adresse porte sa source, son statut, son motif, sa date et un score dont le détail s'affiche critère par critère. La bibliothèque se consulte par entreprise et par contact, avec recherche, filtres combinables, tri, pagination, actions en masse et fusion de doublons. Les résultats s'exportent en CSV, XLSX, JSON et au format d'import de Campaign Mailer.

**API publique `/v1`**, documentée en OpenAPI 3.1 sur [`/v1/openapi.json`](https://mailfind.vercel.app/v1/openapi.json) et sur la page `/documentation-api` : clés à portées, limite de débit par clé, idempotence des créations, pagination par curseur, erreurs RFC 9457, webhooks signés. Des tests de contrat échouent quand une route et le document ne disent pas la même chose.

**Intégration Campaign Mailer** (1er octobre 2026). Une sélection de contacts part dans [Campaign Mailer](https://github.com/nagoloumdaniel/Campaign-Mailer) sous forme de campagne en brouillon, par lots de 500, dans une tâche qui reprend après une panne sans jamais créer de doublon. Le même envoi passe par l'API publique. Les deux applications se servent aussi de fournisseur d'identité l'une à l'autre : « Se connecter avec Campaign Mailer » ici, « Continuer avec MailFind » là-bas, un seul compte par identité Google, sans doublon (décision D-26).

**Recette de la collecte** : cinquante entreprises réelles, 90 adresses relevées, toutes retrouvées sur la page citée comme source.

## Documents

| Document | Contenu |
| --- | --- |
| [Cahier des charges](docs/cahier-des-charges.md) ([PDF](docs/cahier-des-charges.pdf)) | Exigences fonctionnelles et techniques, modèle de données, sécurité, conformité, recette |
| [Roadmap](ROADMAP.md) | Phases, lots de travail, skills à charger pour chaque lot, critères de fin de phase |
| [Décisions](docs/decisions.md) | Choix techniques gelés, fournisseurs, quotas, budget, avec leur justification |
| [Architecture](docs/architecture.md) | Comment les pièces tiennent ensemble, et où regarder |
| [Procédures d'incident](docs/runbook.md) | Quoi faire quand quelque chose ne va pas |
| [Collecte et vérification](docs/collecte-et-verification.md) | Ce que le robot lit, et ce qu'un statut veut dire |
| [Guide de l'API](docs/guide-api.md) | Portées, idempotence, pagination, webhooks |
| [Provisionnement](docs/provisioning.md) | Les services en face de l'application, et la mise en ligne |
| [Sécurité](docs/security.md) | Ce qui est chiffré, et comment faire tourner une clé |
| [Conformité](docs/legal/) | Registre des traitements, analyse d'impact, sous-traitants, mention d'information |
| [CLAUDE.md](CLAUDE.md) | Règles de travail dans ce dépôt |

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
- [ ] Phase 10 : Mise en production et bêta (mise en ligne faite, bêta à ouvrir)

## Pile

TypeScript, React 19, Vite, Tailwind CSS, Node.js 24, Express 5, PostgreSQL 18 (Neon), BullMQ sur Redis (Redis Cloud), Cloudflare R2, Cheerio, Passport (Google, identité seulement), pino, Sentry. Hébergement : Vercel pour l'application web, Railway pour l'API et le processus de traitement. Détail et justification dans la section 8 du cahier des charges, choix gelés dans [docs/decisions.md](docs/decisions.md).

## Organisation du dépôt

```text
mailfind/
├── frontend/           React 19 + Vite, point d'entree src/main.tsx
├── backend/            API Express et processus BullMQ, point d'entree src/index.ts
│   ├── src/            routes, services, pipeline, crawler, verification
│   └── migrations/     SQL numerote, chaque migration avec son retour arriere
├── docs/               cahier des charges, decisions, provisionnement, securite
├── .railway/           l'infrastructure Railway, en TypeScript
├── vercel.json         build et renvois de l'application web
├── ROADMAP.md          le plan de reference, phase par phase
├── CLAUDE.md           regles de travail dans ce depot
└── package.json        racine des deux espaces de travail npm
```

## Démarrer

```text
npm install
cp backend/.env.example backend/.env   # puis remplir
npm run check:services                 # les services repondent
npm run migrate -- up                  # schema a jour
npm run verify                         # format, lint, types, tests, build

npm run dev:backend                    # API sur le port 3000
npm run dev:worker                     # traitement des imports, a lancer a cote de l'API
npm run dev:frontend                   # interface sur le port 5173
```

### La CI tourne ici, pas sur GitHub

GitHub Actions est restreint sur ce compte : le workflow de [`.github/workflows/verify.yml`](.github/workflows/verify.yml) reste juste, mais personne ne l'exécute. [`scripts/ci.mjs`](scripts/ci.mjs) tient le rôle, avec les mêmes étapes et les mêmes services.

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

Recette de la Phase 3 sur de vraies entreprises. Une liste de cinquante domaines est prête, à compléter ou remplacer par les entreprises réellement visées :

```text
npm run crawl:check -- docs/recette/phase-3-domaines.txt
```

Chaque site est exploré avec les vraies règles, puis chaque adresse relevée est recherchée à nouveau dans la page citée comme source. Le script conclut « critère tenu » seulement si toutes y figurent, et « non démontré » si aucune adresse n'a été relevée.

## Exploiter

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run ci` | la barrière complète : verrou, format, lint, types, tests, build, vulnérabilités, intégration. Monte un PostgreSQL 18 et un Redis jetables, et les efface. |
| `npm run verify` | format, lint, types, tests, build. La barrière avant chaque commit. |
| `npm run check:services` | prouve que Neon, Redis, R2 et les identifiants Google répondent |
| `npm run migrate -- status` | liste les migrations ; `up` applique, `down` revient d'une |
| `npm run rotate:encryption` | réécrit les secrets avec la clé courante, après une rotation |

- Santé de l'API : `GET /health`.
- Chiffrement au repos et rotation des clés : [docs/security.md](docs/security.md).
- Services, hébergeurs et mise en ligne : [docs/provisioning.md](docs/provisioning.md).
- Appliquer un changement d'infrastructure Railway : `railway config apply`. Sous Windows, poser d'abord `$env:_` sur `railway.exe`, le SDK l'y cherche.

## Ce que MailFind ne fait pas

- **Aucun accès à la messagerie.** Google ne transmet que le nom et l'adresse : trois portées d'identité, jamais Gmail. L'envoi se fait dans Campaign Mailer, avec ses propres autorisations.
- **Aucun sondage de boîte depuis nos serveurs.** La vérification SMTP passe par un fournisseur : Railway bloque le port 25 en sortie, et sonder depuis l'IP de l'application la ferait entrer dans les listes de blocage.
- **Aucun contournement.** Le robot suit `robots.txt`, se limite à une requête par seconde et par domaine, s'annonce, ne se connecte à rien, ne tente pas de décoder une adresse masquée volontairement, et ne contourne ni CAPTCHA ni limite de débit.
- **Aucune adresse sans source.** La base refuse une adresse dont on ne sait pas d'où elle vient.
- **La vérification est un statut, jamais une promesse.** `accept_all`, `unknown` et `unverified` ne sont jamais présentés ni exportés comme vérifiés.

## Licence

Propriétaire. Copyright (c) 2026 Daniel Nagoloum Talla. Tous droits réservés. Voir [LICENSE](LICENSE).
