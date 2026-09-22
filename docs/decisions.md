# Décisions gelées

Ce document fige les choix que le code suppose. Une décision écrite ici n'est pas rediscutée à chaque lot : elle est appliquée, ou bien elle est révisée explicitement dans le journal en fin de document.

- **Version** : 1.0
- **Date** : 23 septembre 2026
- **Référence** : [`docs/cahier-des-charges.md`](cahier-des-charges.md) version 1.0, [`ROADMAP.md`](../ROADMAP.md) Phase 0
- **Révision** : fin de chaque phase, et à chaque fois qu'un fournisseur change ses conditions

## Comment lire une décision

| Champ | Contenu |
| --- | --- |
| Décision | Ce qui est retenu, sans conditionnel |
| Raison | Pourquoi ce choix plutôt que l'autre |
| Conséquences | Ce que le code doit faire ou éviter à cause de ce choix |
| Ce qui la rouvrirait | Le fait précis qui obligerait à revenir dessus |

---

## D-01. Pile technique : celle de Campaign Mailer

**Décision.** TypeScript en mode strict, Node.js 24, Express 5 côté serveur, React 19 avec Vite et Tailwind CSS côté navigateur, PostgreSQL, BullMQ sur Redis, Cloudflare R2, Passport pour Google, pino pour les journaux, Sentry pour les erreurs.

**Raison.** Ce sont les outils déjà pratiqués sur Campaign Mailer, avec les pièges déjà rencontrés et documentés : node-redis pour les sessions et ioredis pour BullMQ, `sslmode=verify-full`, hôtes Neon groupés contre hôtes directs. Aucun temps d'apprentissage, et les deux produits doivent dialoguer.

**Conséquences.** Le `CLAUDE.md` de Campaign Mailer est une lecture obligatoire avant la Phase 1. Les deux dépôts restent alignés sur les versions majeures.

**Ce qui la rouvrirait.** Rien avant la Phase 11.

---

## D-02. Monorepo npm à deux espaces de travail

**Décision.** Un seul dépôt, deux espaces de travail npm : `backend` et `frontend`. Pas de pnpm, pas de Turborepo, pas de paquet partagé pour l'instant.

**Raison.** Deux applications, un seul développeur, un seul cycle de publication. npm est déjà là et Railway comme Vercel savent construire un espace de travail npm sans configuration particulière. Un paquet partagé de types serait utile le jour où l'API publique aura un client TypeScript, pas avant.

**Conséquences.** `npm run verify` à la racine enchaîne le formatage, le lint, la vérification des types, les tests et la construction des deux espaces. C'est la commande qui précède chaque commit.

**Ce qui la rouvrirait.** L'apparition d'un troisième espace, ou un client d'API publié séparément (Phase 7 ou plus tard).

---

## D-03. TypeScript 5.9, pas 7.0

**Décision.** TypeScript reste en 5.9 pendant tout le MVP, malgré la sortie de la version 7.0 native.

**Raison.** typescript-eslint 8 déclare la contrainte `typescript >=4.8.4 <6.1.0`. Passer en 7.0 désactiverait tout le lint typé, donc `no-floating-promises` et `no-misused-promises`, précisément les règles qui protègent un produit fait de files d'attente et d'appels réseau.

**Conséquences.** La compilation est plus lente qu'elle ne pourrait l'être. C'est le prix du lint typé, et il est accepté.

**Ce qui la rouvrirait.** Une version de typescript-eslint qui accepte TypeScript 7.

---

## D-04. Base de données : projet Neon dédié, us-east-1

**Décision.** Un nouveau projet Neon, distinct de celui de Campaign Mailer, en `aws-us-east-1`. Migrations par fichiers SQL numérotés, avec retour arrière, appliquées par un script du dépôt.

**Raison.** Même région que Redis, que R2 et que Campaign Mailer, donc pas de latence entre services ni de transfert entre régions. Un projet distinct parce que les deux produits ont des cycles de vie, des sauvegardes et des droits d'accès différents, et que MailFind stocke des données personnelles collectées sur le web dont Campaign Mailer n'a pas à connaître l'existence.

**Conséquences.** Deux chaînes de connexion à distinguer : l'hôte groupé pour l'application, l'hôte direct pour les migrations. Le palier gratuit Neon suffit au MVP.

**Ce qui la rouvrirait.** Un volume qui dépasse le palier gratuit, ce qui arriverait bien après la bêta.

---

## D-05. File de tâches : BullMQ sur une base Redis dédiée, chez Redis Cloud

**Décision.** BullMQ avec ioredis, sur une base Redis **Redis Cloud** dédiée à MailFind, en us-east-1. Les sessions Express utilisent node-redis sur la même base, avec un préfixe de clé distinct. Pas d'Upstash pour ce produit.

**Raison.** Le pipeline est fait d'étapes longues et faillibles, qui doivent reprendre après un redémarrage sans refaire ce qui est déjà payé : BullMQ le fait, et il est déjà maîtrisé. Le fournisseur, en revanche, a changé par rapport au plan initial. Le palier gratuit d'Upstash ne permet **qu'une seule base par compte**, et celle du compte est occupée par Campaign Mailer, qui est en production. Deux issues étaient possibles : partager cette base, ou en prendre une ailleurs.

Partager a été écarté. Les 500 000 commandes mensuelles du palier gratuit auraient été communes aux deux produits, or un travailleur BullMQ consomme en continu même au repos : un import un peu long chez MailFind aurait pu épuiser le quota de Campaign Mailer, donc casser un produit en production pour en développer un autre. Le palier gratuit de Redis Cloud, 30 Mo et sans carte bancaire, suffit largement à des files dont les tâches vivent quelques minutes, et il isole complètement les deux produits.

**Conséquences.** Chaque tâche doit être idempotente, avec une clé stable dérivée de l'import et de l'entreprise. Le nombre de files actives reste bas, et les préfixes `mailfind:sess:` et `mailfind:bull` sont obligatoires même sur une base dédiée, pour que la règle tienne encore le jour où la base changerait. Les deux clients Redis ne sont pas interchangeables, le mélange est une source de pannes connue. Trente mégaoctets imposent de purger les tâches terminées, ce que BullMQ sait faire avec `removeOnComplete` et `removeOnFail`.

**Ce qui la rouvrirait.** Un dépassement des 30 Mo, qui signifierait que les tâches terminées ne sont pas purgées, ou l'ouverture d'un compte Upstash séparé pour MailFind.

---

## D-06. Stockage des exports : bucket Cloudflare R2 dédié

**Décision.** Un bucket R2 privé réservé à MailFind, en juridiction automatique, accès par URL signée, conservation des exports sept jours puis purge automatique.

**Raison.** R2 ne facture pas la sortie de données, et un export volumineux est fait pour être téléchargé. Le palier gratuit de 10 Go couvre très largement des fichiers qui vivent sept jours.

**Conséquences.** Aucun fichier d'export n'est public. Les URL signées sont de courte durée et journalisées (F-1104, F-1106).

**Ce qui la rouvrirait.** Rien de prévisible.

---

## D-07. Recherche du site officiel : Brave Search API

**Décision.** Brave Search API, formule Search, pour retrouver le site officiel d'une entreprise à partir de son nom (F-305). Aucun autre moteur, et jamais de scraping d'une page de résultats.

**Raison.** API officielle avec des conditions d'utilisation claires, index indépendant de Google, et facturation à la requête sans abonnement minimum. SerpApi donne des résultats Google plus précis sur les noms français ambigus, mais commence à environ 50 $ par mois, ce qui est incompatible avec D-13.

**Tarif au 23 septembre 2026.** 5 $ par tranche de 1 000 requêtes, avec 5 $ de crédits offerts chaque mois, soit environ **1 000 recherches gratuites par mois**. Une carte bancaire est exigée à l'inscription pour vérifier l'identité ; elle n'est pas débitée tant que la consommation reste dans les crédits offerts. Débit autorisé : 50 requêtes par seconde, très au-dessus de nos besoins.

**Conséquences.** L'adaptateur est écrit derrière une interface `WebSearchProvider`, pour qu'un changement de fournisseur ne touche qu'un fichier. Une entreprise importée avec son domaine ne coûte aucune requête : seules les lignes réduites à un nom en consomment une. Le résultat est mis en cache par nom normalisé, et le domaine trouvé est marqué « à confirmer » tant que la confiance est faible.

**Ce qui la rouvrirait.** Une précision insuffisante sur les entreprises françaises au moment de la recette de la Phase 3, mesurée sur le jeu des 100 entreprises.

---

## D-08. Enrichissement et vérification de boîte : Hunter

**Décision.** Hunter, pour la recherche d'adresses par domaine et pour la vérification de boîte, avec un seul fournisseur pendant le MVP.

**Raison.** Le même fournisseur couvre les deux besoins, l'API est officielle et documentée, et le second fournisseur est déjà prévu en Phase 11. Un seul fournisseur veut dire un seul adaptateur à tester et un seul compteur de crédits à tenir.

**Tarif au 23 septembre 2026.** Formule gratuite : **50 crédits par mois**, une recherche par domaine coûte 1 crédit, une vérification d'adresse coûte 0,5 crédit. Première formule payante, Starter, 49 € par mois pour 2 000 crédits.

**Conséquences, et il faut le dire clairement.** Cinquante crédits par mois ne font pas tourner un produit. Sur le MVP, ce sont **le crawler et la vérification locale qui font le travail** : les pages publiques du site de l'entreprise, l'API Recherche d'entreprises, la syntaxe, le DNS, les MX, les domaines jetables, les adresses de rôle. Hunter n'intervient qu'en dernier recours, quand le site n'a rien donné, et la vérification de boîte reste une option rare. Les adresses qui n'ont pas pu être vérifiées par un fournisseur restent au statut `unknown` ou `unverified`, et ces statuts ne sont jamais présentés comme vérifiés.

**Ce qui la rouvrirait.** Le passage à la formule Starter le jour où la bêta le justifie, ce qui est une décision de dépense à prendre avec D-13.

---

## D-09. Aucune vérification SMTP depuis nos serveurs

**Décision.** La vérification de boîte passe exclusivement par le fournisseur. Le code n'ouvre jamais de connexion sur le port 25.

**Raison.** Railway bloque le port 25 en sortie sur ses formules d'entrée, et sonder des serveurs de messagerie depuis l'IP de l'application ferait entrer cette IP dans les listes de blocage, ce qui pénaliserait aussi Campaign Mailer.

**Conséquences.** Les niveaux 1 à 7 de la vérification sont locaux et gratuits, le niveau 8 est délégué et payant. Cette frontière est explicite dans le code et dans la documentation.

**Ce qui la rouvrirait.** Rien. C'est une règle non négociable du `CLAUDE.md`.

---

## D-10. Identification légale : API Recherche d'entreprises

**Décision.** L'API Recherche d'entreprises de l'État français fournit le SIREN, l'adresse, l'activité et l'effectif (F-304).

**Raison.** Gratuite, officielle, sans clé, et c'est la source faisant foi pour les entreprises françaises. Elle permet le dédoublonnage par SIREN, bien plus fiable que par nom.

**Conséquences.** Sa limite de débit est respectée par une file dédiée. Elle ne donne pas le site web : le domaine vient de l'import ou de D-07.

**Ce qui la rouvrirait.** L'ouverture du produit à des entreprises hors de France, qui demanderait une source équivalente par pays.

---

## D-11. Connexion : Google, portées d'identité seulement

**Décision.** Connexion par Google OAuth 2.0 avec les seules portées `openid`, `email` et `profile` (F-101). Aucune portée Gmail, aucun accès à la messagerie, jamais.

**Raison.** MailFind trouve des adresses, il n'envoie rien et ne lit rien. Demander une portée de messagerie déclencherait une procédure de vérification Google lourde, et surtout ce serait mentir sur ce que fait le produit.

**Conséquences.** La page de connexion dit explicitement ce que l'application ne fait pas. L'envoi, lui, se fait dans Campaign Mailer, avec les autorisations de Campaign Mailer.

**Ce qui la rouvrirait.** Rien.

---

## D-12. Hébergement : Vercel et Railway, US East

**Décision.** L'interface sur Vercel, l'API et les processus de traitement sur Railway, les deux en US East, comme Campaign Mailer.

**Raison.** Même région que Neon, Upstash et R2. Déploiement par poussée git des deux côtés.

**Conséquences.** Railway n'a plus de formule gratuite : environ 5 $ par mois. **C'est le seul coût incompressible du projet**, et il est distinct du plafond fournisseurs de D-13, qui ne concerne que les appels payants à Brave et Hunter.

**Ce qui la rouvrirait.** Rien avant la mise en production.

---

## D-13. Budget fournisseurs : 0 €, paliers gratuits seulement

**Décision.** Le plafond global mensuel de dépense fournisseurs est fixé à **0 €**. Aucun appel payant n'est émis. Quand les crédits offerts du mois sont épuisés chez Brave ou chez Hunter, le pipeline continue sans ce fournisseur et marque les entreprises concernées, il ne bascule pas en payant.

**Raison.** Le produit doit prouver sa valeur avec ce qui est gratuit avant de coûter quoi que ce soit, et l'essentiel du travail, le crawler et la vérification locale, l'est.

**Conséquences.** Le mécanisme de plafond de F-1405 est écrit en Phase 8 avec la valeur 0 par défaut, réglable par variable d'environnement. Réserver le crédit avant l'appel, le confirmer après, et refuser l'appel quand le compteur du mois est à sec. Un import qui rencontre le plafond n'échoue pas : il rend ce qu'il a trouvé gratuitement, avec les statuts honnêtes qui vont avec.

**Ce qui la rouvrirait.** La Phase 10, si les bêta-testeurs butent sur les paliers gratuits. La décision de relever le plafond appartient au propriétaire, elle est prise explicitement, et elle est inscrite dans le journal de ce document.

---

## D-14. Quotas du MVP

**Décision.** Valeurs de départ, par utilisateur et par mois calendaire, réglables par variable d'environnement (F-1401, F-1405).

| Limite | Valeur | Pourquoi cette valeur |
| --- | --- | --- |
| Lignes par fichier CSV | 5 000 lignes, 5 Mo | Exigence F-201 du cahier des charges |
| Imports simultanés par utilisateur | 2 | Garde une file réactive pour les autres utilisateurs |
| Entreprises traitées par mois et par utilisateur | 500 | Le crawler est gratuit, la limite protège le débit, pas le budget |
| Recherches de site officiel, Brave | 80 | 1 000 requêtes offertes par mois, réparties sur 10 bêta-testeurs avec une marge |
| Recherches par domaine, Hunter | 3 | 30 crédits mensuels réservés à la recherche, pour 10 utilisateurs |
| Vérifications de boîte, Hunter | 4 | 20 crédits mensuels réservés à la vérification, soit 40 vérifications au total |
| Exports par mois | 50 | Coût nul, limite anti abus |

**Conséquences.** Les trois lignes Brave et Hunter sont faibles par construction, et c'est assumé : elles ne s'appliquent qu'aux entreprises dont le site n'a rien donné. Une entreprise importée avec son domaine ne consomme aucune de ces trois lignes. L'écran de lancement d'un import montre l'estimation avant de partir (F-1402), et l'utilisateur voit ses compteurs sur la page Compte.

**Ce qui la rouvrirait.** Les mesures réelles de la bêta, en Phase 10.

---

## D-15. Licence propriétaire

**Décision.** Licence propriétaire, même titulaire que Campaign Mailer, Daniel Nagoloum Talla. Voir [`LICENSE`](../LICENSE).

**Raison.** Même auteur, même stratégie produit, et un moteur de collecte publié en source ouverte servirait surtout à en faire un outil de collecte massive, ce que ce produit refuse d'être.

**Ce qui la rouvrirait.** Rien.

---

## D-16. Intégration continue

**Décision.** La barrière de qualité est `npm run verify`, appelée par un hook de pré-commit sur les fichiers indexés et par le flux d'intégration continue sur l'ensemble du dépôt. Le flux GitHub Actions est écrit et versionné même s'il ne s'exécute pas sur le compte actuel.

**Raison.** Le fichier de flux écrit maintenant s'exécutera le jour où le compte le permettra, sans réécriture. En attendant, le hook local tient le même rôle sur le poste du développeur.

**Conséquences.** Aucun commit ne part sans formatage, lint typé, vérification des types, tests et construction.

**Ce qui la rouvrirait.** L'ouverture de GitHub Actions sur le compte, qui rendra le flux effectif sans rien changer au fichier.

---

## Ce qui n'est pas encore tranché

| Sujet | Quand | Pourquoi pas maintenant |
| --- | --- | --- |
| Deuxième fournisseur d'enrichissement | Phase 11 | Un seul adaptateur à éprouver d'abord |
| Rendu des sites en JavaScript | Phase 11 | Coût et surface d'attaque, hors MVP (F-413) |
| Offres et facturation | Phase 11 | Pas d'utilisateur payant avant la bêta |
| Version de l'API de Campaign Mailer | Phase 7 | Dépend du lot « jetons d'intégration » de Campaign Mailer |

---

## Journal des révisions

| Date | Décision | Changement |
| --- | --- | --- |
| 23 septembre 2026 | Toutes | Version 1.0, rédaction initiale de la Phase 0 |
| 23 septembre 2026 | D-05 | Redis passe d'Upstash à Redis Cloud. Le palier gratuit d'Upstash ne permet qu'une base par compte, et celle du compte sert Campaign Mailer en production. Partager aurait mis les deux produits sur le même quota de 500 000 commandes par mois. |
