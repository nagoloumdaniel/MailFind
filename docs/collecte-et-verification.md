# Règles de collecte et de vérification

Ce que MailFind s'autorise à lire, ce qu'il en conclut, et ce qu'il refuse de promettre. Pour comprendre un résultat sans lire le code.

- **Version** : 2 octobre 2026

## Ce que le robot lit

Les pages publiques du site officiel de l'entreprise, et rien d'autre.

| Règle | Détail |
| --- | --- |
| `robots.txt` | Respecté, y compris le `Crawl-delay`. Une page interdite n'est jamais demandée |
| Rythme | Une requête par seconde et par domaine, une seule à la fois |
| Agent | `MailFindBot/0.1 (+https://mailfind.app/bot)`. Jamais déguisé en navigateur |
| Pages | L'accueil, puis contact, carrières, mentions légales, équipe. 3, 10 ou 25 selon la profondeur |
| Taille | 3 Mo par page au plus. Au-delà, la page est abandonnée |
| Redirections | Deux au plus hors du domaine |
| Connexion | Aucune. Aucun formulaire rempli, aucun espace protégé |

**Ce qu'il ne fait jamais** : décoder une adresse volontairement masquée (image, JavaScript, `at` écrit en toutes lettres), contourner un CAPTCHA ou une limitation de débit, lire une page rendue uniquement par JavaScript.

Une entreprise peut repartir sans aucune adresse, et la raison est enregistrée : `robots_disallowed`, `no_website`, `unreachable`, `dynamic_content`, `masked_address`, `contact_form`, `site_excluded`.

## D'où vient une adresse

Quatre origines, et chacune laisse sa trace. **Une adresse sans source n'est pas enregistrée** : la base le refuse.

| Origine | Ce que la source dit |
| --- | --- |
| `found` | L'URL exacte de la page, la méthode (lien `mailto`, texte de la page) et la date |
| `provider` | Le nom du fournisseur et la date |
| `deduced` | Une adresse de rôle probable, sur un domaine dont on a vérifié qu'il reçoit du courrier |
| `manual` | Saisie par l'utilisateur |

Une adresse nominative n'est **déduite** que si l'utilisateur a fourni le nom de la personne **et** qu'un fournisseur a observé le format de l'entreprise. MailFind n'invente pas `prenom.nom@`.

## Les sept niveaux de vérification

Du moins coûteux au plus coûteux, et on s'arrête dès qu'un niveau conclut.

1. **Syntaxe** : l'adresse est-elle une adresse ?
2. **Domaine** : existe-t-il ?
3. **Serveur de messagerie** : le domaine a-t-il un MX ?
4. **Domaine jetable** : figure-t-il sur la liste publique, rechargée chaque semaine ?
5. **Messagerie grand public** : gmail, outlook... Ce n'est pas une adresse d'entreprise confirmée
6. **Adresse de rôle** : `contact@`, `recrutement@`. Elle n'identifie personne
7. **Liste de suppression** : l'utilisateur, ou la personne elle-même, l'a fait retirer

Le huitième niveau, **la vérification de boîte**, passe par un fournisseur, et seulement si l'import le demande. **Aucun sondage SMTP ne part de nos serveurs** : Railway bloque le port 25 en sortie, et sonder depuis l'IP de l'application la ferait entrer dans les listes de blocage.

## Les statuts, et ce qu'ils ne disent pas

| Statut | Ce que ça veut dire |
| --- | --- |
| `valid` | La boîte existe, confirmée par le fournisseur |
| `accept_all` | Le serveur accepte tout : **impossible de conclure** |
| `risky` | Quelque chose cloche, sans certitude |
| `unknown` | La vérification n'a pas abouti |
| `invalid` | L'adresse ne peut pas recevoir |
| `disposable` | Domaine jetable |
| `suppressed` | Retirée à la demande |
| `unverified` | Pas encore vérifiée |

**`accept_all`, `unknown` et `unverified` ne sont jamais présentés ni exportés comme vérifiés.** C'est la règle qui coûte le plus en apparence de résultats, et c'est celle qui fait que les résultats veulent dire quelque chose.

## Le score

Un nombre de 0 à 100, dont le détail s'affiche critère par critère : chaque ligne porte ce qu'elle ajoute ou retire, et **les lignes additionnées font le score**. Il n'y a pas de pondération cachée.

Le score n'écarte personne tout seul. Il ordonne une liste, il ne décide pas.

## Ce qui empêche une collecte

| Mécanisme | Portée | Qui le déclenche |
| --- | --- | --- |
| Liste de suppression | Un compte | L'utilisateur |
| Effacement d'une adresse | Tous les comptes | La personne concernée, depuis `/robot` |
| Exclusion d'un site | Tous les comptes | Le site, depuis `/robot` |
| `robots.txt` | Le site | Le site |

Les trois premiers sont vérifiés à la collecte, à l'enrichissement et à la vérification : une adresse interdite ne peut pas rentrer par une autre porte.

## Ce que l'utilisateur doit faire de son côté

La prospection entre professionnels est permise, sous conditions : un message en rapport avec la fonction du destinataire, la possibilité de s'y opposer, et l'information de la personne au plus tard au premier message quand l'adresse a été collectée sans qu'elle la donne.

MailFind fournit la source et la date de chaque adresse, et une [mention type](legal/mention-information.md) à reprendre. Il n'envoie rien : l'obligation d'informer reste celle de l'expéditeur.
