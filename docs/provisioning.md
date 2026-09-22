# Provisionnement des services

Ce que MailFind a besoin de trouver en face de lui, et comment l'obtenir. Les choix derrière ces services sont expliqués dans [`decisions.md`](decisions.md).

- **Date** : 23 septembre 2026
- **Coût total visé** : 0 euro jusqu'à la mise en production, puis environ 5 dollars par mois pour Railway

## Etat

| Service | Etat | Qui |
| --- | --- | --- |
| Cloudflare R2, bucket `mailfind-exports` | Créé le 22 septembre 2026, privé, région ENAM | Fait |
| Cloudflare R2, clés d'accès | A créer | Propriétaire |
| Neon, projet `mailfind` | A créer | Propriétaire |
| Redis Cloud, base `mailfind` | A créer | Propriétaire |
| Google Cloud, écran de consentement | A créer | Propriétaire |
| Brave Search API, clé | A créer | Propriétaire |
| Hunter, clé | A créer | Propriétaire |

Les quatre premiers sont nécessaires à la Phase 1. Brave et Hunter ne servent qu'à partir de la Phase 3, leur création peut attendre.

Deux services n'ont pas pu être créés par l'outillage, et ce n'est pas un oubli : l'organisation Neon du compte est gérée par Vercel, donc son API refuse la création d'un projet, et le connecteur Cloudflare n'a pas le droit d'émettre des jetons d'API. Les deux se font depuis leur interface, en quelques minutes.

---

## 1. Neon, la base de données

1. Ouvrir [console.neon.tech](https://console.neon.tech), organisation « Vercel: Nagoloum talla daniel's projects ».
2. **New project**. Nom `mailfind`, région **AWS US East (N. Virginia)**, PostgreSQL **18**, base `mailfind`. La même région que Campaign Mailer, R2 et Redis.
3. Dans **Connect**, relever **deux** chaînes :
   - la chaîne groupée, dont l'hôte contient `-pooler`, pour `DATABASE_URL` ;
   - la chaîne directe, sans `-pooler`, pour `DIRECT_DATABASE_URL`.
4. Ajouter `?sslmode=verify-full` à la fin des deux si Neon ne le met pas.

Les deux chaînes ne sont pas interchangeables. Le mode groupé passe par pgbouncer, qui ne sait pas tenir un verrou consultatif ni un ordre DDL dans une transaction longue : les migrations passent par la chaîne directe, l'application par la chaîne groupée.

## 2. Redis Cloud, les files et les sessions

Upstash n'est pas utilisé ici : son palier gratuit ne permet qu'une base par compte, et celle du compte sert Campaign Mailer en production (décision D-05).

1. Créer un compte sur [redis.io](https://redis.io/try-free/). Le palier gratuit est de 30 Mo, sans carte bancaire.
2. Nouvelle base : nom `mailfind`, fournisseur **AWS**, région **us-east-1**.
3. Relever l'URL publique complète, avec le mot de passe, sous la forme `redis://default:MOTDEPASSE@hote:port`, et la mettre dans `REDIS_URL`.

Trente mégaoctets tiennent sans problème des files dont les tâches vivent quelques minutes, à condition de purger les tâches terminées. C'est le rôle de `removeOnComplete` et `removeOnFail` dans la configuration BullMQ de la Phase 2.

## 3. Cloudflare R2, les clés d'accès

Le bucket existe déjà. Il manque les clés.

1. Tableau de bord Cloudflare, **R2**, **Manage API tokens**, **Create API token**.
2. Permissions **Object Read and Write**, portée limitée au seul bucket **`mailfind-exports`**. Pas de jeton sur l'ensemble du compte.
3. Copier **Access Key ID** et **Secret Access Key** dans `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY`. Le secret ne s'affiche qu'une fois.
4. `R2_ACCOUNT_ID` est l'identifiant de compte affiché sur la page R2, et `R2_ENDPOINT` vaut `https://<account_id>.r2.cloudflarestorage.com`.

Le bucket reste privé. Les exports sont servis par URL signée de courte durée, jamais par un domaine public.

## 4. Google Cloud, la connexion

Portées demandées : `openid`, `email`, `profile`. **Aucune portée Gmail, jamais** (F-101, décision D-11). MailFind ne lit ni n'envoie de courrier : c'est Campaign Mailer qui envoie, avec ses propres autorisations.

1. [console.cloud.google.com](https://console.cloud.google.com), nouveau projet `mailfind`.
2. **APIs et services**, **Ecran de consentement OAuth**. Type **Externe**. Nom de l'application « MailFind », adresse d'assistance, logo facultatif.
3. Portées : ajouter `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Ne rien ajouter d'autre. Ces trois portées ne déclenchent pas de procédure de vérification Google.
4. **Identifiants**, **Créer des identifiants**, **ID client OAuth**, type **Application Web**.
   - Origines JavaScript autorisées : `http://localhost:5173`
   - URI de redirection autorisés : `http://localhost:3000/api/auth/google/callback`
5. Copier l'identifiant et le secret dans `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.

Les URL de production s'ajoutent à la même liste en Phase 10, elles ne remplacent pas celles de développement.

## 5. Brave Search API

Sert à retrouver le site officiel d'une entreprise quand le CSV ne donne qu'un nom (F-305, décision D-07).

1. [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com), formule **Search**.
2. Une carte bancaire est demandée pour vérifier l'identité. Elle n'est pas débitée tant que la consommation reste dans les 5 dollars de crédits offerts chaque mois, soit environ 1 000 recherches.
3. Copier la clé dans `BRAVE_SEARCH_API_KEY`.

Laisser la variable vide est un choix valable : le pipeline se rabat alors sur le domaine fourni dans le CSV et marque les entreprises dont le site est inconnu.

## 6. Hunter

Sert en dernier recours, quand le site de l'entreprise n'a rien donné (F-602, décision D-08).

1. [hunter.io](https://hunter.io), compte gratuit, puis **API**, **API Keys**.
2. Copier la clé dans `HUNTER_API_KEY`.

Le palier gratuit est de 50 crédits par mois : 1 crédit par recherche de domaine, 0,5 crédit par vérification d'adresse. C'est peu, et c'est assumé : le crawler et les vérifications locales font le travail, Hunter ne fait que le complément.

---

## Vérification

Une fois `backend/.env` rempli à partir de `backend/.env.example` :

```
npm run verify
```

Les scripts de connexion aux trois services arrivent avec la Phase 1. A ce stade, `verify` prouve la chaîne d'outillage, pas les services.

## Règles qui ne changent pas

- `backend/.env` et `frontend/.env` ne sont jamais versionnés. Seuls les modèles `.env.example` le sont.
- Aucune valeur préfixée `VITE_` n'est un secret : elle part dans le navigateur.
- Un secret qui a fuité est révoqué puis remplacé, jamais seulement retiré du code.
- Les jetons de fournisseurs sont chiffrés au repos en base, en AES-256-GCM (S-01).
