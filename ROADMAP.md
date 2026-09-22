# Roadmap : MailFind

Plan d'exécution, du dépôt vide à la bêta publique.
Référence : [`docs/cahier-des-charges.md`](docs/cahier-des-charges.md), version 1.0 du 22 septembre 2026.

- **Statut** : dépôt créé, cahier des charges et roadmap rédigés. Phase 0 à démarrer.
- **Dernière mise à jour** : 22 septembre 2026
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

---

## Phase 8 : Sécurité, conformité, quotas et coûts

**Objectif** : l'application peut accueillir des utilisateurs extérieurs sans risque pour eux, pour les sites explorés ni pour le budget.

### Lots de travail

- Chiffrement AES-256-GCM des secrets au repos et procédure de rotation (S-01).
  → skills : `security-review`
- Journaux et Sentry sans adresse ni jeton (S-03).
  → skills : `security-review`, `test-driven-development`
- Quotas par utilisateur, estimation avant lancement, arrêt propre sur quota (F-1401 à F-1404).
  → skills : `test-driven-development`, `frontend-design`
- Plafond global de dépense par fournisseur, suspension et alerte (F-1405).
  → skills : `test-driven-development`
- Conservation et purge automatique (R-06).
  → skills : `test-driven-development`, `migration`
- Page publique de l'agent de collecte et demande d'exclusion d'un site (R-07, F-1603).
  → skills : `copywriting`, `test-driven-development`
- Conditions d'utilisation, politique de confidentialité, liste des sous-traitants, mention type d'information des personnes (R-03, R-11).
  → skills : `copywriting`, `copy-editing`
- Registre des traitements et analyse d'impact (R-11, R-12).
  → skills : `anthropic-skills:technical-writer`
- Revue de sécurité complète et analyse des dépendances (S-11).
  → skills : `security-review`, `code-review`

### Definition of Done

→ skills : `verification-before-completion`

- Aucune anomalie de sécurité critique ou haute ouverte (A10).
- Une demande d'effacement supprime l'adresse et empêche sa collecte future (A9).

---

## Phase 9 : Tests, observabilité et documentation

**Objectif** : une panne se voit, se comprend et se répare sans deviner.

### Lots de travail

- Couverture : 70 % au global, 90 % dans les services, sur schéma jetable.
  → skills : `test-driven-development`
- Parcours de bout en bout dans un navigateur : connexion, import, suivi, page Contacts, export, envoi vers Campaign Mailer.
  → skills : `test-driven-development`, `run`
- `/ready`, alertes fournisseurs, files, dépense, processus silencieux (section 12).
  → skills : `systematic-debugging`
- Documentation : architecture, procédures d'incident, règles de collecte et de vérification, guide de l'API.
  → skills : `anthropic-skills:docs-writer`, `anthropic-skills:write-api-reference`

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
