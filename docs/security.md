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

## Secret de connexion croisée avec Campaign Mailer (D-26)

`CAMPAIGN_MAILER_SSO_SECRET` ici et `MAILFIND_SSO_SECRET` chez Campaign Mailer portent la même valeur. Pour le changer : générer une valeur de 32 caractères au moins, la poser des deux côtés, redéployer les deux applications. Entre les deux déploiements, la connexion croisée échoue proprement, avec un message ; rien d'autre n'est touché.
