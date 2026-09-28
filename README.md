# MailFind

Bibliothèque de contacts professionnels d'entreprises.

MailFind transforme une liste d'entreprises en adresses email professionnelles vérifiées, classées par entreprise et prêtes à l'envoi. L'utilisateur importe un fichier CSV (noms d'entreprises, domaines, sites web ou pages carrières) ; MailFind identifie chaque entreprise, explore les pages publiques pertinentes de son site, interroge des fournisseurs d'enrichissement disposant d'une API officielle, vérifie chaque adresse et en conserve la source. Les résultats s'exportent en CSV, XLSX ou JSON, ou partent directement dans [Campaign Mailer](https://github.com/nagoloumdaniel/Campaign-Mailer) sous forme de campagne en brouillon.

## Statut

**Phase 3 construite (28 septembre 2026), en attente de recette sur des entreprises réelles.** Chaque entreprise importée est identifiée (API Recherche d'entreprises, recherche du site officiel par Brave) puis son site est exploré : robots.txt respecté, une requête par seconde et par domaine, adresses privées refusées, adresses relevées avec la page où elles figurent. La page d'un import suit chaque étape. Deux critères de fin de phase sur trois sont prouvés par les tests ; le troisième, sur 50 entreprises réelles, demande un accès à Internet : `npm run crawl:check` le vérifie en une commande. La Phase 2 est terminée depuis le 26 septembre 2026.

## Documents

| Document | Contenu |
| --- | --- |
| [Cahier des charges](docs/cahier-des-charges.md) ([PDF](docs/cahier-des-charges.pdf)) | Exigences fonctionnelles et techniques, modèle de données, sécurité, conformité, recette |
| [Roadmap](ROADMAP.md) | Phases, lots de travail, skills à charger pour chaque lot, critères de fin de phase |
| [Décisions](docs/decisions.md) | Choix techniques gelés, fournisseurs, quotas, budget, avec leur justification |
| [CLAUDE.md](CLAUDE.md) | Règles de travail dans ce dépôt |

## Progression

- [x] Phase 0 : Fondations et décisions gelées
- [x] Phase 1 : Comptes et socle applicatif
- [x] Phase 2 : Import CSV et entreprises
- [ ] Phase 3 : Identification et collecte sur les sites
- [ ] Phase 4 : Fournisseurs et adresses candidates
- [ ] Phase 5 : Vérification avancée et score
- [ ] Phase 6 : Bibliothèque, page Contacts et exports
- [ ] Phase 7 : API publique et intégration Campaign Mailer
- [ ] Phase 8 : Sécurité, conformité, quotas et coûts
- [ ] Phase 9 : Tests, observabilité et documentation
- [ ] Phase 10 : Mise en production et bêta

## Pile prévue

TypeScript, React 19, Vite, Tailwind CSS, Node.js 24, Express 5, PostgreSQL (Neon), BullMQ sur Redis (Redis Cloud), Cloudflare R2, Cheerio, Passport (Google, identité seulement), pino, Sentry. Hébergement : Vercel et Railway. Détail et justification dans la section 8 du cahier des charges, choix gelés dans [docs/decisions.md](docs/decisions.md).

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

Les tests d'intégration parlent à un vrai PostgreSQL 18, dont le nom de base doit contenir « test » : ils effacent son schéma avant de rejouer les migrations.

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

## Licence

Propriétaire. Copyright (c) 2026 Daniel Nagoloum Talla. Tous droits réservés. Voir [LICENSE](LICENSE).
