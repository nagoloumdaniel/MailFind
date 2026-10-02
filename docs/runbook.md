# Procédures d'incident

Quoi faire quand quelque chose ne va pas. Chaque section part d'un symptôme observable, pas d'une cause supposée.

- **Version** : 2 octobre 2026

## D'abord, trois commandes

```text
curl https://mailfind.vercel.app/api/auth/me      # l'API répond
curl https://api-production-9769.up.railway.app/ready   # les dépendances répondent
railway logs --service api        # ce que l'API a vu
railway logs --service worker     # ce que le traitement a vu
```

`/ready` est la première chose à lire : il dit si la base, Redis et les files répondent, la profondeur de chaque file, et depuis quand le processus de traitement n'a pas donné signe de vie.

---

## Les imports restent en attente

**Symptôme** : un import affiche « En attente » ou « En cours » sans avancer, et les compteurs ne bougent pas.

**Cause la plus fréquente** : le processus de traitement est arrêté. L'API répond normalement, donc rien d'autre ne le signale.

1. `GET /ready` : le champ `worker` est-il `degraded` ? `workerSeenAt` est-il `null` ?
2. Si oui : `railway service redeploy --service worker`.
3. Les tâches ne sont pas perdues : elles attendent dans Redis, et le processus les reprend à son démarrage. Il remet aussi en file les étapes qu'aucune tâche ne garantissait plus.

**Si le processus tourne** : regarder la profondeur des files dans `/ready`. Une file qui monte avec `active: 0` veut dire que les tâches échouent et sont rejouées ; `railway logs --service worker` dira pourquoi.

## Un import s'est arrêté en route

**Symptôme** : statut « En attente de quota ».

Ce n'est pas une panne. Un plafond mensuel du compte est atteint, et les entreprises restantes attendent. Trois sorties :

- ne rien faire : l'entretien quotidien les reprend dès que le compteur le permet ;
- l'utilisateur relance depuis la page de l'import, ce qui ne marche que si la place est revenue ;
- relever le plafond : les variables `QUOTA_*` sur les deux services Railway, puis redéployer.

## Un fournisseur échoue

**Symptôme** : alerte `provider_failing`, ou beaucoup d'entreprises avec « fournisseur indisponible ».

Le pipeline continue sans le fournisseur : c'est voulu, une panne chez Hunter ne doit pas arrêter la collecte. Vérifier la page d'état du fournisseur, puis la clé.

**Rien ne presse** : les appels échoués ne sont pas facturés et ne pèsent pas sur le budget.

## Le plafond de dépense est atteint

**Symptôme** : alerte `spend_near_budget`, puis les appels payants sont refusés pour tout le monde.

C'est le garde-fou qui fonctionne. Pour le lever, il faut une décision, pas une manipulation : relever `PROVIDER_MONTHLY_BUDGET_EUR` revient à accepter la dépense. Le compteur repart seul le 1er du mois.

## Un site se plaint du robot

1. L'exclure tout de suite : la page `/robot` le fait en un champ, et prend effet immédiatement, pour tous les comptes.
2. Vérifier ce qui s'est passé : `railway logs --service worker` et les `crawl_notes` de l'entreprise.
3. Si le robot a mal fait son travail (robots.txt ignoré, rythme dépassé), c'est un défaut à corriger, pas un incident à classer.

L'exclusion couvre les sous-domaines. Elle peut être refusée ensuite si la demande était infondée : passer `status` à `rejected` dans `excluded_domains`.

## Une personne demande l'effacement de son adresse

La page `/robot` le fait, sans compte et sans question. L'adresse part de tous les comptes et ne pourra plus être collectée. Seule une empreinte est gardée, ce qui est précisément ce qui permet de tenir la promesse.

Si la demande arrive par un autre canal, la même page suffit : rien à faire en base.

## Erreurs 500

1. Récupérer l'identifiant de requête : il est dans la réponse (`requestId`) et dans l'en-tête `x-request-id`.
2. `railway logs --service api`, chercher cet identifiant.
3. Les journaux sont masqués : ni adresse, ni jeton, ni secret. Si le message ne suffit pas, c'est le code qu'il faut regarder, pas les journaux qu'il faut ouvrir.

## La base est lente ou injoignable

`/ready` répond 503 avec `database: failed`.

1. État de Neon : console Neon, projet `mailfind`.
2. Un réveil à froid peut dépasser le délai des sondes. Si c'est cela, l'incident se résout seul en quelques secondes.
3. Les deux chaînes ne sont pas interchangeables : `DATABASE_URL` est l'hôte groupé, `DIRECT_DATABASE_URL` l'hôte direct, qui seul sait tenir une migration.

## Restaurer la base

Deux filets, et ils ne couvrent pas la même chose.

**L'historique de Neon**, pour une fausse manœuvre qu'on voit tout de suite. Depuis la console, créer une branche à un instant passé, vérifier, puis basculer. **Six heures seulement** sur le palier gratuit : passé ce délai, il ne reste rien.

**La sauvegarde quotidienne**, pour tout le reste. Le processus de traitement dépose chaque jour dans R2, sous `backups/AAAA-MM-JJ.ndjson.gz`, et garde trente jours. Restaurer :

```text
npm run restore:backup -- backups/2026-10-02.ndjson.gz          # sur une base de test
npm run restore:backup -- backups/2026-10-02.ndjson.gz --oui    # sur la production
```

**La restauration efface la base visée avant de charger.** Une restauration partielle mélangerait deux états, ce qui est pire que les deux. La commande refuse donc de s'exécuter sur une base dont le nom ne contient pas « test », sauf `--oui`.

**Testée, et pas seulement écrite.** `backend/src/backup/backup.integration.test.ts` sauvegarde une bibliothèque, efface tout, restaure, et vérifie que les adresses sont revenues avec leurs sources. Un autre test échoue si une table apparaît dans le schéma sans être ni sauvegardée ni écartée en connaissance de cause.

### Avant de restaurer en production

1. Prévenir : la restauration écrase le travail fait depuis la sauvegarde.
2. Arrêter le processus de traitement, pour qu'aucune tâche n'écrive pendant le chargement.
3. Restaurer, puis `GET /ready` et un coup d'œil à la page Contacts.
4. Redémarrer le processus de traitement.

## Faire tourner une clé de chiffrement

Procédure complète dans [`security.md`](security.md). En résumé : poser la nouvelle clé, garder l'ancienne dans `ENCRYPTION_KEY_PREVIOUS`, lancer `npm run rotate:encryption`, puis retirer l'ancienne **seulement** quand le script ne signale plus aucun secret illisible.

## Déployer, et revenir en arrière

- Un `git push` sur `main` déploie les deux côtés. Le hook de pre-push lance la CI locale avant.
- Revenir en arrière : `railway deployment list --service api`, puis redéployer la version précédente depuis la console.
- Une migration ne se défait pas toute seule : `npm run migrate -- down` annule la dernière, et chaque migration a son retour arrière, rejoué à chaque suite de tests d'intégration.

## Ce qu'il ne faut pas faire

- **Ne pas effacer une file Redis** pour « débloquer » : les tâches en attente sont le travail des utilisateurs.
- **Ne pas modifier `emails` à la main** sans sa source : la base le refusera, et c'est voulu.
- **Ne pas vider `ENCRYPTION_KEY_PREVIOUS`** avant que la rotation soit terminée.
- **Ne pas désactiver la garde des adresses** pour atteindre un site : si le site est injoignable autrement, c'est qu'il ne doit pas être atteint.
