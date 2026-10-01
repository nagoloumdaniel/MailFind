# Liste des sous-traitants

Qui traite des données pour le compte de MailFind, pour quoi faire, et où. Exigée par R-11, et référencée par la politique de confidentialité.

- **Version** : 2 octobre 2026
- **Responsable du traitement** : Daniel Nagoloum Talla

Toute entrée de cette liste reçoit des données parce que le service ne peut pas fonctionner sans. Aucune n'est utilisée à des fins publicitaires, et aucune donnée n'est vendue.

## Hébergement et infrastructure

| Sous-traitant | Ce qu'il traite | Où | Pourquoi |
| --- | --- | --- | --- |
| Vercel | Les requêtes de l'application web, et leurs journaux d'accès | États-Unis (US East) | Sert l'application et relaie `/api` vers l'API |
| Railway | L'API, le processus de traitement, et leurs journaux | États-Unis (US East) | Exécute le code du serveur |
| Neon | Toute la base : comptes, entreprises, adresses, sources, journal d'audit | États-Unis (`aws-us-east-1`) | La base de données |
| Redis Cloud | Les sessions, et les files de traitement | États-Unis (`us-east-1`) | Garde la session connectée et les tâches en attente |
| Cloudflare R2 | Les exports de plus de 2 000 lignes, sept jours | ENAM (Amérique du Nord) | Stocke un fichier trop gros pour une réponse HTTP |

Ces cinq sont aux États-Unis. Le transfert repose sur les clauses contractuelles types de la Commission européenne, que chacun de ces fournisseurs intègre à ses conditions.

## Services appelés pendant le traitement

| Sous-traitant | Ce qu'il traite | Où | Pourquoi |
| --- | --- | --- | --- |
| Google (connexion) | Votre identifiant, votre adresse, votre nom | États-Unis | La connexion au compte. Aucune portée Gmail n'est demandée, jamais |
| Hunter | Un nom de domaine d'entreprise, et une adresse à vérifier | États-Unis | Trouve les adresses que le site n'a pas publiées, et vérifie une boîte |
| Brave Search | Le nom d'une entreprise | États-Unis | Retrouve le site officiel quand le fichier importé ne le donne pas |
| Recherche d'entreprises (API Gouv) | Le nom d'une entreprise | France | Identité légale et siren. Service public, gratuit, sans clé |
| Sentry | Les erreurs du serveur, sans adresse ni jeton | États-Unis | Comprendre une panne. Les messages sont masqués avant envoi |

Hunter et Brave ne reçoivent jamais la liste de vos entreprises : ils sont appelés entreprise par entreprise, seulement quand le site n'a pas suffi, et leurs réponses sont mises en cache chiffré trente jours pour ne pas les réinterroger.

## Ce qui n'est pas un sous-traitant

**Campaign Mailer** n'est pas un sous-traitant de MailFind : c'est une autre application, du même éditeur, vers laquelle *vous* envoyez une sélection. L'envoi se fait à votre demande, avec un jeton que vous créez, et la campagne y reste un brouillon jusqu'à ce que vous la lanciez. Campaign Mailer a sa propre politique de confidentialité.

## Changer cette liste

Un sous-traitant ajouté ou retiré fait l'objet d'une mise à jour de ce document et de la version de la politique de confidentialité. Les utilisateurs ont alors à accepter la nouvelle version.
