# Sécurité : procédures d'exploitation

Ce document décrit les gestes d'exploitation liés à la sécurité. Les règles elles-mêmes sont dans le cahier des charges (section 9) et dans `docs/decisions.md`.

## Ce qui est chiffré au repos (S-01)

AES-256-GCM, avec un vecteur d'initialisation neuf par valeur. Chaque valeur chiffrée porte l'identifiant de sa clé : `v1.<clé>.<iv>.<étiquette>.<contenu>`.

| Donnée | Où | Pourquoi chiffrée plutôt que hachée |
| --- | --- | --- |
| Secret de signature d'un webhook | `webhooks.secret_encrypted` | Il doit être relu pour signer chaque envoi. |
| Jeton d'intégration Campaign Mailer | `campaign_mailer_connections.token_encrypted` | Il doit être relu pour appeler l'API de Campaign Mailer. |
| Réponses des fournisseurs d'enrichissement | `provider_cache.response`, champ `chiffre` | Elles contiennent des adresses nominatives (F-604). |

Ce qui n'a pas à être relu est seulement haché (SHA-256) : clés d'API, codes de connexion croisée, adresses de la liste d'exclusion.

Le test `security/rotate.integration.test.ts` échoue si une colonne `*_encrypted` du schéma manque à la rotation.

## Faire tourner la clé de chiffrement

À faire au moins une fois par an, et tout de suite si la clé a pu être lue par quelqu'un qui ne devait pas la voir.

1. Générer une nouvelle clé :

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Sur Railway, pour l'API **et** le processus de traitement : copier la valeur actuelle de `ENCRYPTION_KEY` dans `ENCRYPTION_KEY_PREVIOUS`, puis mettre la nouvelle clé dans `ENCRYPTION_KEY`. Redéployer les deux. À partir de là, la nouvelle clé chiffre et l'ancienne déchiffre encore.
3. Réécrire les valeurs avec la nouvelle clé, depuis un poste qui a les deux clés dans `backend/.env` :

   ```bash
   npm run rotate:encryption
   ```

   Le script indique ce qu'il a réécrit. Une entrée de cache illisible est supprimée : on repaiera l'appel plutôt que de servir une réponse qu'on ne peut plus relire. Un secret illisible est laissé en place, et le script sort en erreur.
4. Quand le script annonce que tout est chiffré avec la clé courante, vider `ENCRYPTION_KEY_PREVIOUS` sur Railway et redéployer.

Ne jamais vider `ENCRYPTION_KEY_PREVIOUS` tant que le script sort en erreur : les secrets concernés seraient perdus, et chaque utilisateur touché devrait recréer son webhook ou recoller son jeton Campaign Mailer.

## Revue de sécurité du 2 octobre 2026 (S-11)

Portée : l'ensemble du dépôt, avec une attention particulière aux lots de la Phase 8, qui ajoutent des écritures en base et une route publique.

### Dépendances

`npm audit` ne signale **aucune vulnérabilité**, avec et sans les dépendances de développement. À relancer avant chaque mise en production ; la CI le fera en Phase 9.

### Ce qui a été examiné, et ce qui tient

| Surface | Constat |
| --- | --- |
| Injection SQL | Toutes les requêtes sont paramétrées. Les seules interpolations de chaîne portent sur des constantes du module (taille de paquet, noms de tables de la liste de rotation), jamais sur une entrée. |
| Authentification | Pas de mot de passe. Session régénérée à la connexion, cookie `httpOnly` `secure` `sameSite=lax`, jeton anti-CSRF en double soumission. La connexion croisée lie le retour au navigateur par un jeton d'état comparé en temps constant. |
| Autorisation | Chaque requête de la bibliothèque est filtrée par `user_id`. La reprise d'un import vérifie l'appartenance avant d'agir. Les clés d'API portent des portées, et sont hachées. |
| Falsification de requête côté serveur | Le robot et les webhooks passent par la garde des adresses, après résolution DNS et après chaque redirection. Les appels vers Campaign Mailer et MailFind utilisent une URL de configuration, jamais une URL reçue, et ne suivent aucune redirection. |
| Secrets dans les journaux | Masquage par motif, pas par nom de champ, sur le message, les champs, les erreurs et l'URL. Vérifié en production : `set-cookie` ressort `[coupe]`. |
| Chiffrement | AES-256-GCM, identifiant de clé porté par chaque valeur, rotation outillée et testée. |

### Deux défauts trouvés, et corrigés dans le même lot

**1. La liste des sites exclus était publique.** `GET /api/bot/exclusions` rendait, sans session, le nom des domaines ayant demandé à ne plus être explorés et le motif écrit par le demandeur. Ce n'est pas une donnée publique : elle dit qui s'est plaint, et de quoi. Déplacée derrière la session, sur `/api/exclusions`. La page publique n'en avait pas besoin.

**2. La demande d'exclusion n'avait aucun garde-fou.** La route est volontairement sans compte, puisqu'un webmestre qui veut nous arrêter n'en a pas. Mais rien n'empêchait une seule machine d'exclure des milliers de domaines et de vider le produit de sa substance pour tous les comptes. Un compteur par adresse, dix demandes par minute, a été ajouté. Il ne remplace pas une preuve de propriété du domaine, qui reste hors de portée : l'effet immédiat d'une demande est un choix assumé, et l'exploitant peut refuser une demande infondée.

### Risque accepté, documenté

Une demande d'exclusion prend effet avant toute revue humaine. C'est délibéré : respecter un refus ne doit pas attendre. Le rapport de force est en faveur du site, et c'est le bon sens pour un robot.

## Chercher un secret dans l'historique git (Phase 10)

Un secret retiré par un commit reste dans l'historique, et l'historique devient public le jour où le dépôt le devient.

```text
npm run scan:secrets
```

Le script relit **chaque version de chaque fichier** déjà versionné, pas seulement l'arbre de travail, et connaît quatorze formes : clés MailFind, jetons Campaign Mailer, secrets de webhook, jetons Google, clés AWS et R2, identifiants Google, DSN Sentry, chaînes PostgreSQL et Redis avec mot de passe, clés de chiffrement.

Au 2 octobre 2026, sur 143 commits : **aucune trouvaille**. Les valeurs des modèles, des tests et de la documentation sont écartées, et chaque exclusion est écrite dans le script, pas devinée.

**Un secret publié se révoque et se remplace.** Le retirer de l'historique ne suffit pas : il faut partir du principe qu'il a été lu.

## Secret de connexion croisée avec Campaign Mailer (D-26)

`CAMPAIGN_MAILER_SSO_SECRET` ici et `MAILFIND_SSO_SECRET` chez Campaign Mailer portent la même valeur. Pour le changer : générer une valeur de 32 caractères au moins, la poser des deux côtés, redéployer les deux applications. Entre les deux déploiements, la connexion croisée échoue proprement, avec un message ; rien d'autre n'est touché.
