# MailFind

Bibliothèque de contacts professionnels d'entreprises.

MailFind transforme une liste d'entreprises en adresses email professionnelles vérifiées, classées par entreprise et prêtes à l'envoi. L'utilisateur importe un fichier CSV (noms d'entreprises, domaines, sites web ou pages carrières) ; MailFind identifie chaque entreprise, explore les pages publiques pertinentes de son site, interroge des fournisseurs d'enrichissement disposant d'une API officielle, vérifie chaque adresse et en conserve la source. Les résultats s'exportent en CSV, XLSX ou JSON, ou partent directement dans [Campaign Mailer](https://github.com/nagoloumdaniel/Campaign-Mailer) sous forme de campagne en brouillon.

## Statut

**Phase 1 terminée (25 septembre 2026).** Connexion Google, acceptation des conditions, page Compte avec export et suppression, socle d'interface en thèmes clair et sombre. Le parcours a été vérifié dans un navigateur. La Phase 2 apporte l'import CSV et les entreprises.

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
- [ ] Phase 2 : Import CSV et entreprises
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
npm run dev:frontend                   # interface sur le port 5173
```

## Licence

Propriétaire. Copyright (c) 2026 Daniel Nagoloum Talla. Tous droits réservés. Voir [LICENSE](LICENSE).
