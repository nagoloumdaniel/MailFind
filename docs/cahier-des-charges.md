# Cahier des charges fonctionnel et technique : MailFind

| | |
| --- | --- |
| **Produit** | MailFind, bibliothèque de contacts professionnels d'entreprises |
| **Version du document** | 1.0 |
| **Date** | 22 septembre 2026 |
| **Auteur et propriétaire** | Daniel Nagoloum Talla |
| **Statut** | Référence pour le développement du MVP |
| **Produit lié** | Campaign Mailer (envoi de campagnes depuis Gmail) |

## Historique des versions

| Version | Date | Objet |
| --- | --- | --- |
| 1.0 | 22 septembre 2026 | Première version de référence |

## Sommaire

1. Présentation du projet
2. Objectifs et indicateurs de réussite
3. Périmètre
4. Utilisateurs et cas d'usage
5. Parcours principal
6. Exigences fonctionnelles
7. Exigences non fonctionnelles
8. Architecture technique
9. Modèle de données
10. Sécurité
11. Conformité juridique et protection des données
12. Exploitation et observabilité
13. Tests et recette
14. Planning et jalons
15. Risques
16. Glossaire
17. Annexes

---

## 1. Présentation du projet

### 1.1 Contexte

Une personne qui cherche une alternance, un stage ou des clients passe l'essentiel de son temps à trouver à qui écrire. Pour chaque entreprise, elle ouvre le site, cherche une page de contact ou de recrutement, relève une adresse quand il y en a une, et recommence. Sur une liste de 200 entreprises, ce travail prend plusieurs jours et produit un tableur sans source, sans date et sans indication de fiabilité.

Campaign Mailer, développé par le même auteur, résout l'étape suivante : envoyer un message personnalisé à chaque contact depuis le compte Gmail de l'utilisateur, à un rythme maîtrisé. Il suppose une liste de contacts déjà constituée. MailFind produit cette liste.

### 1.2 Le produit

MailFind est une application web qui transforme une liste d'entreprises en une bibliothèque d'adresses email professionnelles vérifiées, classées par entreprise et prêtes à l'envoi.

L'utilisateur importe un fichier CSV contenant des noms d'entreprises, des domaines, des sites web ou des pages carrières. Pour chaque ligne, MailFind identifie l'entreprise et son domaine officiel, explore les pages publiques pertinentes de son site, interroge des fournisseurs d'enrichissement disposant d'une API officielle, génère les adresses de rôle probables, vérifie chaque adresse obtenue et enregistre sa source. Le résultat s'exporte en CSV, XLSX ou JSON, toujours classé par entreprise, ou s'envoie directement dans Campaign Mailer sous forme de campagne en brouillon.

MailFind expose aussi une API publique qui permet à d'autres applications de rechercher des adresses pour un domaine, de lancer une vérification et de récupérer les résultats.

### 1.3 Ce qui distingue MailFind

- **Chaque adresse a une preuve.** L'URL où elle a été trouvée, la méthode, la date et le fournisseur sont conservés et affichés. Une adresse sans source n'existe pas dans MailFind.
- **La vérification est un statut, pas une promesse.** MailFind distingue une adresse trouvée, une adresse déduite et une adresse vérifiée, et ne présente jamais un résultat incertain comme certain.
- **Plusieurs sources, un seul résultat.** Le site officiel d'abord, les fournisseurs ensuite, la déduction en dernier. Une adresse confirmée par plusieurs sources monte en confiance.
- **Le coût est maîtrisé.** Chaque appel payant est compté, mis en cache et plafonné. L'utilisateur voit l'estimation avant de lancer un traitement.
- **La sortie est directement utilisable.** Les exports sont structurés par entreprise et le format Campaign Mailer s'importe sans retouche.

---

## 2. Objectifs et indicateurs de réussite

### 2.1 Objectifs

| N° | Objectif |
| --- | --- |
| O1 | Réduire de plusieurs jours à quelques minutes la constitution d'une liste de contacts pour 200 entreprises. |
| O2 | Trouver au moins une adresse exploitable pour la majorité des entreprises disposant d'un site web. |
| O3 | Ne jamais exporter comme vérifiée une adresse qui ne l'est pas. |
| O4 | Conserver la provenance de chaque donnée, pour la transparence et la conformité. |
| O5 | Envoyer les résultats dans Campaign Mailer sans export manuel. |
| O6 | Offrir une API stable et documentée pour la recherche et la vérification d'adresses. |
| O7 | Maîtriser le coût des fournisseurs payants, par utilisateur et par traitement. |

### 2.2 Indicateurs mesurés

| Indicateur | Cible au lancement de la bêta |
| --- | --- |
| Taux de couverture : entreprises avec au moins une adresse `valid` ou `risky`, parmi celles qui ont un site accessible | 70 % ou plus |
| Taux de rebond constaté dans Campaign Mailer sur des adresses `valid` exportées par MailFind | moins de 3 % |
| Durée de traitement d'un import de 100 entreprises en profondeur standard | moins de 15 minutes |
| Adresses exportées sans source | 0 |
| Latence de l'API en lecture (95e centile) | moins de 300 ms |
| Coût fournisseur moyen par entreprise traitée | affiché, et sous le plafond fixé en Phase 0 |

---

## 3. Périmètre

### 3.1 Inclus dans le MVP

- Comptes utilisateurs avec connexion Google (identité uniquement, sans accès à la messagerie).
- Import CSV avec détection et correspondance des colonnes.
- Identification des entreprises et de leur domaine officiel.
- Collecte ciblée sur les pages publiques du site officiel.
- Interrogation d'au moins un fournisseur d'enrichissement (Hunter).
- Génération d'adresses de rôle candidates.
- Vérification locale (syntaxe, DNS, MX, domaines jetables, adresses de rôle) et vérification de boîte par un fournisseur.
- Score de confiance par adresse.
- Bibliothèque consultable, filtrable, avec actions en masse.
- Exports CSV, XLSX et JSON classés par entreprise, et format Campaign Mailer.
- Envoi direct vers Campaign Mailer.
- API publique v1 avec clés, documentation OpenAPI et webhooks.
- Quotas, compteur de crédits et estimation des coûts.
- Liste de suppression, suppression de données, journal d'audit.

### 3.2 Prévu après le MVP

- Recherche d'entreprises en langage naturel (« startups SaaS de moins de 200 personnes à Lyon qui recrutent des alternants »).
- Détection des offres d'emploi et d'alternance sur les pages carrières.
- Suivi des candidatures par entreprise (à contacter, contactée, réponse, entretien, refus).
- Rendu des sites construits en JavaScript par un navigateur sans interface.
- Espaces d'équipe partagés, rôles et facturation.
- Second fournisseur d'enrichissement et fournisseur spécialisé de vérification.

### 3.3 Hors périmètre

- Envoi d'emails. C'est le rôle de Campaign Mailer.
- Collecte sur des réseaux sociaux, des annuaires dont les conditions l'interdisent ou des pages derrière une authentification.
- Contournement d'une protection technique : CAPTCHA, masquage d'adresse, limitation de débit, blocage d'adresse IP.
- Revente ou partage de données entre utilisateurs.
- Constitution de profils de personnes. MailFind décrit des entreprises et leurs canaux de contact, pas des individus.

---

## 4. Utilisateurs et cas d'usage

### 4.1 Profils

| Profil | Besoin principal |
| --- | --- |
| Candidat (alternance, stage, emploi) | Trouver l'adresse recrutement ou RH de 50 à 300 entreprises ciblées, puis écrire à chacune depuis Campaign Mailer. |
| Indépendant ou commercial | Constituer une liste de contacts génériques ou commerciaux pour une prospection B2B mesurée. |
| Recruteur ou chargé de relations entreprises | Tenir à jour les contacts d'un portefeuille d'entreprises partenaires. |
| Application tierce | Interroger MailFind par API pour obtenir ou vérifier des adresses. Campaign Mailer est la première. |
| Administrateur | Surveiller l'usage, les coûts, les erreurs et les fournisseurs. |

### 4.2 Récits utilisateur principaux

| N° | En tant que | Je veux | Afin de |
| --- | --- | --- | --- |
| U1 | candidat | importer la liste des entreprises qui m'intéressent | ne pas chercher leurs adresses une par une |
| U2 | candidat | voir en priorité les adresses recrutement et RH | écrire à la bonne personne |
| U3 | utilisateur | savoir d'où vient chaque adresse et si elle est vérifiée | décider en connaissance de cause |
| U4 | utilisateur | exporter les adresses classées par entreprise | les retravailler dans un tableur |
| U5 | utilisateur de Campaign Mailer | envoyer ma sélection dans une nouvelle campagne | lancer mes envois sans ressaisie |
| U6 | utilisateur | connaître le coût d'un traitement avant de le lancer | ne pas épuiser mes crédits par erreur |
| U7 | développeur | appeler une API pour trouver et vérifier des adresses | intégrer MailFind à mon application |
| U8 | utilisateur | supprimer une entreprise ou une adresse, définitivement | répondre à une demande d'effacement |

---

## 5. Parcours principal : de l'import à l'export

La recherche des adresses est déclenchée par l'import d'un fichier CSV. Tout le traitement se fait en arrière-plan : l'utilisateur peut quitter la page et revenir, la progression est conservée.

| Étape | Déclencheur | Comportement attendu |
| --- | --- | --- |
| 1. Téléversement | L'utilisateur dépose un fichier CSV | Le fichier est lu dans le navigateur. Encodage (UTF-8, Windows-1252) et séparateur (virgule, point-virgule, tabulation) sont détectés. |
| 2. Correspondance des colonnes | Automatique, modifiable | Chaque colonne est rapprochée d'un champ connu (voir 6.2). L'utilisateur corrige si besoin. |
| 3. Prévisualisation | Automatique | Les dix premières lignes s'affichent telles qu'elles seront traitées. Les lignes inexploitables sont signalées avec leur motif. |
| 4. Paramètres | L'utilisateur choisit | Profondeur de collecte (rapide, standard, approfondie), types d'adresses recherchés (recrutement, RH, générique, commercial, presse), fournisseurs autorisés, étiquettes à appliquer. |
| 5. Estimation | Automatique | Nombre d'entreprises, crédits fournisseurs estimés, durée estimée. Confirmation obligatoire au-delà du seuil fixé par l'utilisateur. |
| 6. Normalisation | Lancement | Noms, domaines et URL sont nettoyés. Les doublons dans le fichier et avec la bibliothèque sont détectés. |
| 7. Identification | Par entreprise | Le domaine officiel est confirmé ou recherché (voir 6.3). |
| 8. Collecte web | Par entreprise | Les pages publiques pertinentes du site sont explorées (voir 6.4). |
| 9. Enrichissement | Si le résultat est insuffisant | Les fournisseurs configurés sont interrogés dans l'ordre (voir 6.6). |
| 10. Adresses candidates | Si aucun rôle recherché n'est trouvé | Les adresses de rôle probables sont générées (voir 6.5). |
| 11. Vérification | Pour chaque adresse | Contrôles locaux, puis vérification de boîte selon les réglages (voir 6.7). |
| 12. Classement et score | Pour chaque adresse | Type, score de confiance et rattachement à l'entreprise (voir 6.8 et 6.9). |
| 13. Rapport | Fin de l'import | Entreprises traitées, adresses trouvées par statut, erreurs, crédits consommés. Notification dans l'application et par webhook. |
| 14. Export ou envoi | L'utilisateur choisit | Export classé par entreprise ou envoi vers Campaign Mailer (voir 6.11 et 6.12). |

---

## 6. Exigences fonctionnelles

Chaque exigence porte un identifiant. La priorité est notée **M** (indispensable au MVP), **S** (souhaitée au MVP) ou **P** (après le MVP).

### 6.1 Comptes et accès

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-101 | Connexion par Google avec les seules portées `openid`, `email` et `profile`. MailFind ne demande aucun accès à la messagerie. | M |
| F-102 | Acceptation des conditions d'utilisation et de la politique de confidentialité à la première connexion, versionnées. | M |
| F-103 | Chaque utilisateur a sa propre bibliothèque. Aucune donnée n'est visible d'un autre compte. | M |
| F-104 | Page Compte : identité, consommation du mois, clés d'API, connexion à Campaign Mailer, export de toutes ses données, suppression du compte. | M |
| F-105 | Espaces d'équipe avec rôles (propriétaire, membre, lecture seule). | P |

### 6.2 Import CSV

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-201 | Formats acceptés : CSV et TSV, jusqu'à 5 000 lignes et 5 Mo par fichier. | M |
| F-202 | Chaque ligne doit contenir au moins un nom d'entreprise, un domaine, une URL de site ou une URL de page carrières. Une ligne qui n'en contient aucun est écartée avec son motif. | M |
| F-203 | Correspondance automatique des colonnes à partir des en-têtes usuels, en français et en anglais, modifiable par l'utilisateur. | M |
| F-204 | Les colonnes non reconnues sont conservées comme attributs libres de l'entreprise et restituées à l'export. | S |
| F-205 | Un import peut être annulé en cours. Les entreprises déjà traitées restent dans la bibliothèque. | M |
| F-206 | Un import interrompu (redémarrage du service) reprend là où il s'était arrêté, sans refaire les étapes terminées ni consommer deux fois un crédit. | M |
| F-207 | Import par l'API, en fichier ou en lignes JSON (voir 6.13). | M |

Champs reconnus :

| Champ | Obligatoire | En-têtes reconnus (exemples) | Exemple |
| --- | --- | --- | --- |
| `company_name` | un des quatre | entreprise, société, company, nom | Doctolib |
| `domain` | un des quatre | domaine, domain | doctolib.fr |
| `website_url` | un des quatre | site, site web, website, url | `https://www.doctolib.fr` |
| `careers_url` | un des quatre | carrières, recrutement, careers, jobs | `https://careers.doctolib.fr` |
| `city` | non | ville, city | Paris |
| `country` | non | pays, country | France |
| `siren` | non | siren, siret | 794598813 |
| `industry` | non | secteur, industry | Santé, logiciel |
| `contact_name` | non | contact, nom du contact | Camille Martin |
| `tags` | non | étiquettes, tags | alternance;paris |
| `notes` | non | notes, commentaire | Candidature spontanée |

### 6.3 Normalisation et identification des entreprises

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-301 | Normalisation des URL : protocole ajouté si absent, `www.` et chemins retirés pour obtenir le domaine, domaines internationalisés convertis en punycode. | M |
| F-302 | Normalisation des noms : casse, espaces, accents et formes juridiques (SAS, SARL, SA, Inc., Ltd, GmbH) écartés pour la comparaison, conservés pour l'affichage. | M |
| F-303 | Dédoublonnage par domaine, puis par SIREN, puis par nom normalisé et ville. Un doublon est rattaché à l'entreprise existante, jamais créé deux fois. | M |
| F-304 | Quand seul le nom est fourni, recherche de l'entreprise dans l'API Recherche d'entreprises de l'État (France) pour obtenir SIREN, adresse, activité et tranche d'effectif. | M |
| F-305 | Quand le domaine manque, recherche du site officiel par un fournisseur de recherche web disposant d'une API officielle. Le résultat est proposé avec un indice de confiance ; en dessous du seuil, l'entreprise passe en « domaine à confirmer » et l'utilisateur tranche. | M |
| F-306 | Une page carrières hébergée chez un tiers (Welcome to the Jungle, Lever, Greenhouse, Teamtailor, Workable) est reconnue comme telle : elle n'est pas prise pour le domaine de l'entreprise. | M |
| F-307 | L'utilisateur peut corriger le domaine d'une entreprise ; la collecte est alors relancée sur le bon domaine. | M |

### 6.4 Moteur de collecte sur le site officiel

La collecte explore un petit nombre de pages ciblées. Elle ne parcourt jamais un site entier.

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-401 | Pages visitées, dans cet ordre : page d'accueil, pages dont le chemin ou le lien correspond à contact, contactez-nous, nous-contacter, a-propos, about, equipe, mentions-legales, legal, recrutement, carrieres, careers, jobs, rejoindre, presse, press. La page carrières fournie dans l'import est ajoutée. | M |
| F-402 | Profondeur par niveau : **rapide** (accueil et page contact, 3 pages au plus), **standard** (liste F-401, 10 pages au plus), **approfondie** (liens internes de ces pages, 25 pages au plus). | M |
| F-403 | Respect du fichier `robots.txt` (RFC 9309) pour l'agent de MailFind. Une page interdite n'est pas visitée. | M |
| F-404 | Agent utilisateur explicite, identifiant MailFind et donnant une URL de contact et de retrait. | M |
| F-405 | Une requête à la fois par domaine, au moins une seconde entre deux requêtes sur le même domaine, délai d'expiration de 10 secondes, 2 Mo au plus par page, 2 redirections au plus hors du domaine. | M |
| F-406 | Extraction des adresses : liens `mailto:`, texte visible, attributs, données structurées `schema.org` (JSON-LD, microdonnées), formes écrites courantes (`contact [at] domaine [point] fr`, `contact(at)domaine.fr`). | M |
| F-407 | Aucune tentative de décoder une adresse volontairement masquée par un mécanisme de protection (chiffrement côté client, image, script de masquage). La page est notée « adresse masquée » et le formulaire de contact est proposé à la place. | M |
| F-408 | Détection des formulaires de contact et des liens vers des pages carrières, conservés comme canaux alternatifs quand aucune adresse n'est publiée. | M |
| F-409 | Relevé complémentaire : téléphone du standard, lien LinkedIn de l'entreprise, adresse postale publiée dans les mentions légales. | S |
| F-410 | Filtrage des faux positifs : adresses d'exemple, adresses de prestataires (hébergeur, agence web, outil de formulaire), fichiers images nommés comme des adresses, domaines sans rapport avec l'entreprise sauf s'ils sont confirmés par les mentions légales. | M |
| F-411 | Chaque adresse trouvée est enregistrée avec l'URL exacte de la page, la méthode d'extraction, un extrait du contexte (200 caractères au plus) et la date. | M |
| F-412 | Les pages rendues uniquement par JavaScript sont signalées « contenu dynamique non analysé ». | M |
| F-413 | Rendu de ces pages par un navigateur sans interface, sous quota. | P |
| F-414 | Mise en cache des pages visitées pendant 7 jours : une seconde collecte sur le même domaine dans ce délai ne refait pas les requêtes. | S |

### 6.5 Génération d'adresses candidates

Quand la collecte et les fournisseurs n'ont pas trouvé d'adresse du type recherché, MailFind propose les adresses de rôle les plus probables pour le domaine. Ces adresses sont des hypothèses : elles portent l'origine « déduite » et ne sont jamais exportées comme vérifiées sans vérification positive.

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-501 | Génération à partir d'une liste de préfixes de rôle par type (annexe D), dans l'ordre de fréquence observée. | M |
| F-502 | Uniquement sur le domaine confirmé de l'entreprise, et seulement si ce domaine a des enregistrements MX. | M |
| F-503 | Chaque candidate est vérifiée (6.7) avant d'apparaître dans les résultats. Une candidate `invalid` est écartée sans être montrée ; une candidate `unknown` ou `accept_all` apparaît avec la mention « non confirmée ». | M |
| F-504 | Adresses nominatives (prenom.nom@) : générées seulement si l'utilisateur fournit lui-même le nom de la personne dans l'import, et seulement en suivant un format déjà observé sur le domaine (par exemple une adresse nominative trouvée sur le site ou fournie par un fournisseur). Jamais par combinaison de noms trouvés ailleurs. | S |
| F-505 | Le nombre de candidates vérifiées par entreprise est plafonné (5 par défaut) pour contenir le coût de vérification. | M |

### 6.6 Fournisseurs d'enrichissement

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-601 | Chaque fournisseur est un adaptateur derrière une interface commune (recherche par domaine, recherche nominative, vérification). Changer de fournisseur ne modifie aucun autre module. | M |
| F-602 | Fournisseur de référence : Hunter (recherche par domaine, vérification). Second fournisseur possible : Snov.io. Fournisseur spécialisé de vérification possible : ZeroBounce ou NeverBounce. | M pour Hunter, P pour les autres |
| F-603 | Ordre de repli par défaut : site officiel, puis Hunter, puis second fournisseur, puis adresses candidates. Un fournisseur n'est appelé que si les étapes précédentes n'ont pas trouvé d'adresse du type recherché. | M |
| F-604 | Chaque réponse est mise en cache par domaine pendant 30 jours. Une seconde demande sur le même domaine dans ce délai ne consomme aucun crédit. | M |
| F-605 | Les clés des fournisseurs sont celles de MailFind par défaut. Un utilisateur peut renseigner sa propre clé Hunter ; elle est chiffrée au repos et n'est jamais renvoyée par l'API. | S |
| F-606 | Une erreur de fournisseur (quota, indisponibilité, clé invalide) n'arrête pas l'import : l'étape est marquée en échec avec son motif et la suite du repli continue. | M |

### 6.7 Vérification avancée des adresses

La vérification produit un statut, un motif et une date. Elle ne garantit pas qu'un message sera lu, seulement qu'il a de bonnes chances d'être accepté.

Contrôles, du moins coûteux au plus coûteux :

| Niveau | Contrôle | Réalisé par | Coût |
| --- | --- | --- | --- |
| 1 | Syntaxe selon un sous-ensemble strict de la RFC 5321, longueur, caractères, domaine internationalisé | MailFind | nul |
| 2 | Existence du domaine (DNS) | MailFind | nul |
| 3 | Enregistrements MX, ou A en repli comme le prévoit la norme ; domaine sans serveur de messagerie refusé | MailFind | nul |
| 4 | Domaine jetable, d'après une liste publique tenue à jour chaque semaine | MailFind | nul |
| 5 | Adresse de rôle (contact, rh, jobs) repérée et typée | MailFind | nul |
| 6 | Adresse sur une messagerie grand public (gmail.com, outlook.fr) signalée pour un usage professionnel | MailFind | nul |
| 7 | Suppression : adresse présente dans la liste de suppression de l'utilisateur ou de Campaign Mailer | MailFind | nul |
| 8 | Vérification de la boîte auprès du serveur de messagerie, et détection des domaines qui acceptent toute adresse | fournisseur | crédit |

La vérification de boîte (niveau 8) est confiée à un fournisseur et n'est jamais faite depuis les serveurs de MailFind. Deux raisons : l'hébergeur bloque les ports SMTP sortants sur ses offres d'entrée de gamme, et sonder des serveurs de messagerie depuis l'adresse IP de l'application la ferait rapidement inscrire sur des listes de blocage.

Statuts normalisés :

| Statut | Signification | Action par défaut à l'export et vers Campaign Mailer |
| --- | --- | --- |
| `valid` | Le serveur de messagerie accepte cette adresse | Incluse |
| `accept_all` | Le domaine accepte toute adresse : impossible de confirmer celle-ci | Incluse si l'utilisateur l'autorise, signalée |
| `risky` | Adresse de rôle, messagerie grand public ou vérification partielle | Incluse si l'utilisateur l'autorise, signalée |
| `unknown` | Le serveur n'a pas répondu de façon exploitable | Exclue par défaut |
| `invalid` | Adresse inexistante ou domaine sans messagerie | Toujours exclue |
| `disposable` | Domaine jetable | Toujours exclue |
| `suppressed` | Adresse dans une liste de suppression | Toujours exclue, jamais réimportée |
| `unverified` | Pas encore vérifiée | Exclue des envois tant qu'elle n'est pas vérifiée |

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-701 | Les niveaux 1 à 7 sont appliqués à toute adresse, à la découverte et à l'import. | M |
| F-702 | Le niveau 8 est appliqué selon le réglage de l'import : jamais, adresses trouvées seulement, ou toutes (adresses candidates comprises). | M |
| F-703 | Chaque vérification est enregistrée : statut, sous-statut du fournisseur, motif lisible, fournisseur, date. L'historique est conservé. | M |
| F-704 | Revalidation : une adresse vérifiée il y a plus de 30 jours est revérifiée avant tout export marqué « prêt à l'envoi » et avant tout envoi vers Campaign Mailer. | M |
| F-705 | Vérification ponctuelle : l'utilisateur colle une liste d'adresses (jusqu'à 1 000) ou importe un CSV d'adresses seules, sans entreprise. | S |
| F-706 | Une adresse signalée en rebond par Campaign Mailer passe `invalid` avec le motif « rejet constaté à l'envoi ». | P |

### 6.8 Classification des adresses

| Type | Préfixes reconnus (exemples) | Priorité pour une candidature |
| --- | --- | --- |
| `recruitment` | recrutement, jobs, careers, carrieres, talent, candidature, emploi, alternance, stage | très haute |
| `hr` | rh, hr, drh, people, ressources.humaines | haute |
| `generic` | contact, hello, bonjour, info, accueil, office | moyenne |
| `sales` | commercial, sales, business, ventes | selon l'usage |
| `press` | presse, press, media, communication | selon l'usage |
| `support` | support, help, aide, sav | basse |
| `personal` | forme prenom.nom, p.nom, prenom | à traiter avec prudence (voir 11) |
| `unknown` | tout le reste | basse |

Le type est déduit automatiquement et reste modifiable. Le contexte de la page aide à trancher : une adresse trouvée sur la page carrières est typée `recruitment` même si son préfixe est générique.

### 6.9 Score de confiance

Un score de 0 à 100 résume la fiabilité de la donnée. Il mesure la qualité de l'adresse, pas la probabilité d'obtenir une réponse.

| Critère | Effet |
| --- | --- |
| Trouvée sur le site officiel de l'entreprise | +40 |
| Trouvée dans les mentions légales ou la page contact | +10 |
| Confirmée par un second fournisseur ou une seconde page | +15 |
| Vérification `valid` | +30 |
| Vérification `accept_all` | +5 |
| Adresse de rôle pertinente pour les types recherchés | +5 |
| Adresse déduite, non confirmée | plafonnée à 40 |
| Source datant de plus de 12 mois | -15 |
| Vérification `unknown` | -10 |
| Vérification `invalid`, `disposable` ou `suppressed` | score à 0 |

Le détail du calcul est affiché au survol du score, critère par critère.

### 6.10 Bibliothèque

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1001 | Tableau de bord : entreprises, adresses par statut, imports en cours avec progression réelle, crédits du mois, derniers exports. | M |
| F-1002 | Vue Entreprises : recherche plein texte, filtres (ville, pays, secteur, étiquette, statut de collecte, présence d'une adresse par type), tri, pagination. | M |
| F-1003 | Vue Adresses : adresse, entreprise, type, statut, score, source, date de vérification ; filtres combinables. | M |
| F-1004 | Fiche entreprise : identité, domaine, SIREN, liens, toutes ses adresses regroupées par type avec leurs sources, canaux alternatifs (formulaire, page carrières), historique des traitements, notes. | M |
| F-1005 | Actions en masse : vérifier, revérifier, typer, étiqueter, exclure, exporter, envoyer vers Campaign Mailer, supprimer. | M |
| F-1006 | Fusion manuelle de deux entreprises reconnues comme doublons. | S |
| F-1007 | Marquer une entreprise « ignorée » ou « déjà contactée ». L'état « déjà contactée » est mis à jour automatiquement par Campaign Mailer quand l'intégration est active. | S |
| F-1008 | Les résultats incertains sont affichés avec leur statut, jamais masqués ni présentés comme vérifiés. | M |
| F-1009 | Interface en français, responsive, utilisable au clavier, conforme au niveau AA des WCAG 2.2. | M |
| F-1010 | Page Contacts avec gestion complète (création, lecture, modification, suppression) de toutes les adresses de la bibliothèque, quelle que soit leur origine (import CSV, collecte, fournisseur, déduction, saisie manuelle). | M |
| F-1011 | Tri de la page Contacts par entreprise, nom du contact, adresse, type, statut de vérification, score, origine et date d'ajout, dans les deux sens, depuis l'en-tête de chaque colonne ou une liste de tri. Les valeurs vides sont toujours placées en fin de liste. | M |
| F-1012 | Recherche plein texte sur l'adresse, le nom, l'entreprise et le domaine, combinable avec les filtres de F-1003. Pagination de 25, 50 ou 100 lignes par page, avec le nombre total de résultats. | M |
| F-1013 | Création manuelle d'un contact : adresse, entreprise (existante ou nouvelle), nom, civilité, type, étiquettes. L'adresse créée suit les contrôles de 6.7 et porte l'origine `manual`. | M |
| F-1014 | Modification d'un contact : les mêmes champs, avec un nouvel essai de vérification si l'adresse change. L'historique des vérifications de l'ancienne adresse est conservé. | M |
| F-1015 | Suppression d'un contact, unitaire ou en masse, avec confirmation, et option d'ajout à la liste de suppression pour ne plus jamais le collecter. | M |

### 6.11 Exports

Les exports conservent toujours le lien entre chaque adresse et son entreprise. Les lignes sont triées par entreprise, puis par type (recrutement d'abord), puis par score décroissant.

| Format | Structure | Usage |
| --- | --- | --- |
| CSV « une ligne par adresse » | Colonnes de l'entreprise, puis colonnes de l'adresse (annexe B) | Tableur, CRM, retraitement |
| CSV « une ligne par entreprise » | Colonnes de l'entreprise, puis `best_email`, `recruitment_emails`, `hr_emails`, `generic_emails`, séparées par des points-virgules | Vue synthétique, candidature manuelle |
| XLSX | Quatre onglets : Entreprises, Adresses, Sources, Synthèse. En-têtes figés, filtres activés, une couleur par statut | Analyse et partage |
| JSON | `companies[]`, chaque entreprise contenant `emails[]`, chaque adresse contenant `sources[]` et `verification` | Intégration technique |
| CSV Campaign Mailer | `email`, `contact_name`, `company_name`, `salutation` : les quatre colonnes que l'import de Campaign Mailer reconnaît | Import direct dans Campaign Mailer |

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1101 | Export de la sélection courante, d'un import, d'une étiquette ou de toute la bibliothèque. | M |
| F-1102 | Filtre de statut à l'export : `valid` seulement, `valid` et `accept_all`, ou tous sauf les statuts toujours exclus. Réglage par défaut : `valid` et `accept_all`. | M |
| F-1103 | Une adresse par entreprise et par type (la meilleure) ou toutes les adresses. | M |
| F-1104 | Les exports volumineux (plus de 2 000 lignes) sont produits en arrière-plan, stockés 7 jours, et signalés par une notification. | M |
| F-1105 | Encodage UTF-8 avec marque d'ordre des octets pour une ouverture correcte dans Excel, séparateur au choix. | M |
| F-1106 | Chaque export est journalisé : qui, quand, quel filtre, combien de lignes. | M |

### 6.12 Intégration avec Campaign Mailer

Les deux applications restent indépendantes : chacune a sa base de données et ses règles. Elles communiquent uniquement par l'API versionnée de Campaign Mailer.

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1201 | Connexion : l'utilisateur crée un jeton d'intégration dans la page Compte de Campaign Mailer (portées `campaigns:write` et `contacts:write`) et le colle dans MailFind. Le jeton est chiffré au repos dans MailFind et n'est jamais réaffiché. | M |
| F-1202 | Envoi d'une sélection vers une nouvelle campagne en brouillon, avec son nom et son type (prospection, alternance, relance, marketing, autre), ou vers un brouillon existant. | M |
| F-1203 | Prévisualisation avant envoi : nombre d'adresses transmises, exclues (et pourquoi), doublons déjà présents dans la campagne. | M |
| F-1204 | Champs transmis : `email`, `contact_name`, `company_name`, `salutation`, `source_url`, `verification_status`, `verified_at`. Campaign Mailer n'a pas à revérifier une adresse vérifiée depuis moins de 30 jours. | M |
| F-1205 | Revalidation préalable de toute adresse vérifiée depuis plus de 30 jours (F-704). | M |
| F-1206 | Les adresses `invalid`, `disposable`, `suppressed` et `unknown` ne sont jamais transmises. | M |
| F-1207 | Envoi par lots de 500 au plus, avec une clé d'idempotence par lot : une relance après une coupure ne crée pas de doublon. | M |
| F-1208 | Rapport de synchronisation : transmises, refusées par Campaign Mailer avec leur motif, déjà présentes. | M |
| F-1209 | Une campagne créée depuis MailFind reste un brouillon. Seul l'utilisateur la lance, depuis Campaign Mailer. | M |
| F-1210 | Retour de Campaign Mailer vers MailFind : adresses envoyées (l'entreprise passe « déjà contactée ») et adresses rejetées à l'envoi (passent `invalid`), par webhook signé. | P |
| F-1211 | Service de vérification pour Campaign Mailer : Campaign Mailer peut appeler `POST /v1/verify` de MailFind pour vérifier les contacts d'une campagne avant son lancement. | S |

Exemple de charge utile transmise à Campaign Mailer :

```json
{
  "name": "Alternance développement, Paris, septembre",
  "type": "alternance",
  "contacts": [
    {
      "email": "recrutement@entreprise-exemple.fr",
      "company_name": "Entreprise Exemple",
      "contact_name": null,
      "salutation": "Madame, Monsieur",
      "source_url": "https://www.entreprise-exemple.fr/carrieres",
      "verification_status": "valid",
      "verified_at": "2026-09-22T09:14:03Z"
    }
  ]
}
```

### 6.13 API publique

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1301 | API REST sous `/v1`, en JSON, décrite par un document OpenAPI 3.1 publié et une page de documentation. | M |
| F-1302 | Authentification par clé d'API envoyée dans l'en-tête `Authorization: Bearer`. Clés créées et révoquées dans la page Compte, affichées une seule fois, stockées hachées, avec portées et date de dernière utilisation. | M |
| F-1303 | Portées : `companies:read`, `companies:write`, `emails:read`, `imports:write`, `verify`, `exports:write`, `integrations:write`. | M |
| F-1304 | Limitation de débit par clé (60 requêtes par minute par défaut), signalée par les en-têtes `RateLimit-*` et une réponse 429 avec `Retry-After`. | M |
| F-1305 | En-tête `Idempotency-Key` accepté sur toutes les créations, conservé 24 heures. | M |
| F-1306 | Erreurs au format `application/problem+json` (RFC 9457), avec un code stable. | M |
| F-1307 | Pagination par curseur sur les listes. | M |
| F-1308 | Webhooks : `import.completed`, `import.failed`, `verification.completed`, `export.ready`. Signature HMAC-SHA256 dans l'en-tête `MailFind-Signature` avec horodatage, trois nouvelles tentatives avec délai croissant, journal des livraisons. | M |
| F-1309 | Consommation de l'API comptée dans les mêmes quotas que l'interface. | M |

Points d'accès :

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| POST | `/v1/imports` | Créer un import (fichier CSV ou lignes JSON) et le lancer |
| GET | `/v1/imports/{id}` | Statut et progression d'un import |
| GET | `/v1/imports/{id}/results` | Entreprises et adresses produites par l'import |
| POST | `/v1/imports/{id}/cancel` | Annuler un import |
| POST | `/v1/find` | Rechercher les adresses d'une entreprise (nom, domaine ou URL) ; réponse immédiate si en cache, sinon identifiant de tâche |
| GET | `/v1/companies` | Lister et filtrer les entreprises |
| POST | `/v1/companies` | Créer une entreprise |
| GET | `/v1/companies/{id}` | Détail d'une entreprise et de ses adresses |
| PATCH | `/v1/companies/{id}` | Modifier une entreprise |
| DELETE | `/v1/companies/{id}` | Supprimer une entreprise et ses adresses |
| POST | `/v1/companies/{id}/enrich` | Relancer la collecte d'une entreprise |
| GET | `/v1/emails` | Lister et filtrer les adresses |
| PATCH | `/v1/emails/{id}` | Modifier le type, les étiquettes ou l'exclusion d'une adresse |
| DELETE | `/v1/emails/{id}` | Supprimer une adresse |
| POST | `/v1/verify` | Vérifier une liste d'adresses (100 en réponse directe, jusqu'à 10 000 en tâche) |
| GET | `/v1/verifications/{id}` | Résultat d'une vérification en tâche |
| POST | `/v1/exports` | Créer un export filtré |
| GET | `/v1/exports/{id}` | Statut et lien de téléchargement temporaire |
| POST | `/v1/integrations/campaign-mailer/push` | Envoyer une sélection vers Campaign Mailer |
| GET | `/v1/usage` | Crédits et consommation de la période |
| GET, POST, DELETE | `/v1/webhooks` | Gérer les abonnements aux webhooks |

### 6.14 Quotas, crédits et coûts

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1401 | Quotas par utilisateur et par mois : entreprises traitées, pages explorées, recherches fournisseur, vérifications de boîte, exports volumineux. Valeurs fixées en Phase 0 et modifiables par l'administrateur. | M |
| F-1402 | Estimation du coût avant tout traitement de plus de 20 entreprises, avec confirmation obligatoire au-delà d'un seuil choisi par l'utilisateur. | M |
| F-1403 | Arrêt propre d'un import quand un quota est atteint : les entreprises restantes passent « en attente de quota » et reprennent au renouvellement ou sur décision de l'utilisateur. | M |
| F-1404 | Compteur par fournisseur, par utilisateur et par import, consultable. | M |
| F-1405 | Plafond global de dépense par fournisseur et par mois, qui suspend les appels payants pour tous les utilisateurs quand il est atteint et alerte l'administrateur. | M |

### 6.15 Notifications

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1501 | Notification dans l'application à la fin d'un import, d'une vérification en tâche ou d'un export. | M |
| F-1502 | Email récapitulatif à la fin d'un import long (plus de 10 minutes), désactivable. | S |

### 6.16 Administration

| Id | Exigence | Priorité |
| --- | --- | --- |
| F-1601 | Tableau d'administration : utilisateurs, consommation, coûts par fournisseur, taux d'erreur par fournisseur, files de tâches. | M |
| F-1602 | Activation ou désactivation d'un fournisseur sans redéploiement. | M |
| F-1603 | Gestion de la liste globale de domaines exclus (sites ayant demandé à ne pas être explorés). | M |
| F-1604 | Consultation du journal d'audit. | M |

---

## 7. Exigences non fonctionnelles

| Domaine | Exigence |
| --- | --- |
| Performance | Pages de l'interface interactives en moins de 2 secondes sur une connexion 4G. API en lecture sous 300 ms au 95e centile. |
| Débit de traitement | 100 entreprises en profondeur standard en moins de 15 minutes, sans dépasser une requête par seconde et par domaine. |
| Disponibilité | 99,5 % mensuels pour l'interface et l'API. Un traitement en cours survit au redémarrage d'un service. |
| Montée en charge | Les traitements passent par une file de tâches ; la capacité augmente en ajoutant des processus de traitement, sans changement de code. |
| Fiabilité | Toute tâche est idempotente et peut être rejouée sans double consommation de crédit ni doublon de données. |
| Accessibilité | WCAG 2.2 niveau AA : navigation au clavier, contrastes, libellés, annonces des changements d'état. |
| Compatibilité | Deux dernières versions de Chrome, Edge, Firefox et Safari, sur ordinateur et mobile. |
| Langue | Interface et messages en français. Codes d'erreur de l'API en anglais, stables. |
| Maintenabilité | TypeScript strict de bout en bout, couverture de tests d'au moins 70 % au global et 90 % dans les services métier. |
| Réversibilité | Export complet des données d'un utilisateur en JSON à tout moment. |

---

## 8. Architecture technique

### 8.1 Choix de la pile

La pile reprend celle de Campaign Mailer, pour réutiliser les pratiques, les services hébergés et les outils déjà maîtrisés.

| Couche | Choix | Raison |
| --- | --- | --- |
| Langage | TypeScript strict | Plusieurs machines à états (import, collecte, vérification) : une faute de frappe sur un statut doit échouer à la compilation. |
| Interface | React 19, Vite, Tailwind CSS, React Router | Identique à Campaign Mailer, un seul système de conception à tenir. |
| API | Node.js 24, Express 5, validation par schémas zod | Identique à Campaign Mailer. Les schémas produisent aussi le document OpenAPI. |
| Base de données | PostgreSQL (Neon), migrations SQL versionnées avec retour arrière | Données relationnelles, recherche plein texte native. |
| File de tâches | BullMQ sur Redis | Nouvelles tentatives, délais, limitation de débit par groupe (par domaine, par fournisseur). |
| Collecte | `fetch` de Node, Cheerio pour l'analyse HTML, un analyseur `robots.txt` conforme à la RFC 9309 | Léger, sans navigateur. Le rendu JavaScript est reporté après le MVP. |
| DNS | `node:dns/promises` | Contrôles MX et DNS sans service tiers. |
| Stockage de fichiers | Cloudflare R2, compatible S3 | Imports d'origine et exports, liens de téléchargement temporaires. |
| Exports XLSX | ExcelJS | Onglets, styles, filtres, écriture en flux. |
| Authentification | Passport.js, stratégie Google OAuth 2.0, sessions en Redis | Identique à Campaign Mailer, portées non sensibles uniquement. |
| Observabilité | pino (journaux JSON), Sentry | Identique à Campaign Mailer. |
| Hébergement | Vercel pour l'interface, Railway pour l'API et les processus de traitement | Identique à Campaign Mailer, même région que les données. |

### 8.2 Décision ouverte à trancher en Phase 0

L'offre gratuite d'Upstash compte chaque commande Redis. Campaign Mailer tient dans cette offre grâce à un seul processus qui dort quand rien n'est prévu. MailFind aura plusieurs files actives pendant les imports, et dépassera cette offre. Trois options, à arbitrer en Phase 0 : Upstash à l'usage, Redis hébergé chez Railway, ou file de tâches sur PostgreSQL. La recommandation est Upstash à l'usage, pour garder BullMQ et le même client que Campaign Mailer, avec un budget mensuel plafonné.

### 8.3 Composants

| Composant | Rôle |
| --- | --- |
| Application web | Tous les écrans. Lit le CSV dans le navigateur pour la correspondance des colonnes. |
| API | Authentification, bibliothèque, imports, exports, API publique, webhooks sortants. N'explore jamais un site. |
| Processus de collecte | Identification des entreprises et exploration des sites. Limitation par domaine. |
| Processus d'enrichissement et de vérification | Appels aux fournisseurs, contrôles DNS, calcul des scores. Limitation par fournisseur. |
| Processus d'export et de synchronisation | Production des fichiers, envoi vers Campaign Mailer, livraison des webhooks. |

### 8.4 Déroulé d'un import

1. L'API enregistre l'import et ses lignes, puis place une tâche `import.plan`.
2. `import.plan` normalise, dédoublonne et crée une tâche `company.identify` par entreprise nouvelle.
3. `company.identify` confirme le domaine, puis place `company.crawl`.
4. `company.crawl` explore les pages ciblées et enregistre adresses et sources, puis place `company.enrich` si le résultat est insuffisant, sinon `company.verify`.
5. `company.enrich` interroge les fournisseurs dans l'ordre de repli, puis génère les candidates si besoin, puis place `company.verify`.
6. `company.verify` applique les contrôles, calcule les scores et marque l'entreprise « traitée ».
7. Quand toutes les entreprises de l'import sont traitées, l'import passe « terminé », le rapport est produit et les webhooks sont émis.

Chaque tâche porte un identifiant dérivé de l'entreprise et de l'étape : la même étape ne peut pas être en file deux fois. Chaque appel payant est précédé d'une réservation de crédit et suivi de sa confirmation, pour qu'une tâche rejouée après une coupure ne paie pas deux fois.

---

## 9. Modèle de données

| Table | Champs principaux |
| --- | --- |
| `users` | id, google_id, email, name, terms_version, created_at, deleted_at |
| `imports` | id, user_id, filename, storage_key, settings (profondeur, types, fournisseurs), total_rows, processed_rows, status, estimated_credits, used_credits, created_at, completed_at |
| `import_rows` | id, import_id, line, raw (JSON), company_id, status, error |
| `companies` | id, user_id, name, normalized_name, legal_name, domain, website_url, careers_url, siren, city, country, industry, employee_range, linkedin_url, phone, contact_form_url, crawl_status, domain_confidence, tags, notes, attributes (JSON), last_enriched_at, created_at |
| `emails` | id, company_id, user_id, address, normalized_address, local_part, type, origin (`found`, `provider`, `deduced`, `imported`), status, score, excluded, excluded_reason, last_verified_at, created_at |
| `email_sources` | id, email_id, kind (`website`, `provider`, `import`, `deduction`), url, provider, extraction_method, context_excerpt, discovered_at |
| `verifications` | id, email_id, level, status, sub_status, reason, provider, raw_reference, verified_at |
| `pipeline_jobs` | id, import_id, company_id, step, status, attempts, error, started_at, completed_at |
| `provider_calls` | id, user_id, import_id, provider, operation, domain, credits, cached, status, created_at |
| `provider_cache` | provider, operation, key, response (JSON chiffré), expires_at |
| `page_cache` | url, status_code, content_hash, fetched_at, expires_at |
| `exports` | id, user_id, format, filters (JSON), row_count, storage_key, status, expires_at, created_at |
| `api_keys` | id, user_id, name, prefix, key_hash, scopes, last_used_at, revoked_at, created_at |
| `webhooks` | id, user_id, url, events, secret (chiffré), active, created_at |
| `webhook_deliveries` | id, webhook_id, event, payload_hash, status_code, attempts, next_attempt_at, delivered_at |
| `integrations` | id, user_id, kind (`campaign_mailer`), base_url, token (chiffré), status, last_sync_at |
| `sync_runs` | id, integration_id, campaign_ref, sent, refused, duplicates, idempotency_key, created_at |
| `suppressions` | id, user_id, address_hash, reason, source, created_at |
| `excluded_domains` | domain, reason, requested_at |
| `audit_events` | id, user_id, action, entity, entity_id, metadata (JSON, sans adresse en clair), created_at |

Contraintes essentielles : une adresse unique par entreprise (`company_id`, `normalized_address`) ; une entreprise unique par utilisateur et par domaine ; les statuts sont des types énumérés vérifiés par la base ; chaque migration a son retour arrière.

---

## 10. Sécurité

| Id | Exigence |
| --- | --- |
| S-01 | Secrets (clés des fournisseurs, jetons Campaign Mailer, secrets de webhooks, clés d'API personnelles) chiffrés au repos en AES-256-GCM, avec rotation de clé documentée. |
| S-02 | Clés d'API de MailFind stockées hachées ; seul un préfixe est affiché pour les reconnaître. |
| S-03 | Aucun secret, aucune adresse et aucun jeton dans les journaux, les messages d'erreur ou les rapports Sentry. |
| S-04 | Toute route vérifie que la ressource appartient à l'utilisateur, dans la requête SQL elle-même : une ressource d'un autre compte répond 404. |
| S-05 | Protection contre la falsification de requête côté serveur dans le moteur de collecte : seules les adresses publiques sont visitées ; adresses IP privées, locales, de lien local et de métadonnées de fournisseurs cloud refusées, y compris après résolution DNS et après redirection. |
| S-06 | Le contenu des pages explorées n'est jamais rendu tel quel dans l'interface. Les extraits de contexte sont échappés. |
| S-07 | Les valeurs des fichiers CSV sont traitées comme hostiles : échappées à l'affichage, et neutralisées à l'export contre l'injection de formules tableur (cellules commençant par `=`, `+`, `-`, `@`). |
| S-08 | Limitation de débit sur l'authentification, l'API publique et les imports. |
| S-09 | En-têtes de sécurité HTTP, cookies `httpOnly`, `secure` et `sameSite=lax`, protection CSRF sur les formulaires de l'interface. |
| S-10 | Webhooks sortants signés ; les URL de webhook sont soumises à la même protection que S-05. |
| S-11 | Revue de sécurité du code avant chaque mise en production, et analyse des dépendances. |

---

## 11. Conformité juridique et protection des données

Cette section fixe des règles de conception. Elle ne remplace pas l'avis d'un juriste, à solliciter avant l'ouverture au public.

### 11.1 Nature des données

Une adresse de rôle d'une personne morale (`contact@`, `recrutement@`) n'identifie en principe personne. Une adresse nominative (`prenom.nom@`) est une donnée personnelle au sens du RGPD, même quand elle est professionnelle et publiée. MailFind privilégie donc les adresses de rôle et traite les adresses nominatives avec des règles plus strictes.

### 11.2 Rôles

- Pour les données des comptes utilisateurs, MailFind est responsable de traitement.
- Pour les adresses collectées à la demande d'un utilisateur, l'utilisateur détermine la finalité (candidature, prospection) : il est responsable de traitement et MailFind agit en sous-traitant, selon des conditions d'utilisation qui le précisent (article 28 du RGPD).

### 11.3 Règles appliquées par le produit

| Id | Règle |
| --- | --- |
| R-01 | Minimisation : seules l'adresse, sa source et les données de l'entreprise sont collectées. Aucun profil de personne, aucune donnée de réseau social. |
| R-02 | Provenance : la source de chaque donnée est conservée et exportée, pour permettre d'informer la personne concernée de l'origine de ses données. |
| R-03 | Information des personnes : quand un utilisateur contacte une personne dont l'adresse nominative a été collectée, il doit l'informer au plus tard lors de la première communication (article 14 du RGPD). MailFind le rappelle à l'export d'adresses nominatives et fournit une mention type. |
| R-04 | Opposition : liste de suppression par utilisateur, respectée par toutes les fonctions et transmise à Campaign Mailer. Une adresse supprimée n'est plus jamais collectée pour cet utilisateur. |
| R-05 | Effacement : suppression définitive d'une adresse, d'une entreprise, d'un import ou d'un compte, sources et vérifications comprises. |
| R-06 | Conservation : adresses et sources non consultées ni exportées depuis 12 mois supprimées automatiquement ; journaux techniques 90 jours ; journal d'audit 12 mois. |
| R-07 | Retrait des sites : une page publique explique ce que fait l'agent de collecte et permet à un site de demander son exclusion, appliquée à tous les utilisateurs. |
| R-08 | Respect des sites : `robots.txt`, débit limité, aucune authentification, aucun contournement de protection (F-403 à F-407). |
| R-09 | Respect des fournisseurs : utilisation des API officielles dans le cadre de leurs conditions, sans revente des résultats bruts. |
| R-10 | Prospection : rappel dans l'interface des règles de la CNIL sur la prospection électronique entre professionnels (message en rapport avec la fonction du destinataire, information et possibilité de s'opposer à chaque envoi). |
| R-11 | Registre des traitements tenu à jour, liste des sous-traitants (hébergeurs, fournisseurs d'enrichissement) publiée dans la politique de confidentialité. |
| R-12 | Analyse d'impact relative à la protection des données menée avant l'ouverture au public, compte tenu de la collecte à grande échelle de données publiques. |

---

## 12. Exploitation et observabilité

| Élément | Exigence |
| --- | --- |
| Journaux | JSON structurés, identifiant de requête et identifiant de tâche sur chaque ligne, adresses et jetons exclus. |
| Erreurs | Sentry sur l'API, les processus de traitement et l'interface, données personnelles retirées avant l'envoi. |
| Santé | `/health` (le processus répond) et `/ready` (base, Redis, files, fournisseurs principaux). |
| Alertes | Taux d'échec d'un fournisseur au-dessus de 20 % sur une heure, file bloquée depuis 15 minutes, plafond de dépense atteint à 80 % puis 100 %, processus de traitement silencieux depuis 15 minutes. |
| Sauvegardes | Sauvegarde quotidienne de la base, restauration testée avant la mise en production et consignée. |
| Documentation | Architecture, procédures d'incident, règles de collecte et de vérification, guide de l'API, guide de prise en main. |

---

## 13. Tests et recette

### 13.1 Stratégie

- Tests unitaires sur les règles pures : normalisation, extraction des adresses, classification, score, génération des candidates, statuts de vérification.
- Tests d'intégration contre une base PostgreSQL de test, dans un schéma jetable par exécution.
- Tests du moteur de collecte contre un jeu de sites de test servis localement (pages contact, mentions légales, adresses masquées, `robots.txt` restrictif, redirections, pages lourdes).
- Fournisseurs simulés en test, avec leurs réponses documentées, y compris les erreurs de quota.
- Tests de contrat de l'API contre le document OpenAPI, et tests de contrat partagés avec Campaign Mailer.
- Parcours complet de bout en bout dans un navigateur : connexion, import, suivi, export, envoi vers Campaign Mailer.

### 13.2 Critères d'acceptation du MVP

| N° | Critère |
| --- | --- |
| A1 | Un CSV de 100 entreprises réelles (noms seuls, domaines seuls, URL mélangés) est traité de bout en bout sans intervention, en moins de 15 minutes. |
| A2 | Le taux de couverture de l'indicateur 2.2 est atteint sur ce jeu. |
| A3 | Aucune adresse `unverified`, `unknown`, `invalid`, `disposable` ou `suppressed` n'apparaît dans un export « prêt à l'envoi » ni dans un envoi vers Campaign Mailer. |
| A4 | Chaque adresse exportée a au moins une source avec URL ou fournisseur. |
| A5 | Un import interrompu par un redémarrage reprend et se termine, sans doublon d'entreprise ni double consommation de crédit. |
| A6 | Un site dont le `robots.txt` interdit l'agent n'est pas visité. |
| A7 | L'envoi vers Campaign Mailer crée un brouillon importable et lançable, relancé deux fois sans créer de doublon. |
| A8 | L'API répond conformément au document OpenAPI sur tous les points d'accès. |
| A9 | Une demande d'effacement supprime l'adresse, ses sources et ses vérifications, et l'adresse n'est plus collectée ensuite. |
| A10 | La revue de sécurité ne laisse aucune anomalie critique ou haute ouverte. |

---

## 14. Planning et jalons

Le découpage détaillé, tâche par tâche, est dans `ROADMAP.md`. Les jalons :

| Jalon | Contenu | Durée cible |
| --- | --- | --- |
| J0 | Fondations et décisions gelées | 3 jours |
| J1 | Comptes, socle et import CSV | 8 jours |
| J2 | Identification et collecte sur les sites | 8 jours |
| J3 | Fournisseurs, adresses candidates et vérification | 8 jours |
| J4 | Bibliothèque et exports | 6 jours |
| J5 | API publique et intégration Campaign Mailer | 7 jours |
| J6 | Sécurité, conformité, quotas, tests et documentation | 8 jours |
| J7 | Mise en production et bêta | 4 jours |

Total du MVP : environ 52 jours ouvrés pour une personne.

---

## 15. Risques

| Risque | Probabilité | Impact | Parade |
| --- | --- | --- | --- |
| Faible couverture sur les sites qui ne publient aucune adresse | élevée | moyen | Repli sur les fournisseurs et les adresses candidates vérifiées, canaux alternatifs (formulaire, page carrières) présentés. |
| Coût des fournisseurs supérieur aux prévisions | moyenne | élevé | Cache de 30 jours, estimation avant lancement, plafonds par utilisateur et global. |
| Blocage de l'agent de collecte par des sites | moyenne | moyen | Débit bas, agent identifié, respect de `robots.txt`, aucune tentative de contournement. |
| Plainte d'une personne ou d'un site | faible | élevé | Provenance conservée, retrait des sites, liste de suppression, effacement immédiat, analyse d'impact. |
| Adresses `accept_all` présentées comme fiables | moyenne | moyen | Statut distinct, exclusion par défaut des envois « prêts », score plafonné. |
| Dérive du périmètre vers les fonctions post-MVP | élevée | élevé | Aucune tâche du bloc post-MVP avant la validation de la mise en production. |
| Changement des conditions ou de l'API d'un fournisseur | moyenne | moyen | Adaptateurs indépendants, second fournisseur prêt à activer. |
| Dépassement des quotas Redis | élevée | faible | Décision de la Phase 0 (8.2), budget plafonné. |

---

## 16. Glossaire

| Terme | Définition |
| --- | --- |
| Adresse de rôle | Adresse attachée à une fonction plutôt qu'à une personne : contact@, recrutement@. |
| Adresse candidate, déduite | Adresse générée par MailFind comme probable, jamais trouvée publiée. |
| Accept-all | Domaine dont le serveur accepte toute adresse, ce qui empêche de confirmer une boîte précise. |
| Collecte | Exploration des pages publiques d'un site pour y relever des adresses. |
| Enrichissement | Complément d'information obtenu auprès d'un fournisseur par API. |
| Enregistrement MX | Entrée DNS qui désigne les serveurs de messagerie d'un domaine. |
| Profondeur | Nombre et nature des pages explorées par entreprise. |
| Rebond | Message refusé par le serveur du destinataire. |
| Source | Preuve de l'origine d'une adresse : URL de page, fournisseur, import ou déduction. |
| Suppression | Adresse qu'un utilisateur ne veut plus jamais collecter ni transmettre. |

---

## 17. Annexes

### Annexe A : exemple de fichier d'import

```csv
entreprise,site,carrieres,ville,etiquettes
Doctolib,doctolib.fr,,Paris,alternance;sante
Entreprise Exemple,https://www.entreprise-exemple.fr,https://www.entreprise-exemple.fr/carrieres,Lyon,alternance
Startup Sans Site,,,Nantes,
,agence-web-exemple.fr,,Bordeaux,prospection
```

La troisième ligne sera identifiée par l'API Recherche d'entreprises, puis son site recherché. La quatrième, sans nom, prendra le nom trouvé sur le site.

### Annexe B : structure de l'export « une ligne par adresse »

```text
company_id, company_name, domain, website_url, careers_url, siren, city, country,
industry, company_tags, email, email_type, origin, verification_status,
verification_reason, verified_at, score, source_kind, source_url, provider,
discovered_at, email_tags, notes
```

### Annexe C : réponse de `POST /v1/find`

```json
{
  "company": {
    "id": "cmp_01J9Z3",
    "name": "Entreprise Exemple",
    "domain": "entreprise-exemple.fr",
    "careers_url": "https://www.entreprise-exemple.fr/carrieres"
  },
  "emails": [
    {
      "address": "recrutement@entreprise-exemple.fr",
      "type": "recruitment",
      "origin": "found",
      "status": "valid",
      "score": 90,
      "verified_at": "2026-09-22T09:14:03Z",
      "sources": [
        {
          "kind": "website",
          "url": "https://www.entreprise-exemple.fr/carrieres",
          "discovered_at": "2026-09-22T09:13:41Z"
        }
      ]
    },
    {
      "address": "rh@entreprise-exemple.fr",
      "type": "hr",
      "origin": "deduced",
      "status": "accept_all",
      "score": 35,
      "verified_at": "2026-09-22T09:14:05Z",
      "sources": [{ "kind": "deduction", "discovered_at": "2026-09-22T09:14:02Z" }]
    }
  ],
  "alternatives": {
    "contact_form_url": "https://www.entreprise-exemple.fr/contact"
  },
  "cached": false
}
```

### Annexe D : préfixes de rôle utilisés pour les adresses candidates

| Type | Préfixes, par ordre d'essai |
| --- | --- |
| `recruitment` | recrutement, jobs, careers, carrieres, rh.recrutement, talent, candidature, emploi, alternance, stage |
| `hr` | rh, hr, drh, people |
| `generic` | contact, hello, bonjour, info |
| `sales` | commercial, sales, business |
| `press` | presse, press, communication |
