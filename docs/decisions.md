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

## D-17. Une adresse de rôle garde son statut

**Décision.** Une adresse de rôle (recrutement@, rh@, contact@) est typée et signalée, mais pas déclassée en `risky`. Le statut `risky` reste réservé aux messageries grand public et aux vérifications partielles.

**Raison.** Le tableau des statuts de la section 6.7 range les adresses de rôle parmi les `risky`, « incluses si l'utilisateur l'autorise ». Appliqué à la lettre, il marquerait comme risquées exactement les adresses que la section 6.8 place en priorité très haute pour une candidature, et les exclurait par défaut des envois vers Campaign Mailer. Le produit trouve des adresses de recrutement : les déclasser toutes irait contre son objet.

**Conséquences.** Le type de l'adresse est porté par la colonne `type`, et le score donne +5 à une adresse de rôle pertinente pour les types recherchés (6.9). Une messagerie grand public passe `risky` dès les contrôles locaux (niveau 6).

**Ce qui la rouvrirait.** Le propriétaire, s'il préfère la lecture littérale du tableau de 6.7.

---

## D-18. Le tableau de 6.9 fait foi pour le score

**Décision.** Le score applique le tableau de la section 6.9 critère par critère, sans base ni pondération cachée. Une confirmation est une seconde page du site ou un second fournisseur ; une déduction ne confirme rien. Le plafond d'une adresse déduite, la mise à zéro d'une adresse écartée et les bornes 0 à 100 sont enregistrés comme des lignes du détail, dont la somme est toujours le score.

**Raison.** Les exemples de l'annexe C (90 pour une adresse valide trouvée sur la page carrières, 35 pour une déduction `accept_all`) ne se retrouvent pas avec le tableau : ils sont illustratifs. Le tableau est la règle que l'utilisateur peut relire au survol du score ; un calcul qui s'en écarterait rendrait ce détail faux, ce que la Definition of Done de la Phase 5 interdit.

**Conséquences.** Une adresse trouvée sur le site officiel, dans la page contact, d'un type recherché, vaut 55 avant vérification et 85 confirmée valide. Une adresse déduite non confirmée vaut au plus 10 : le plafond de 40 reste un garde-fou pour un critère ajouté plus tard. Le détail est stocké dans `emails.score_breakdown`, au format `{ score, criteria: [{ criterion, points }] }`.

**Ce qui la rouvrirait.** Le propriétaire, s'il veut que les exemples de l'annexe C deviennent la règle : il faudrait alors une base de points pour une adresse vérifiée, à écrire dans le tableau.

---

## D-19. Ce que porte un export

**Décision.** Une adresse exportée a toujours au moins une source, dans les colonnes `source_kind`, `source_url` et `provider`, la plus vérifiable en tête : une page du site, puis un fournisseur, puis la règle de déduction ou la saisie de l'utilisateur, avec sa date. Le fichier Campaign Mailer reprend la règle d'adresse de Campaign Mailer (`normaliseEmail`), n'écrit chaque adresse qu'une fois, laisse de côté celles que Campaign Mailer refuserait ou qui commencent comme une formule, et le dit ; une adresse sans nom de contact y reçoit la civilité « Madame, Monsieur » de l'exemple de 6.12.

**Raison.** Le critère A4 demande « au moins une source avec URL ou fournisseur ». Lu à la lettre, il interdirait d'exporter une adresse saisie par l'utilisateur (F-1013) ou une déduction confirmée par la vérification de boîte, alors que la règle du dépôt (« URL, méthode, date ou fournisseur ») leur donne bien une source. Pour Campaign Mailer, la Definition of Done demande un import sans retouche : une ligne refusée de l'autre côté en serait une.

**Conséquences.** `source_kind` dit toujours d'où vient l'adresse, `deduction` et `manual` compris. Le nombre d'adresses laissées de côté par le format Campaign Mailer s'affiche à l'export.

**Ce qui la rouvrirait.** Une évolution de la règle d'import de Campaign Mailer, à recopier ; ou le propriétaire, s'il préfère la lecture littérale de A4.

---

## D-20. Exclure n'est pas faire disparaître

**Décision.** Le drapeau `excluded` d'une adresse veut dire « hors des exports et des envois », rien d'autre. Une adresse invalide, jetable ou supprimée l'est d'office ; l'utilisateur peut exclure les autres, et seule son exclusion à lui se lève. La règle F-503 (une candidate refusée n'est ni comptée ni montrée) tient au statut : une adresse déduite `invalid` ou `disposable`.

**Raison.** Jusqu'à la Phase 5, F-503 reposait sur ce même drapeau. Une adresse déduite que l'utilisateur aurait exclue aurait disparu de sa bibliothèque sans retour possible, et une vérification suivante aurait défait son choix.

**Conséquences.** Toutes les requêtes qui montrent ou comptent des adresses partagent la même condition (`SHOWN_EMAIL`). La vérification garde une exclusion décidée par l'utilisateur.

**Ce qui la rouvrirait.** Rien de prévu.

---

## D-21. Une page de 3 Mo au plus

**Décision.** Le collecteur lit une page jusqu'à 3 Mo (`CRAWLER_MAX_RESPONSE_BYTES=3000000`), au lieu des 2 Mo de F-405. Le reste de F-405 ne change pas : une requête à la fois par domaine, une seconde d'écart, dix secondes, deux redirections.

**Raison.** La recette de la Phase 3 sur cinquante entreprises réelles a écarté vinted.fr, dont l'accueil pèse 2,0 Mo : les grands sites embarquent leurs données de page dans le HTML. Un Mo de plus suffit à les lire, sans ouvrir la porte à des fichiers qui ne sont pas des pages.

**Conséquences.** Un peu plus de mémoire par page lue, bornée par une page à la fois par domaine.

**Ce qui la rouvrirait.** Une consommation mémoire du processus de traitement qui dépasse l'offre Railway retenue.

---

## D-22. La vérification jointe à une recherche par domaine compte comme une vérification de boîte

**Décision.** Quand la recherche par domaine de Hunter rend une adresse avec une vérification `valid` ou `accept_all` datée de moins de trente jours, elle est enregistrée dans l'historique au niveau 8, au jour donné par Hunter, avec Hunter pour fournisseur et `domain_search` pour détail. L'étape de vérification refait toujours les contrôles locaux, puis reprend cette vérification au lieu d'en payer une, que l'import ait demandé la vérification de boîte ou non. Les verdicts `unknown` ou absents ne sont pas repris.

**Raison.** Vingt crédits de vérification par mois (D-14), c'est quarante boîtes. La recherche par domaine, déjà payée, rend ce verdict pour beaucoup d'adresses : le repayer serait dépenser pour rien. Le verdict a un fournisseur et une date, comme une vérification payée ; le statut reste un constat daté, jamais une promesse.

**Conséquences.** La fraîcheur des contrôles locaux et celle de la boîte se comptent à part. Une revérification forcée refait la vérification payante. Un contrôle local qui écarte l'adresse l'emporte sur le verdict de Hunter.

**Ce qui la rouvrirait.** Des verdicts de recherche par domaine démentis par les rebonds que Campaign Mailer signalera (F-706).

---

## D-23. L'intégration Campaign Mailer attend l'API de Campaign Mailer

**Décision.** La Phase 7 se clôt sans l'envoi vers Campaign Mailer (F-1201 à F-1209) ni le critère A7. L'export au format Campaign Mailer (Phase 6) reste le chemin entre les deux produits. La suite se fait dans cet ordre : l'API `v1` et les jetons d'intégration dans Campaign Mailer, selon le contrat de sa roadmap, puis le côté MailFind contre cette API réelle.

**Raison.** Au 29 septembre 2026, Campaign Mailer n'a ni route `/api/v1` ni jetons d'intégration : ils sont prévus dans sa Phase 9. Écrire le côté MailFind contre une imitation de cette API reviendrait à coder contre un contrat que personne n'a encore tenu, et à le refaire au premier écart. Le registre des risques prévoyait ce cas : l'export fichier d'abord, l'API ensuite.

**Conséquences.** Le critère A7 reste ouvert jusqu'à l'intégration. Le contrat attendu est celui de la roadmap de Campaign Mailer : `POST /api/v1/campaigns` et `POST /api/v1/campaigns/:id/contacts`, jeton personnel haché aux portées `campaigns:write` et `contacts:write`, `Idempotency-Key` obligatoire, 2 000 lignes au plus par appel (nos lots de 500 y tiennent), champs `email`, `contact_name`, `company_name`, `salutation`, `source`, `verification_status`, `verified_at`.

**Ce qui la rouvrirait.** L'API `v1` de Campaign Mailer en service.

---

## D-24. La vérification certifiée passe par un fournisseur, Reacher compris

**Décision.** Le badge « certifiée » repose sur une vérification de boîte faite par un fournisseur : Hunter aujourd'hui, Reacher par son API hébergée ensuite, derrière la même interface et le même chemin des appels payants. MailFind ne reproduit pas la vérification SMTP de `check-if-email-exists` dans son propre code.

**Raison.** Cette vérification ouvre une connexion SMTP sur le port 25 vers le serveur de messagerie de chaque adresse. Railway bloque ce port sur les offres d'entrée, et sonder des serveurs depuis l'adresse de l'API la ferait inscrire sur des listes de blocage : c'est la règle « aucune connexion SMTP depuis nos serveurs » (D-09). Le code de Reacher est sous AGPL-3.0 : l'intégrer ou le recopier dans un produit propriétaire demanderait sa licence commerciale. L'appeler comme fournisseur garde les deux risques hors de MailFind.

**Conséquences.** Le badge coûte une vérification par adresse ; il suit donc les crédits disponibles. Une adresse `invalid` ou `disposable` après vérification est écartée puis supprimée au bout de 7 jours (F-1705). `accept_all` et `unknown` ne sont ni certifiées ni supprimées.

**Ce qui la rouvrirait.** Un hébergement dont le port 25 sortant est ouvert, avec une adresse dédiée à la réputation surveillée, et la licence commerciale de Reacher : l'auto-hébergement de son service deviendrait alors possible, toujours hors du processus de l'API.

---

## D-25. L'annuaire partagé ne contient que des données publiques

**Décision.** L'annuaire commun (6.18) est alimenté seulement par les adresses trouvées sur une page publique du site officiel, avec leur URL. Il ne reprend jamais le contenu privé d'un compte : fichiers importés, notes, étiquettes, colonnes libres, adresses saisies à la main, adresses fournies par Hunter ou un autre fournisseur. Les adresses nominatives en sont exclues tant que l'analyse d'impact ne les admet pas. Il n'ouvre qu'après cette analyse et la mise à jour des conditions d'utilisation.

**Raison.** Le propriétaire veut qu'un utilisateur sans fichier puisse puiser dans les contacts déjà connus. Partager tel quel ce que chaque utilisateur importe donnerait à un concurrent la liste de prospects d'un autre, ferait de MailFind le responsable d'une base qu'il ne maîtrise pas, et revendrait les résultats des fournisseurs contre leurs conditions (R-09). Les adresses publiées sur les sites, avec leur source, portent l'essentiel de la valeur sans ces risques.

**Conséquences.** MailFind devient responsable de traitement de l'annuaire (R-13) : registre, information des personnes, opposition pour tous. Un plafond de consultation protège l'annuaire de l'aspiration.

**Ce qui la rouvrirait.** Un avis juridique ou l'analyse d'impact qui admettrait d'autres données, avec le consentement explicite de l'utilisateur qui les apporte.

---

## Journal des révisions

| Date | Décision | Changement |
| --- | --- | --- |
| 23 septembre 2026 | Toutes | Version 1.0, rédaction initiale de la Phase 0 |
| 23 septembre 2026 | D-05 | Redis passe d'Upstash à Redis Cloud. Le palier gratuit d'Upstash ne permet qu'une base par compte, et celle du compte sert Campaign Mailer en production. Partager aurait mis les deux produits sur le même quota de 500 000 commandes par mois. |
| 26 septembre 2026 | D-16 | Une seconde barrière s'ajoute à `npm run verify` sans la remplacer : `npm run test:integration`, sur un PostgreSQL 18 jetable, pour ce que les tests unitaires ne voient pas (index d'unicité, transactions, reprise d'un import). Hors de `verify`, qui doit tourner sans base, et dans un second job du flux d'intégration continue. |
| 28 septembre 2026 | D-07, D-16 | La recherche web passe par la réservation puis le règlement des crédits (`provider_calls`), avec deux plafonds mensuels : 80 recherches par utilisateur (D-14) et les 1 000 requêtes offertes par Brave pour tout MailFind (D-13, `BRAVE_MONTHLY_FREE_QUERIES`). Le cache garde le domaine déduit et sa confiance, pas la réponse brute. La suite d'intégration teste aussi la file de politesse sur un vrai Redis, quand `TEST_REDIS_URL` est donnée. |
| 28 septembre 2026 | D-08, D-14 | Les plafonds se comptent par fournisseur et par opération : les 50 crédits mensuels de Hunter sont partagés en 30 pour la recherche par domaine (`HUNTER_MONTHLY_SEARCH_CREDITS`) et 20 pour la vérification, pour que l'une ne mange pas l'autre. Sans `ENCRYPTION_KEY`, aucun fournisseur d'enrichissement n'est appelé : leurs réponses contiennent des adresses nominatives et ne sont gardées que chiffrées (F-604). |
| 28 septembre 2026 | D-17 | Nouvelle décision : une adresse de rôle garde son statut au lieu de passer `risky`. |
| 28 septembre 2026 | D-18 | Nouvelle décision : le tableau de 6.9 fait foi pour le score, et son détail est enregistré ligne par ligne. |
| 29 septembre 2026 | D-19 | Nouvelle décision : ce que porte un export, source et format Campaign Mailer compris. |
| 29 septembre 2026 | D-20 | Nouvelle décision : exclure veut dire « hors des exports » ; F-503 tient au statut. |
| 29 septembre 2026 | D-21 | Nouvelle décision : une page de 3 Mo au plus, au lieu des 2 Mo de F-405. |
| 30 septembre 2026 | D-24, D-25 | Nouvelles décisions, à la demande du propriétaire : la vérification certifiée passe par un fournisseur (Reacher compris, jamais de SMTP depuis nos serveurs) ; l'annuaire partagé ne contient que des données publiques. |
| 29 septembre 2026 | D-23 | Nouvelle décision : l'intégration Campaign Mailer attend l'API `v1` de Campaign Mailer ; la Phase 7 se clôt sans elle. |
| 29 septembre 2026 | D-22 | Nouvelle décision : la vérification jointe par Hunter à sa recherche par domaine compte comme une vérification de boîte. |
| 29 septembre 2026 | D-08, D-14 | Une recherche par domaine sans résultat ne compte plus dans les plafonds : Hunter ne la facture pas (documentation v2). Elle reste enregistrée et mise en cache, pour qu'un rejeu ne la refasse pas. Une réponse faite seulement de gabarits de format compte : Hunter l'a facturée. |
| 28 septembre 2026 | D-14 | Les vérifications de boîte se comptent en crédits : quatre par compte et par mois valent deux crédits (`QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH`), sur les vingt réservés à la vérification (`HUNTER_MONTHLY_VERIFICATION_CREDITS`). Un appel en échec n'est pas facturé et ne compte pas. |
