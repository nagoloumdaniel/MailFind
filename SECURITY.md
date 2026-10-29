# Politique de sécurité

MailFind est en **bêta fermée**. Son code est visible, mais le logiciel reste propriétaire (tous droits réservés, voir [LICENSE](LICENSE)).

## Signaler une vulnérabilité

Écrivez à **nagoloumtalladanielparfait@gmail.com** (l'adresse publique du profil GitHub de l'auteur) avec pour objet « MailFind : vulnérabilité ». Merci de ne **pas** ouvrir de ticket public, ni de pull request, pour un défaut de sécurité.

Pour aider à le reproduire, indiquez si possible :

- ce qui est touché (l'application web, l'API `/v1`, le processus de traitement, un document) ;
- les étapes, ou une requête minimale qui montre le problème ;
- l'effet que vous constatez : quelles données, quelle action, pour quel compte.

Vous recevrez un accusé de réception. MailFind est un projet mené par une seule personne : il n'y a ni astreinte ni délai garanti de correction, et aucune prime n'est prévue.

## Périmètre

Dans le périmètre : le code de ce dépôt et l'application déployée sur <https://mailfind.vercel.app>.

Hors périmètre, et à ne pas tenter :

- les services tiers (Vercel, Railway, Neon, Redis Cloud, Cloudflare, Google, Hunter, Brave) : signalez-les à leur éditeur ;
- le déni de service, la force brute, les tests de charge ;
- l'ingénierie sociale, ou l'accès physique ;
- l'accès aux données d'autres utilisateurs au-delà de ce qu'il faut pour démontrer la faille : arrêtez-vous dès la preuve obtenue.

N'essayez rien sur un compte qui n'est pas le vôtre.

## Ce qui est déjà en place

Le détail, et la façon de faire tourner une clé, sont dans [docs/security.md](docs/security.md). En bref : secrets chiffrés au repos (AES-256-GCM), clés d'API et listes d'adresses interdites hachées (SHA-256), garde contre les requêtes vers des adresses privées (SSRF) sur le robot et les webhooks, webhooks signés, limitation de débit par clé, journaux nettoyés des données identifiantes.

Ces mesures n'ont fait l'objet d'aucun audit externe. Les documents de conformité de [docs/legal/](docs/legal/) n'ont pas été relus par un juriste.

## Versions prises en charge

Seule la dernière version de la branche `main` est suivie.
