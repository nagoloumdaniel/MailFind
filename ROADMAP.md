# Roadmap : MailFind

Plan d'exécution, du dépôt vide à la bêta publique.
Référence : [`docs/cahier-des-charges.md`](docs/cahier-des-charges.md), version 1.0 du 22 septembre 2026.

- **Statut** : Phases 0 à 7 terminées, Phase 8 commencée (S-01 et S-03). En ligne depuis le 1er octobre 2026 sur <https://mailfind.vercel.app>, avec l'API sur Railway ; la mise en ligne était prévue en Phase 10, elle a été avancée à la demande du propriétaire pour disposer d'une URL et de clés de production. L'intégration Campaign Mailer de la Phase 7, reportée le 29 septembre (D-23), est construite depuis le 1er octobre 2026 des deux côtés ; il reste l'essai en production entre les deux applications déployées. Phase 7B (vérification certifiée, annuaire partagé) ajoutée le 30 septembre 2026, à démarrer après la revue.
- **Dernière mise à jour** : 30 septembre 2026
- **Cadence de révision** : fin de chaque phase

---

## 0. Comment lire ce document

Chaque phase contient :

- **Objectif** : ce qui doit être vrai à la fin de la phase.
- **Lots de travail** : une puce est un ticket, un commit et un push.
- **Definition of Done** : critères vérifiables. Une phase n'est pas terminée si un seul critère manque.
- **Risques** : ce qui peut faire déraper la phase, et la parade.

Chaque lot porte une annotation `→ skills :` qui liste les skills à charger **avant** d'écrire le code de ce lot. Les références `F-xxx`, `S-xx` et `R-xx` renvoient aux exigences du cahier des charges.

### Rituel appliqué à chaque lot

Cet enchaînement vaut pour tous les lots et n'est pas répété dans les annotations :

1. `brainstorming` : obligatoire avant toute nouvelle fonctionnalité ou nouveau composant.
2. Skills métier du lot (annotation `→ skills :`).
3. `test-driven-development` : le test avant le code, quand le lot est testable.
4. Implémentation : `surgical-patch` pour une édition ciblée, `safe-refactor` quand le lot touche du code existant.
5. `code-review` puis `caveman-review` sur le diff.
6. `verification-before-completion` avant de déclarer le lot terminé.
7. `caveman-commit` pour le message, puis `git push`.

En cas de bug : `investigate-first`, puis `systematic-debugging`, puis `verify-and-stop`.

### Conventions

- Conventional Commits. Le corps du message explique pourquoi, pas seulement quoi.
- Un commit et un push par lot. La phase est l'unité de revue : on termine tous les lots d'une phase, on présente, on attend la validation avant la phase suivante.
- Avant chaque commit : `npm run verify` ; les tests backend quand le backend change ; le parcours de bout en bout quand un parcours utilisateur change.
- La liste de progression du `README.md` est mise à jour dans le commit qui la fait avancer.
- Aucun lot de la Phase 11 avant la validation de la Phase 10.

### Skills transverses, actifs en permanence

| Skill | Quand |
| --- | --- |
| `caveman` | Tout le temps, pour les échanges. Jamais pour le code ni la documentation. |
| `writing-plans` / `executing-plans` | Découpage d'un lot en étapes, puis exécution. |
| `verification-before-completion` | Fin de chaque lot. |
| `caveman-commit` | Chaque commit. |
| `lean-build` | Dès qu'un lot dépasse son périmètre. |
| `cavecrew` | Délégation d'investigation, d'édition ou de revue à des sous-agents. |

---

## Vue d'ensemble

| Phase | Contenu | Durée cible | Livrable |
| --- | --- | --- | --- |
| 0 | Fondations et décisions gelées | 3 j | Dépôt outillé, services provisionnés, décisions écrites |
| 1 | Comptes et socle applicatif | 4 j | Connexion Google, mise en page, page Compte |
| 2 | Import CSV et entreprises | 4 j | Import avec correspondance des colonnes, fiches entreprises dédoublonnées |
| 3 | Identification et collecte sur les sites | 8 j | Domaines confirmés, adresses trouvées avec leur source |
| 4 | Fournisseurs et adresses candidates | 5 j | Hunter branché, repli, cache, candidates |
| 5 | Vérification avancée et score | 4 j | Statuts normalisés, vérification de boîte, score expliqué |
| 6 | Bibliothèque, page Contacts et exports | 6 j | Vues complètes, CRUD des contacts, CSV, XLSX, JSON |
| 7 | API publique et intégration Campaign Mailer | 7 j | API v1 documentée, webhooks, envoi vers Campaign Mailer |
| 7B | Vérification certifiée et annuaire partagé | 6 j | Badge « certifiée », adresses non fonctionnelles écartées puis supprimées, annuaire commun consultable |
| 8 | Sécurité, conformité, quotas et coûts | 5 j | Revue de sécurité, RGPD, plafonds de dépense |
| 9 | Tests, observabilité et documentation | 3 j | Couverture, alertes, procédures |
| 10 | Mise en production et bêta | 4 j | URL publique, 5 à 10 bêta-testeurs |
| 11 | Après le MVP | itératif | Selon les retours de la bêta |

Total du MVP (phases 0 à 10) : environ 53 jours ouvrés pour une personne.

---

## Phase 0 : Fondations et décisions gelées

**Objectif** : le dépôt est outillé, les services existent, et chaque décision que le code va supposer est écrite.

### Décisions à trancher avant d'écrire du code

| Sujet | Recommandation | Raison |
| --- | --- | --- |
| Pile | Celle de Campaign Mailer : TypeScript, Express 5, React 19, Vite, Tailwind, PostgreSQL, BullMQ | Pratiques et services déjà maîtrisés (cahier des charges 8.1). |
| File de tâches | BullMQ sur Upstash à l'usage, budget plafonné | Plusieurs files actives dépasseraient l'offre gratuite (8.2). |
| Base de données | Nouveau projet Neon, us-east-1 | Même région que Redis et R2, et que Campaign Mailer. |
| Recherche du site officiel | Fournisseur de recherche web avec API officielle, choisi sur prix et conditions (Brave Search API ou SerpApi) | F-305. Aucun scraping de moteur de recherche. |
| Fournisseur d'enrichissement | Hunter | F-602. Recherche par domaine et vérification chez le même fournisseur. |
| Quotas du MVP | Valeurs par utilisateur et plafond global mensuel, écrits dans la documentation | F-1401, F-1405. |
| Licence | Propriétaire, comme Campaign Mailer | Même titulaire. |

### Lots de travail

- Initialiser le monorepo (workspaces `frontend`, `backend`), TypeScript strict, ESLint, Prettier, `.gitattributes` en LF, hooks de pré-commit, script `verify`.
  → skills : `anthropic-skills:nodejs-backend-patterns`, `lean-build`
- Rédiger `docs/decisions.md` avec le tableau ci-dessus tranché, daté et justifié.
  → skills : `writing-plans`, `anthropic-skills:technical-writer`
- Provisionner Neon, Upstash et un bucket R2 dédié, chaînes de connexion dans `backend/.env`, modèles `.env.example` commentés.
  → skills : `security-review`
- Créer le projet Google Cloud et l'écran de consentement avec les seules portées `openid`, `email`, `profile` (F-101).
  → skills : `security-review`
- Ouvrir les comptes Hunter et du fournisseur de recherche web, noter les quotas et les tarifs dans `docs/decisions.md`.
  → skills : `anthropic-skills:backend-patterns`
- Rédiger le `CLAUDE.md` du dépôt : architecture, règles non négociables, commandes.
  → skills : `init`, `anthropic-skills:docs-writer`
- Mettre en place l'intégration continue (vérification, tests), même si GitHub Actions reste indisponible sur le compte.
  → skills : `verification-before-completion`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- `npm run verify` passe sur un dépôt vide de logique métier.
- Les trois services répondent depuis le poste de développement.
- `docs/decisions.md` tranche chaque ligne du tableau.

### Risques

- Coût des fournisseurs sous-estimé : relever les tarifs réels dès cette phase et fixer le plafond global avant la Phase 4.

---

## Phase 1 : Comptes et socle applicatif

**Objectif** : un utilisateur se connecte avec Google, accepte les conditions, et voit une application vide mais complète dans sa structure.

### Lots de travail

- API Express : configuration, journaux pino, gestion d'erreurs, en-têtes de sécurité, `/health`.
  → skills : `anthropic-skills:nodejs-backend-patterns`, `security-review`
- Migrations initiales : `users`, `audit_events`, avec retour arrière.
  → skills : `migration`
- Connexion Google (Passport, stratégie OAuth 2.0 avec `state: true` dans les options de la stratégie), sessions en Redis, cookie `sameSite: lax`.
  → skills : `security-review`, `test-driven-development`
- Acceptation versionnée des conditions et de la politique de confidentialité (F-102).
  → skills : `test-driven-development`, `copywriting`
- Application web : routeur, système de conception repris de Campaign Mailer (palette, typographie, icônes), navigation, thèmes clair et sombre, états vides et squelettes.
  → skills : `frontend-design`, `taste-skill`, `composition-patterns`, `react-best-practices`
- Page de connexion : ce que fait MailFind, ce qu'il ne fait pas (aucun accès à la messagerie).
  → skills : `copywriting`, `emil-design-eng`
- Page Compte : identité, déconnexion, export des données, suppression du compte (F-104).
  → skills : `test-driven-development`, `security-review`

### Definition of Done

→ skills : `verification-before-completion`

- Connexion, déconnexion et suppression du compte fonctionnent de bout en bout.
- Aucune portée sensible n'est demandée à Google.

---

## Phase 2 : Import CSV et entreprises

**Objectif** : un fichier CSV devient une liste d'entreprises propres et dédoublonnées, sans encore chercher d'adresse.

### Lots de travail

- Migrations `imports`, `import_rows`, `companies`, avec leurs types énumérés et contraintes d'unicité.
  → skills : `migration`, `test-driven-development`
- Lecture du CSV dans le navigateur : encodage, séparateur, 5 000 lignes et 5 Mo au plus (F-201).
  → skills : `test-driven-development`, `react-best-practices`
- Correspondance automatique des colonnes, en français et en anglais, modifiable, avec prévisualisation des dix premières lignes (F-203, étapes 2 et 3 du parcours).
  → skills : `frontend-design`, `composition-patterns`, `emil-design-eng`
- Validation serveur des lignes, motifs de rejet lisibles (F-202).
  → skills : `test-driven-development`
- Normalisation des URL, domaines internationalisés, noms et formes juridiques (F-301, F-302).
  → skills : `test-driven-development`
- Dédoublonnage par domaine, SIREN, puis nom normalisé et ville (F-303).
  → skills : `test-driven-development`, `systematic-debugging`
- Écran de paramètres de l'import : profondeur, types recherchés, fournisseurs, étiquettes (étape 4).
  → skills : `frontend-design`, `design:ux-copy`
- File BullMQ et tâche `import.plan`, idempotente, avec reprise après redémarrage (F-205, F-206).
  → skills : `anthropic-skills:nodejs-backend-patterns`, `test-driven-development`

### Definition of Done

→ skills : `verification-before-completion`

- Un CSV de 500 lignes mélangeant noms, domaines et URL produit des entreprises sans doublon.
- Un import annulé ou interrompu garde ce qui a été traité et reprend sans refaire.

### Bilan (26 septembre 2026)

**Preuves de la Definition of Done.** `npm run test:integration`, sur PostgreSQL 18 :

- 500 lignes mêlant noms, domaines, URL et SIREN, avec des doublons de chaque sorte et 20 lignes inexploitables, donnent 300 entreprises et aucun doublon.
- Un import annulé pendant son deuxième lot garde les 200 lignes traitées et laisse les 280 autres intactes. Un import coupé à la 250e entreprise reprend sur les 231 lignes restantes, sans repasser sur les autres. Rejouer un import terminé ne fait rien.
- Parcours dans un navigateur, API et processus de traitement lancés : un fichier désordonné de 10 lignes donne 5 entreprises, et un fichier de 5 000 lignes annulé à 1 300 garde ces 1 300 lignes et laisse les 3 700 autres.

**Défauts trouvés à la clôture, et corrigés.**

- Une ligne portant un domaine et un SIREN déjà tenu par une autre fiche faisait échouer tout l'import. Deux lignes réduites à la même page carrières aussi. Et la relecture qui suit une course perdue rendait sa connexion à la réserve au milieu d'une transaction avortée.
- Un import dont la tâche avait épuisé ses tentatives restait « en préparation » pour toujours. Un import reçu pendant une indisponibilité de Redis n'était jamais repris.
- Le compteur des lignes retenues oubliait les doublons. L'aperçu laissait passer des lignes que le serveur écartait.
- Sur téléphone, la table des colonnes était coupée et la barre haute faisait défiler la page de côté.
- L'export du compte (F-104) rendait une liste d'entreprises vide.

**Reste hors de cette phase.** L'estimation des crédits avant lancement (étape 5, F-1402) et le plafond d'imports simultanés (D-14) sont en Phase 8. Le fichier d'origine n'est pas conservé dans R2 : ses lignes le sont, dans `import_rows`, et `imports.storage_key` reste nul.

---

## Phase 3 : Identification et collecte sur les sites

**Objectif** : pour chaque entreprise, le domaine officiel est confirmé et les adresses publiées sur son site sont relevées avec leur preuve.

### Lots de travail

- Client de l'API Recherche d'entreprises (SIREN, adresse, activité, effectif), avec respect de sa limite de débit (F-304).
  → skills : `anthropic-skills:backend-patterns`, `test-driven-development`
- Adaptateur du fournisseur de recherche web pour trouver le site officiel, indice de confiance, état « domaine à confirmer » (F-305).
  → skills : `test-driven-development`, `brainstorming`
- Reconnaissance des plateformes carrières tierces (Welcome to the Jungle, Lever, Greenhouse, Teamtailor, Workable) (F-306).
  → skills : `test-driven-development`
- Client HTTP de collecte : agent identifié, `robots.txt` (RFC 9309), une requête par seconde et par domaine, délais, taille maximale, redirections bornées (F-403 à F-405).
  → skills : `test-driven-development`, `security-review`
- Protection contre la falsification de requête côté serveur : adresses privées et de métadonnées refusées après résolution DNS et après redirection (S-05).
  → skills : `security-review`, `test-driven-development`
- Sélection des pages par profondeur (F-401, F-402).
  → skills : `test-driven-development`
- Extraction des adresses : `mailto:`, texte, JSON-LD, formes écrites courantes, sans décodage d'adresses masquées (F-406, F-407).
  → skills : `test-driven-development`, `systematic-debugging`
- Filtrage des faux positifs et détection des formulaires et pages carrières (F-408, F-410).
  → skills : `test-driven-development`
- Enregistrement des sources : URL, méthode, extrait de contexte échappé, date (F-411, S-06).
  → skills : `migration`, `test-driven-development`
- Jeu de sites de test servis localement pour la suite de tests du moteur (13.1).
  → skills : `test-driven-development`
- Page de suivi d'un import : progression réelle par étape, erreurs par entreprise.
  → skills : `frontend-design`, `motion-design`, `dataviz`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- Sur 50 entreprises réelles, chaque adresse relevée pointe vers la page où elle figure.
- Un site dont le `robots.txt` interdit l'agent n'est jamais visité (A6).
- Aucune requête ne part vers une adresse IP privée, même par redirection.

### Risques

- Sites construits en JavaScript : les signaler (F-412), ne pas ajouter de navigateur sans interface avant la Phase 11.

### Bilan (28 septembre 2026)

**Livré.** Tous les lots ci-dessus. La garde des adresses et le client HTTP ont été posés par le propriétaire le 28 septembre ; le reste s'est construit dessus.

**Preuves de la Definition of Done.**

- *Un site dont robots.txt interdit l'agent n'est jamais visité (A6)* : prouvé sur le jeu de sites local, par le journal des requêtes du serveur de test. Un site qui interdit tout reçoit une seule requête, pour robots.txt, y compris à travers tout le pipeline.
- *Aucune requête vers une adresse privée, même par redirection* : prouvé sur le client qui sert aussi aux tests du moteur. Machine locale par IP, par nom, en IPv6, en IPv4 déguisée en IPv6, et redirection vers 169.254.169.254 : tout est refusé.
- *Sur 50 entreprises réelles, chaque adresse relevée pointe vers la page où elle figure* : prouvé le 29 septembre 2026 sur la machine du propriétaire, `npm run crawl:check -- docs/recette/phase-3-domaines.txt` : 90 adresses relevées sur 19 entreprises, 90 retrouvées sur leur page, « critère tenu ».

**Recette sur 50 entreprises réelles (29 septembre 2026).** 35 sites lus, 15 injoignables. Parmi ces derniers, dix refusent l'agent par une protection anti-robot (403 ou 400 sur l'accueil), un a un robots.txt en erreur 500, ce qui interdit toute visite (RFC 9309), et ces refus sont respectés. Deux étaient des défauts, corrigés dans la foulée : croix-rouge.fr, dont le domaine nu coupe la connexion alors que www répond (le moteur essaie désormais www après un échec de connexion, jamais après un refus), et vinted.fr, dont l'accueil dépassait 2 Mo (limite portée à 3 Mo, D-21). Les sites lus sans adresse n'en publient pas : formulaire seul, adresse masquée, contenu en JavaScript. C'est le cas que l'enrichissement de la Phase 4 couvre.

**Défauts trouvés en cours de phase, et corrigés.**

- La garde laissait passer `http://[::ffff:169.254.169.254]/`, que le parseur d'URL réécrit en hexadécimal. Les adresses IPv6 sont désormais jugées comme des nombres, et tout ce qui n'est pas de l'unicast global est refusé.
- Le délai d'expiration ne mesurait que l'inactivité : une page qui distille un octet toutes les trois cents millisecondes tenait la connexion sans fin. Les pages en Windows-1252 étaient lues en UTF-8.
- Trois pages demandées en même temps sur un site inconnu lisaient trois fois robots.txt.
- Un site injoignable était noté « robots.txt interdit ».
- Hérité de la Phase 2 : un lien Welcome to the Jungle ou LinkedIn dans la colonne « site » donnait son domaine à l'entreprise, et le dédoublonnage fondait en une seule toutes celles qui n'avaient que ce lien.

**Reste à faire hors de cette phase.** Les clients Recherche d'entreprises et Brave sont testés sur des serveurs locaux au format des API, pas encore sur les API réelles ; la clé Brave existe depuis le 29 septembre 2026. La classification des adresses (6.8) et leur vérification restent en Phase 5 : toutes les adresses trouvées sont `unverified`.

---

## Phase 4 : Fournisseurs et adresses candidates

**Objectif** : quand le site ne suffit pas, les fournisseurs puis la déduction prennent le relais, sans jamais payer deux fois.

### Lots de travail

- Interface commune des fournisseurs et adaptateur Hunter (recherche par domaine) (F-601, F-602).
  → skills : `anthropic-skills:backend-patterns`, `test-driven-development`
- Ordre de repli configurable, erreurs de fournisseur non bloquantes (F-603, F-606).
  → skills : `test-driven-development`
- Cache des réponses par domaine, 30 jours, chiffré au repos (F-604).
  → skills : `migration`, `security-review`
- Réservation puis confirmation des crédits, comptage dans `provider_calls` (8.4).
  → skills : `test-driven-development`, `systematic-debugging`
- Génération des adresses de rôle candidates, sur domaine confirmé avec MX, plafonnée (F-501 à F-503, F-505).
  → skills : `test-driven-development`
- Adresses nominatives uniquement à partir d'un nom fourni et d'un format observé (F-504).
  → skills : `brainstorming`, `test-driven-development`, `security-review`

### Definition of Done

→ skills : `verification-before-completion`

- Une seconde recherche sur le même domaine dans les 30 jours ne consomme aucun crédit.
- Un import rejoué après une coupure ne consomme pas deux fois le même crédit (A5).

### Bilan (28 septembre 2026)

Démarrée en parallèle de la recette de la Phase 3, à la demande du propriétaire.

**Preuves de la Definition of Done**, sur PostgreSQL 18 :

- *Une seconde recherche sur le même domaine dans les 30 jours ne consomme aucun crédit* : un second import du même domaine, par un autre utilisateur, n'appelle pas le fournisseur et n'ajoute aucun crédit ; le résultat vient du cache chiffré.
- *Un import rejoué après une coupure ne consomme pas deux fois le même crédit (A5)* : une tâche morte entre la réservation et le règlement n'appelle pas le fournisseur au rejeu ; une étape rejouée normalement non plus.

**Livré.** Chiffrement au repos AES-256-GCM avec rotation de clé (S-01) ; interface commune des fournisseurs et adaptateur Hunter ; `paidCall`, le chemin unique de tout appel payant, que Brave emprunte désormais aussi ; plafonds comptés par opération (30 recherches et 20 vérifications Hunter par mois, D-14) ; étape `company.enrich` avec l'ordre de repli de `PROVIDER_ORDER` ; adresses de rôle candidates, cinq au plus, sur un domaine qui a des MX ; adresses nominatives seulement à partir d'un nom fourni et d'un format observé.

**Avancé d'une phase.** La classification par préfixe (6.8) est arrivée ici, parce que le repli des fournisseurs et les candidates ont besoin de savoir quel type manque. L'affinage par le contexte de la page reste en Phase 5.

**Reste à faire.** Hunter n'est testé que sur un serveur local au format de son API : l'environnement de développement bloque api.hunter.io et la clé n'existe pas encore. Les adresses fournies et déduites sont `unverified` ; leur vérification (F-503) est en Phase 5.

---

## Phase 5 : Vérification avancée et score

**Objectif** : chaque adresse porte un statut honnête, un motif, une date et un score expliqué.

### Lots de travail

- Contrôles locaux : syntaxe, DNS, MX avec repli A, domaines jetables (liste publique mise à jour chaque semaine), adresses de rôle, messageries grand public (niveaux 1 à 6 de 6.7).
  → skills : `test-driven-development`
- Vérification de boîte par le fournisseur et détection des domaines accept-all (niveau 8).
  → skills : `test-driven-development`, `anthropic-skills:backend-patterns`
- Statuts normalisés, historique des vérifications, revalidation après 30 jours (F-703, F-704).
  → skills : `migration`, `test-driven-development`
- Liste de suppression par utilisateur, contrôlée à chaque étape (niveau 7, R-04).
  → skills : `test-driven-development`, `security-review`
- Classification des adresses, par préfixe et par contexte de page (6.8).
  → skills : `test-driven-development`
- Score de confiance et son détail critère par critère (6.9).
  → skills : `test-driven-development`, `dataviz`
- Vérification ponctuelle d'une liste collée ou importée (F-705).
  → skills : `frontend-design`, `test-driven-development`

### Definition of Done

→ skills : `verification-before-completion`

- Aucune adresse `invalid`, `disposable` ou `suppressed` n'a un score supérieur à 0.
- Le détail du score affiché correspond au calcul, pour chaque critère.

### Bilan (28 septembre 2026)

**Preuves de la Definition of Done**, sur PostgreSQL 18 :

- *Aucune adresse `invalid`, `disposable` ou `suppressed` n'a un score supérieur à 0* : le calcul met ces statuts à zéro par une ligne du détail, vérifié sur toutes les combinaisons de statut, d'origine, de type et de sources ; de bout en bout, deux entreprises vérifiées puis une adresse ajoutée à la liste de suppression ne laissent aucune adresse écartée au-dessus de 0.
- *Le détail du score affiché correspond au calcul, pour chaque critère* : le plafond d'une adresse déduite, la mise à zéro et les bornes 0 à 100 sont des lignes du détail, dont la somme est toujours le score (test sur toutes les combinaisons, et en base après l'étape de vérification). La page n'affiche que le détail enregistré, jamais un calcul refait dans le navigateur, et signale un détail qui ne tomberait pas juste.

**Livré.** Migration des vérifications (historique, F-703), de la liste de suppression (empreintes seulement) et des domaines jetables ; contrôles locaux, niveaux 1 à 7, sans aucune connexion SMTP (D-09) ; liste des domaines jetables rechargée chaque semaine ; liste de suppression contrôlée à la collecte, à l'enrichissement et à la vérification (R-04) ; vérification de boîte par Hunter selon le réglage de l'import (F-702), un demi-crédit, quatre par compte et vingt crédits par mois (D-14), cache de trente jours sous l'empreinte de l'adresse ; revalidation après trente jours (F-704) ; candidate refusée écartée et plus montrée (F-503) ; type par le contexte de la page (6.8) ; score et son détail (6.9) ; étape `company.verify` ; liste des adresses d'un import avec le détail du score au survol ; vérification ponctuelle d'une liste collée ou d'un CSV (F-705).

**Choix faits en route.** Le tableau de 6.9 fait foi pour le score, et une déduction ne confirme rien (D-18). La vérification ponctuelle s'en tient aux contrôles gratuits : la vérification de boîte, payante, reste réservée aux imports, où elle est comptée. Une adresse retirée de la liste de suppression revient à la vérification suivante.

**Reste à faire.** La vérification de Hunter n'est testée que sur un fournisseur simulé : l'environnement de développement bloque api.hunter.io et la clé n'existe pas encore. La revalidation avant un export « prêt à l'envoi » et avant un envoi vers Campaign Mailer (F-704) se branchera sur ces deux chemins, en Phases 6 et 7. Le rebond signalé par Campaign Mailer (F-706) attend la Phase 7.

---

## Phase 6 : Bibliothèque, page Contacts et exports

**Objectif** : l'utilisateur consulte, corrige et exploite ses résultats, et les emporte dans le format dont il a besoin.

### Lots de travail

- Tableau de bord : entreprises, adresses par statut, imports en cours, crédits du mois (F-1001).
  → skills : `frontend-design`, `dataviz`, `taste-skill`
- Vue Entreprises : recherche plein texte, filtres, tri, pagination (F-1002).
  → skills : `frontend-design`, `composition-patterns`, `react-best-practices`
- **Page Contacts, CRUD complet** : liste de toutes les adresses quelle que soit leur origine, tri par entreprise, nom, adresse, type, statut, score, origine et date depuis l'en-tête des colonnes, recherche, filtres combinables, pagination de 25, 50 ou 100 lignes (F-1003, F-1010 à F-1012).
  → skills : `frontend-design`, `composition-patterns`, `react-best-practices`, `test-driven-development`
- Création et modification d'un contact depuis la page Contacts, avec vérification relancée quand l'adresse change (F-1013, F-1014).
  → skills : `test-driven-development`, `emil-design-eng`, `design:ux-copy`
- Suppression unitaire et en masse, avec option d'ajout à la liste de suppression (F-1015, R-05).
  → skills : `test-driven-development`, `security-review`
- Fiche entreprise : adresses par type avec leurs sources, canaux alternatifs, historique, notes, correction du domaine (F-1004, F-307).
  → skills : `frontend-design`, `composition-patterns`
- Actions en masse et fusion de doublons (F-1005, F-1006).
  → skills : `test-driven-development`, `composition-patterns`
- Exports CSV « une ligne par adresse » et « une ligne par entreprise », triés par entreprise, neutralisés contre l'injection de formules (6.11, S-07).
  → skills : `test-driven-development`, `security-review`
- Export XLSX en quatre onglets, et export JSON imbriqué (6.11).
  → skills : `anthropic-skills:xlsx`, `test-driven-development`
- Export au format Campaign Mailer (`email`, `contact_name`, `company_name`, `salutation`).
  → skills : `test-driven-development`
- Exports volumineux en tâche, stockés 7 jours, journalisés (F-1104, F-1106).
  → skills : `anthropic-skills:nodejs-backend-patterns`, `test-driven-development`
- Audit d'accessibilité des vues (F-1009).
  → skills : `web-design-guidelines`, `design:accessibility-review`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- Chaque adresse exportée a une source (A4).
- Le fichier Campaign Mailer s'importe dans Campaign Mailer sans retouche.
- La page Contacts crée, modifie, trie, recherche, pagine et supprime sur un jeu de 1 000 adresses.

### Bilan (29 septembre 2026)

**Preuves de la Definition of Done**, sur PostgreSQL 18 :

- *Chaque adresse exportée a une source (A4)* : la base refuse une adresse sans source, et l'export charge les sources de chaque adresse, la plus vérifiable en tête ; le test d'intégration vérifie qu'aucune ligne exportée n'a une colonne de source vide. Une adresse déduite ou saisie a pour source la règle ou l'utilisateur, avec sa date (D-19).
- *Le fichier Campaign Mailer s'importe dans Campaign Mailer sans retouche* : un fichier produit par MailFind (accents, guillemets, virgules et points-virgules dans les valeurs, doublon, adresses que Campaign Mailer refuserait) a été passé dans le code même de Campaign Mailer au commit `427749e` : lecture par papaparse avec ses réglages, correspondance automatique des colonnes (`guessMapping`), puis validation serveur (`collectContacts`). Les quatre colonnes sont reconnues sans intervention, et aucune ligne n'est refusée.
- *La page Contacts crée, modifie, trie, recherche, pagine et supprime sur un jeu de 1 000 adresses* : un test d'intégration fait les six sur mille adresses ; un autre pagine les mille sans doublon ni oubli, trie dans les deux sens avec les valeurs vides en fin de liste, et combine recherche et filtres.

**Livré.** Page Contacts (F-1010 à F-1015) : liste de toutes les adresses, tri depuis les en-têtes, recherche, filtres combinables, pagination de 25, 50 ou 100, filtres dans l'adresse de la page ; création et modification, avec contrôles relancés quand l'adresse change et historique de l'ancienne conservé ; suppression unitaire et en masse, avec la liste de suppression proposée. Vue Entreprises (F-1002) avec résumé des adresses et filtres par ville, pays, secteur, étiquette, statut de collecte et type présent. Fiche entreprise (F-1004) et correction du domaine qui relance la collecte (F-307). Actions en masse (F-1005) : type, étiquettes, exclusion, vérification, revérification, export, suppression ; fusion de doublons (F-1006). Exports (6.11, F-1101 à F-1106) : CSV par adresse et par entreprise, XLSX en quatre onglets, JSON imbriqué, Campaign Mailer ; au-delà de 2 000 adresses en tâche, gardés sept jours dans R2 ; tous journalisés. Tableau de bord (F-1001). Audit d'accessibilité (F-1009).

**Audit d'accessibilité.** axe-core, règles WCAG 2.0 à 2.2 niveaux A et AA, sur quinze états des vues (dialogues, filtres, barres de sélection et détail du score ouverts), en thème clair et sombre, à 1 280 et 390 pixels : 45 problèmes trouvés, aucun restant (contraste du gris le plus clair, cibles tactiles de 24 pixels, champs de fichier sans nom, menu de filtre hors de l'écran d'un téléphone, lien d'évitement). Un parcours au clavier vérifie ce qu'axe ne voit pas : filtres, tri, détail du score au focus, dialogues qui gardent le focus et le rendent.

**Choix faits en route.** « Exclure » veut dire « hors des exports et des envois », et la règle F-503 tient désormais au statut (D-20). Une correction de domaine passe par un import d'une ligne, pour que l'historique la garde. Le fichier Campaign Mailer reprend la règle d'adresse de Campaign Mailer et laisse de côté ce qu'il refuserait, en le disant (D-19). La navigation passe en menu sous 1 024 pixels.

**Reste à faire.** L'envoi vers Campaign Mailer depuis une sélection (F-1005) et la revalidation avant envoi (F-704) sont la Phase 7. Les exports volumineux n'ont été produits que dans un stockage en mémoire : R2 répond depuis la machine du propriétaire (`npm run check:services`), pas depuis cet environnement. La notification d'un export volumineux prêt (F-1104) est dans l'application (page Exports et tableau de bord), pas par courriel. F-1007 (entreprise « ignorée » ou « déjà contactée ») attend l'intégration de la Phase 7.

---

## Phase 7 : API publique et intégration Campaign Mailer

**Objectif** : une application tierce trouve et vérifie des adresses par API, et une sélection part dans Campaign Mailer en un clic.

### Lots de travail

- Clés d'API hachées, portées, dernière utilisation, révocation (F-1302, F-1303, S-02).
  → skills : `security-review`, `test-driven-development`, `migration`
- Conventions de l'API : erreurs `problem+json`, pagination par curseur, `Idempotency-Key`, limitation de débit (F-1304 à F-1307).
  → skills : `anthropic-skills:nodejs-backend-patterns`, `test-driven-development`
- Points d'accès `imports`, `companies`, `emails`, `find`, `verify`, `exports`, `usage` (6.13).
  → skills : `test-driven-development`, `anthropic-skills:backend-patterns`
- Document OpenAPI 3.1 produit depuis les schémas, page de documentation, tests de contrat (F-1301, A8).
  → skills : `anthropic-skills:openapi-regen`, `anthropic-skills:write-api-reference`
- Webhooks signés, nouvelles tentatives, journal des livraisons (F-1308, S-10).
  → skills : `security-review`, `test-driven-development`
- Connexion à Campaign Mailer par jeton d'intégration chiffré (F-1201). Dépend du lot « jetons d'intégration » de la Phase 9 de Campaign Mailer.
  → skills : `security-review`, `brainstorming`
- Envoi d'une sélection vers une campagne en brouillon : prévisualisation, exclusions, lots de 500 avec clé d'idempotence, rapport (F-1202 à F-1209).
  → skills : `test-driven-development`, `frontend-design`, `systematic-debugging`
- Tests de contrat partagés avec Campaign Mailer.
  → skills : `test-driven-development`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- Un envoi vers Campaign Mailer relancé deux fois ne crée aucun doublon (A7).
- L'API répond conformément à son document OpenAPI (A8).

### Risques

- Campaign Mailer n'a pas encore son API `v1` : la Phase 7 de MailFind attend ce lot, ou livre d'abord l'export fichier seul.

### Bilan (29 septembre 2026)

Close sur décision du propriétaire, sans l'intégration Campaign Mailer, comme le prévoit le registre des risques (D-23).

**Preuves de la Definition of Done.**

- *L'API répond conformément à son document OpenAPI (A8)* : prouvé sur PostgreSQL 18. Un test compare les opérations du document aux routes réellement montées, dans les deux sens ; les tests de contrat appellent chaque opération et valident chaque réponse par le schéma de sa ligne dans le document, et échouent si une opération n'est jamais appelée. Un essai de mutation (un champ renommé) a fait échouer les tests, après qu'il eut montré qu'une liste vide ne validait rien : chaque liste testée doit désormais porter au moins un élément.
- *Un envoi vers Campaign Mailer relancé deux fois ne crée aucun doublon (A7)* : **reporté**. Campaign Mailer n'a pas encore son API `v1` ni ses jetons d'intégration (vérifié sur son dépôt au commit `427749e`, prévus dans sa Phase 9). En attendant, l'export au format Campaign Mailer, validé en Phase 6, s'importe sans retouche. Suite prévue : construire l'API `v1` dans Campaign Mailer, puis le côté MailFind contre elle.

**Livré.** Clés d'API hachées, portées, dernière utilisation, révocation (F-1302, F-1303). Routeur `/v1` hors session et hors jeton CSRF ; limitation de débit par clé dans Redis avec en-têtes `RateLimit-*` (F-1304) ; `Idempotency-Key` gardée 24 heures (F-1305) ; erreurs RFC 9457 (F-1306) ; pagination par curseur (F-1307). Points d'accès `imports`, `find`, `companies`, `emails`, `verify` (100 adresses en direct, 10 000 en tâche), `exports`, `usage` (F-1309) et `webhooks`. Document OpenAPI 3.1 servi sans clé sur `/v1/openapi.json`, page `/documentation-api` (F-1301). Webhooks signés HMAC-SHA256 horodatés, secret chiffré, quatre tentatives, journal des livraisons, envoi par la garde des adresses sans suivre de redirection (F-1308).

**Défauts trouvés en cours de phase, et corrigés.**

- Un import de plus d'un mégaoctet était refusé (413) avant d'atteindre sa route : le lecteur JSON global passait avant le sien. Hérité de la Phase 2.
- Un JSON mal formé ou trop gros recevait une « erreur interne » 500 au lieu de 400 ou 413.
- L'export du compte (F-104) ne portait aucune adresse, un reste de la Phase 2.
- Le tableau de bord comptait comme consommées les recherches Hunter vides, non facturées.
- La dernière ligne d'une page revenait en tête de la suivante : PostgreSQL garde la microseconde, JavaScript la milliseconde.
- Le filtre `type=support` des adresses était refusé.

**Choix faits en route.** Réponses en snake_case, comme l'annexe C. Pas de portée `emails:write` dans F-1303 : modifier ou supprimer une adresse passe par `companies:write`. `POST /v1/find` rend tout de suite, sans rien dépenser, une entreprise déjà explorée, et lance sinon un import d'une ligne. Les exports de l'API sont toujours produits en tâche et servis avec la clé, jamais par une URL signée. Les événements des webhooks sont minces : identifiant et statut, le reste se lit par l'API. La création d'un webhook est exclue de l'idempotence, qui garderait son secret en clair.

### Complément (1er octobre 2026) : l'intégration Campaign Mailer

Construite dans l'ordre fixé par D-23. D'abord l'API `v1` dans le dépôt de Campaign Mailer (branche `feat/api-v1`, cinq lots : jetons d'intégration, `POST /api/v1/campaigns` et `POST /api/v1/campaigns/:id/contacts`, champs de source et de vérification, document OpenAPI servi sur `/api/v1/openapi.json`, mention « Importé depuis MailFind »). Puis le côté MailFind, en trois lots.

**Preuves.**

- *Un envoi vers Campaign Mailer relancé deux fois ne crée aucun doublon (A7)* : prouvé des deux côtés. Chez MailFind, sur PostgreSQL 18, contre un faux serveur fidèle au contrat : un envoi dont la réponse se perd est rejoué avec la même `Idempotency-Key` par lot (`mailfind-<envoi>-<rang>`) et le brouillon reste unique, les lots déjà faits ne repartent pas. Chez Campaign Mailer, par ses tests d'intégration sur le vrai code : le même corps rejoué avec la même clé rend la même réponse sans rien créer.
- *Tests de contrat partagés* : une copie du document OpenAPI de Campaign Mailer est gardée dans `docs/contracts/`. Un test valide contre elle les corps que MailFind envoie, et un cas faux prouve qu'il ne passe pas à vide. Régénérer la copie quand Campaign Mailer change son API dit aussitôt si MailFind suit.

**Livré.** Connexion par jeton d'intégration chiffré, vérifié à la forme, révocable, depuis la page Compte (F-1201). Envoi d'une sélection de la page Contacts vers un brouillon, par lots de 500, en tâche reprise après une panne, avec suivi de l'avancement (F-1202 à F-1206). Les adresses que Campaign Mailer refuserait sont laissées de côté et comptées ; la source et le statut de vérification partent avec chaque contact, `unverified` seul quand l'adresse n'a pas été vérifiée. Le même envoi par l'API publique : `POST /v1/integrations/campaign-mailer/push` (portée `integrations:write`) et `GET /v1/integrations/campaign-mailer/pushes/{id}`. L'export du compte porte la connexion et les envois. La campagne reste un brouillon : seul l'utilisateur la lance.

**Connexion croisée (D-26), ajoutée à la demande du propriétaire.** « Se connecter avec Campaign Mailer » sur la page d'accueil de MailFind, et « Se connecter avec MailFind » sur celle de Campaign Mailer. Un compte par identité Google, sans doublon ; une adresse portée par un autre compte Google est refusée. Prouvé sur PostgreSQL 18 : code à usage unique, secret faux, code périmé, jeton d'état faux, compte existant retrouvé sans doublon ni perte du nom, conflit d'adresse. Configuration : `CAMPAIGN_MAILER_SSO_SECRET` ici, `MAILFIND_SSO_SECRET` chez Campaign Mailer, même valeur.

**Reste à faire, côté propriétaire.** Fusionner les lots 3 à 5 de `feat/api-v1` dans Campaign Mailer (sa branche principale n'a que les lots 1 et 2), appliquer ses migrations en production, puis renseigner `CAMPAIGN_MAILER_API_URL` dans MailFind. Un essai de bout en bout entre les deux applications déployées fermera F-1201 à F-1209.

**Reste à faire.** L'essai en production de l'intégration Campaign Mailer, ci-dessus. La limitation de débit n'est testée qu'avec un compteur en mémoire ; son script Redis, avec la file de politesse, attend `TEST_REDIS_URL`.

---

## Phase 7B : Vérification certifiée et annuaire partagé

Ajoutée le 30 septembre 2026 à la demande du propriétaire (cahier des charges 6.17 et 6.18, décisions D-24 et D-25).

**Objectif** : une adresse « certifiée » est une adresse dont la boîte a été confirmée ; les adresses mortes disparaissent ; un utilisateur sans fichier trouve des entreprises et leurs adresses publiques dans un annuaire commun.

### Lots de travail

Vérification certifiée :

- Adaptateur Reacher (API hébergée, licence commerciale) derrière l'interface des vérificateurs de boîte et `paidCall` ; ordre de repli Hunter puis Reacher ; aucune connexion SMTP depuis nos serveurs (F-1701, R-14).
  → skills : `brainstorming`, `anthropic-skills:backend-patterns`, `test-driven-development`, `security-review`
- Correspondance des verdicts de Reacher vers les statuts de 6.7, motifs gardés (F-1702).
  → skills : `test-driven-development`
- Badge « certifiée » dans les vues, les exports et l'API ; filtre « certifiées seulement » (F-1703, F-1704).
  → skills : `frontend-design`, `emil-design-eng`, `composition-patterns`, `test-driven-development`
- Adresses non fonctionnelles écartées tout de suite, onglet « écartées », suppression définitive après 7 jours, journalisée (F-1705).
  → skills : `test-driven-development`, `migration`, `security-review`
- Vérification de boîte de toute la bibliothèque, dans la limite des crédits, avec estimation (F-1706).
  → skills : `frontend-design`, `test-driven-development`

Annuaire partagé :

- Analyse d'impact et conditions d'utilisation mises à jour avant tout code : MailFind responsable de traitement de l'annuaire, base légale, information et opposition (R-12, R-13).
  → skills : `security-review`, `anthropic-skills:technical-writer`, `copywriting`, `copy-editing`
- Migrations de l'annuaire, hors des comptes (F-1801).
  → skills : `brainstorming`, `migration`, `security-review`
- Alimentation par les seules adresses trouvées sur une page publique, jamais le contenu privé d'un compte ni les résultats d'un fournisseur (F-1802, F-1805).
  → skills : `test-driven-development`, `security-review`
- Page « Annuaire » : recherche par nom, domaine, ville, secteur et type, triée par entreprise, filtre « certifiées » (F-1803).
  → skills : `frontend-design`, `taste-skill`, `composition-patterns`, `react-best-practices`, `test-driven-development`
- Ajout depuis l'annuaire à sa bibliothèque, avec la source d'origine (F-1804).
  → skills : `test-driven-development`, `emil-design-eng`
- Opposition et effacement pour tous ; plafond de consultation contre l'aspiration ; retrait après 12 mois sans revue (F-1806 à F-1808).
  → skills : `test-driven-development`, `security-review`, `migration`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- Aucune adresse ne porte le badge « certifiée » sans vérification de boîte `valid` de moins de 30 jours.
- Une adresse `invalid` ou `disposable` vérifiée est absente de la bibliothèque 7 jours plus tard, et ne figure dans aucun export entre-temps.
- Aucune donnée privée d'un compte (fichier importé, note, étiquette, colonne libre, adresse saisie ou fournie par un fournisseur) n'apparaît dans l'annuaire : test d'intégration avec deux comptes.
- Une demande d'effacement retire l'adresse de l'annuaire pour tous et l'empêche d'y revenir.

### Risques

- Licence : le code de Reacher est sous AGPL-3.0 ; un produit propriétaire ne l'utilise que sous licence commerciale ou par son API hébergée. Ne pas en copier le code.
- Coût : la vérification de boîte est payante chez chaque fournisseur, et D-13 fixe le budget à 0 € ; le badge ne peut pas être promis à toute la bibliothèque sans budget.
- Juridique : l'annuaire change le rôle de MailFind (responsable de traitement). Il n'ouvre pas avant l'analyse d'impact et la relecture juridique.

---

## Phase 8 : Sécurité, conformité, quotas et coûts

**Objectif** : l'application peut accueillir des utilisateurs extérieurs sans risque pour eux, pour les sites explorés ni pour le budget.

### Lots de travail

- [x] Chiffrement AES-256-GCM des secrets au repos et procédure de rotation (S-01).
  → skills : `security-review`
  Le chiffrement existait depuis la Phase 4 ; le 1er octobre 2026 s'ajoutent la réécriture des valeurs (`npm run rotate:encryption`) et la procédure dans `docs/security.md`. Un test échoue si une colonne `*_encrypted` du schéma échappe à la rotation. Une entrée de cache illisible est supprimée, un secret illisible est laissé en place et le script sort en erreur : l'ancienne clé ne doit pas être retirée tant qu'un secret en dépend.
- [x] Journaux et Sentry sans adresse ni jeton (S-03).
  → skills : `security-review`, `test-driven-development`
  `backend/src/observability/scrub.ts` masque par motif, pas par nom de champ : adresses, clés `mf_`, jetons `cm_`, secrets `whsec_`, valeurs chiffrées, en-têtes `Bearer`, jetons Google, et le `code` ou le `state` d'une URL de retour. Branché dans pino sur le message, les champs, les erreurs et la requête, et dans Sentry (`observability/errors.ts`), qui part sans IP, sans cookie, sans corps ni chaîne de requête, avec le compte réduit à son identifiant. Seules les pannes à 500 et les tâches définitivement abandonnées y sont envoyées.
- [x] Quotas par utilisateur et arrêt propre sur quota (F-1401, F-1403, F-1404).
  → skills : `test-driven-development`, `frontend-design`
  Entreprises, pages et exports ont un plafond mensuel par compte, tenu dans un compteur : il faut prendre une place et refuser la suivante dans la même instruction, ce qu'un décompte ne garantit pas. Au plafond, l'étape passe `quota_blocked`, l'import le dit au lieu de se croire terminé, et repart sur `POST /api/imports/:id/resume` ou de lui-même à l'entretien quotidien.
- [x] Estimation du coût avant traitement, et confirmation (F-1402).
  → skills : `test-driven-development`, `frontend-design`
  Au-delà de vingt lignes, l'import ne part pas sans que l'utilisateur ait vu ce qu'il va consommer : entreprises, pages, appels fournisseurs, coût, et ce qui reste de ses quotas. L'estimation majore, et dit quand le quota ne suffira pas. Le refus porte l'estimation, pour que l'interface n'ait pas à la redemander.
- [x] Effacement à la demande d'une personne, pour tous les comptes (A9).
  → skills : `test-driven-development`, `security-review`
  La liste de suppression d'un compte ne vaut que pour lui ; quand c'est la personne concernée qui demande, l'adresse part de tous les comptes et ne peut plus être collectée. Effacement et interdiction dans la même transaction : effacer sans interdire laisserait le prochain import la retrouver. Seule l'empreinte est gardée.
- [x] Plafond global de dépense par fournisseur, suspension et alerte (F-1405).
  → skills : `test-driven-development`
  Le coût est figé en centimes sur la ligne à la réservation : les crédits ne sont pas des euros, et un tarif peut changer en cours de mois. Atteint, le plafond refuse pour tout le monde, et l'alerte part une seule fois par fournisseur et par mois, décidée par l'insertion. Défaut trouvé par les tests : un appel non facturé pesait encore sur le budget.
- [x] Conservation et purge automatique (R-06).
  → skills : `test-driven-development`, `migration`
  Douze mois pour une adresse sans usage et pour le journal d'audit, quatre-vingt-dix jours pour les traces techniques. « Sans usage » a demandé une colonne : `updated_at` bouge quand MailFind réécrit, pas quand une personne se sert. La purge efface par paquets, pour ne pas tenir un verrou le temps d'un balayage.
- [x] Page publique de l'agent de collecte et demande d'exclusion d'un site (R-07, F-1603).
  → skills : `copywriting`, `test-driven-development`
  `/robot` dit ce que le robot lit, à quel rythme, ce qu'il refuse de faire, et porte le formulaire. Hors session, sans demander ni nom ni adresse. Une demande prend effet à sa réception, couvre les sous-domaines, et vaut pour tous les comptes.
- [x] Conditions d'utilisation, politique de confidentialité, liste des sous-traitants, mention type d'information des personnes (R-03, R-11).
  → skills : `copywriting`, `copy-editing`
  Deux pages publiques, et [`docs/legal/`](docs/legal/) pour les sous-traitants et la mention type. Le texte sépare les deux rôles : responsable pour les comptes, sous-traitant pour les adresses collectées. Version `2026-10-02`, à réaccepter.
- [x] Registre des traitements et analyse d'impact (R-11, R-12).
  → skills : `anthropic-skills:technical-writer`
  [`registre-traitements.md`](docs/legal/registre-traitements.md) et [`analyse-impact.md`](docs/legal/analyse-impact.md). Aucun risque résiduel élevé, donc pas de consultation préalable de la CNIL. **À faire relire par un juriste avant l'ouverture au public.**
- [x] Revue de sécurité complète et analyse des dépendances (S-11).
  → skills : `security-review`, `code-review`
  `npm audit` sans vulnérabilité. Deux défauts trouvés et corrigés dans le même lot : la liste des sites exclus était publique, et la demande d'exclusion n'avait aucun garde-fou. Le compte rendu est dans [`docs/security.md`](docs/security.md).

### Definition of Done

→ skills : `verification-before-completion`

- Aucune anomalie de sécurité critique ou haute ouverte (A10).
- Une demande d'effacement supprime l'adresse et empêche sa collecte future (A9).

---

## Phase 9 : Tests, observabilité et documentation

**Objectif** : une panne se voit, se comprend et se répare sans deviner.

### Lots de travail

- [x] Couverture : 70 % au global, 90 % dans les services, sur schéma jetable.
  → skills : `test-driven-development`
  Les deux suites mesurées ensemble : séparément, les chiffres mentent dans les deux sens. 89 % des lignes au global, planchers posés sous le niveau atteint pour empêcher une régression. Les neuf modules de domaine tiennent les 90 % demandés, vérification comprise : son cache DNS, qui décide combien de fois une liste de mille adresses interroge le DNS, est passé de non testé à prouvé. Seuls les modules de bordure restent sous le global, et ils ne s'exécutent que pour de vrai.
- [x] Parcours de bout en bout dans un navigateur : connexion, import, suivi, page Contacts, export.
  → skills : `test-driven-development`, `run`
  De la porte fermée au fichier téléchargé, puis la connexion à Campaign Mailer et l'envoi d'une sélection vers un brouillon, plus les pages publiques qui doivent répondre sans compte. Quatre choses remplacées, chacune parce qu'elle sort de la machine : Google, Internet, les files, et Campaign Mailer, dont le serviteur d'emprunt exige la clé d'idempotence et rend la même réponse pour la même clé.
- [x] `/ready`, alertes fournisseurs, files, dépense, processus silencieux (section 12).
  → skills : `systematic-debugging`
  Le battement de cœur était la pièce manquante : sans lui, une file vide et un processus arrêté se ressemblent. L'évaluation des alertes est une fonction pure, testée sans Redis ni base, parce que ce qui manque le plus à une alerte, c'est d'être juste.
- [x] Documentation : architecture, procédures d'incident, règles de collecte et de vérification, guide de l'API.
  → skills : `anthropic-skills:docs-writer`, `anthropic-skills:write-api-reference`
  [`architecture.md`](docs/architecture.md), [`runbook.md`](docs/runbook.md), [`collecte-et-verification.md`](docs/collecte-et-verification.md), [`guide-api.md`](docs/guide-api.md). Le runbook signale une procédure non testée : la restauration de la base.

### Definition of Done

→ skills : `verification-before-completion`

- Les seuils de couverture passent, le parcours de bout en bout passe.

---

## Phase 10 : Mise en production et bêta

**Objectif** : MailFind est en ligne, sauvegardé, et utilisé par de vrais bêta-testeurs avec Campaign Mailer.

### Lots de travail

- Déployer l'API et les processus de traitement sur Railway en US East, l'interface sur Vercel.
  → skills : aucun
- Secrets de production, vérification qu'aucun secret n'est dans l'historique git.
  → skills : `security-review`
- Migrations en production, sauvegarde quotidienne, restauration testée et consignée.
  → skills : `migration`, `verify-and-stop`
- Test de production sur le jeu de 100 entreprises de la recette (A1, A2).
  → skills : `run`, `verify-and-stop`
- Recruter 5 à 10 bêta-testeurs parmi les utilisateurs de Campaign Mailer, guide de prise en main, canal de retours.
  → skills : `customer-research`, `onboarding`, `copywriting`
- Mesurer les indicateurs de 2.2.
  → skills : `analytics`
- Traiter les retours de la bêta.
  → skills : `investigate-first`, `systematic-debugging`, `surgical-patch`, `verify-and-stop`
- Préparer le lancement public.
  → skills : `launch`, `product-marketing`, `copywriting`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- Tous les critères d'acceptation A1 à A10 sont vérifiés en production.
- Au moins 5 bêta-testeurs ont envoyé une sélection vers Campaign Mailer et lancé la campagne.

---

## Phase 11 : Après le MVP

À prioriser selon les retours de la bêta, pas selon l'ordre de cette liste.

- Recherche d'entreprises en langage naturel, transformée en critères structurés.
  → skills : `brainstorming`, `claude-api`, `test-driven-development`
- Détection des offres d'alternance et d'emploi sur les pages carrières, reliées aux contacts.
  → skills : `brainstorming`, `test-driven-development`
- Suivi des candidatures par entreprise (à contacter, contactée, réponse, entretien, refus), alimenté par Campaign Mailer (F-1007, F-1210).
  → skills : `brainstorming`, `frontend-design`, `composition-patterns`
- Rendu des sites en JavaScript par un navigateur sans interface, sous quota (F-413).
  → skills : `brainstorming`, `security-review`
- Second fournisseur d'enrichissement, fournisseur spécialisé de vérification.
  → skills : `anthropic-skills:backend-patterns`, `test-driven-development`
- Espaces d'équipe, rôles, facturation et offres.
  → skills : `pricing`, `paywalls`, `offers`, `security-review`

---

## Registre des risques

| Risque | Parade | Phase |
| --- | --- | --- |
| Coût des fournisseurs | Cache, estimation, plafonds | 0, 4, 8 |
| Blocage de l'agent par les sites | Débit bas, agent identifié, `robots.txt` | 3 |
| Plainte d'une personne ou d'un site | Provenance, retrait, suppression, analyse d'impact | 8 |
| Dérive de périmètre | Phase 11 fermée avant la validation de la Phase 10 | toutes |
| API de Campaign Mailer pas prête | Export fichier d'abord, API ensuite | 7 |
