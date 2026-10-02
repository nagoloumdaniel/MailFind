# Architecture

Comment les pièces tiennent ensemble, et comment un fichier CSV devient des adresses vérifiées. Pour quelqu'un qui arrive sur le code et veut savoir où regarder.

- **Version** : 2 octobre 2026

## Vue d'ensemble

```text
Navigateur
    │
    ▼
Vercel ──── /api, /v1 ────► Railway : API Express
  (React)                      │
                               ├── PostgreSQL (Neon)
                               ├── Redis (sessions, files)
                               └── R2 (exports volumineux)
                                      ▲
Railway : processus de traitement ────┘
  (BullMQ, les quatre étapes)
```

Deux processus, un seul dépôt, un seul schéma de base. L'API répond aux requêtes ; le processus de traitement vide les files. **Sans lui, l'API répond mais un import reste `pending`** : c'est la panne la plus facile à provoquer et la plus déroutante, d'où le battement de cœur de `/ready`.

L'application web ne parle jamais à l'API par une autre origine : Vercel renvoie `/api` et `/v1` vers Railway, ce qui garde le cookie de session sur l'origine de l'application.

## Du CSV aux adresses

Un import traverse cinq étapes. Chacune est une tâche indépendante : elle peut échouer, être rejouée, et reprendre après un redémarrage sans refaire ce qui est déjà fait.

| Étape | Où | Ce qu'elle fait |
| --- | --- | --- |
| `import.plan` | [`imports/plan.ts`](../backend/src/imports/plan.ts) | Normalise les lignes, déduplique, crée les entreprises |
| `company.identify` | [`pipeline/identify.ts`](../backend/src/pipeline/identify.ts) | Identité légale (siren), puis domaine officiel |
| `company.crawl` | [`pipeline/crawl.ts`](../backend/src/pipeline/crawl.ts) | Lit les pages publiques, extrait les adresses et leurs sources |
| `company.enrich` | [`pipeline/enrich.ts`](../backend/src/pipeline/enrich.ts) | Comble les types manquants : fournisseur, puis adresses de rôle |
| `company.verify` | [`pipeline/verify.ts`](../backend/src/pipeline/verify.ts) | Sept contrôles locaux, vérification de boîte si demandée, score |

L'enchaînement est explicite : chaque étape déclare la suivante **avant** de se conclure, sinon l'import se croirait terminé entre les deux. C'est dans [`pipeline/steps.ts`](../backend/src/pipeline/steps.ts), avec la règle qui dit quand un import est fini.

## Les invariants, et où ils sont tenus

Ce sont les règles qu'on ne contourne pas. Elles ne vivent pas dans un document : elles vivent dans le code, et souvent dans la base.

| Règle | Tenue par |
| --- | --- |
| Une adresse a toujours une source | Une contrainte de base : `emails` sans `email_sources` est refusé |
| La vérification est un statut, pas une promesse | `SHOWN_EMAIL` dans [`emails/visibility.ts`](../backend/src/emails/visibility.ts), et les exports |
| Le robot respecte les sites | [`crawler/robots.ts`](../backend/src/crawler/robots.ts), la file par domaine, l'agent qui s'annonce |
| Aucune requête vers une adresse privée | La garde de [`net/addresses.ts`](../backend/src/net/addresses.ts), après DNS et après chaque redirection |
| Un appel payant n'est jamais payé deux fois | `paidCall` dans [`providers/credits.ts`](../backend/src/providers/credits.ts) : réserver, appeler, régler |
| Les quotas arrêtent proprement | [`quotas/usage.ts`](../backend/src/quotas/usage.ts) : prendre une place et refuser la suivante en une instruction |
| Rien d'identifiant dans les journaux | [`observability/scrub.ts`](../backend/src/observability/scrub.ts), par motif et non par nom de champ |

## Pourquoi deux clients Redis

`node-redis` pour les sessions, `ioredis` pour BullMQ. Ils ne sont pas interchangeables, et les mélanger est une panne déjà rencontrée sur Campaign Mailer. Les deux se connectent à la même base, préfixes distincts.

## L'API publique

`/v1` est montée **avant** la session et le jeton CSRF : un programme qui l'appelle porte une clé, jamais un cookie. Elle a sa propre authentification ([`api-keys/`](../backend/src/api-keys/)), sa limitation de débit par clé dans Redis, son idempotence et sa pagination par curseur.

Le document OpenAPI est construit à partir des schémas zod des réponses, pas écrit à la main : des tests de contrat appellent chaque opération et valident la vraie réponse contre la ligne du document. Une route et le document ne peuvent pas diverger sans faire échouer la CI.

## Ce qui est chiffré, et ce qui est haché

**Chiffré** (AES-256-GCM, donc relisible) : les secrets de webhook, le jeton Campaign Mailer, les réponses des fournisseurs qui contiennent des adresses nominatives.

**Haché** (SHA-256, donc jamais relisible) : les clés d'API, les codes de connexion croisée, les adresses de la liste de suppression et de la liste d'effacement. Une liste d'adresses interdites ne doit pas devenir, elle-même, une liste d'adresses.

Détail et procédure de rotation : [`security.md`](security.md).

## Les deux autres entrées

- **Connexion croisée avec Campaign Mailer** ([`sso/`](../backend/src/sso/)) : chaque application sert de fournisseur d'identité à l'autre. Un compte par identité Google, jamais de doublon, aucun jeton Google échangé. Le raisonnement est dans D-26.
- **Envoi vers Campaign Mailer** ([`campaign-mailer/`](../backend/src/campaign-mailer/)) : par son API versionnée, par lots de 500, avec une clé d'idempotence par lot. La campagne créée reste un brouillon.

## Où regarder quand quelque chose ne va pas

| Symptôme | Premier endroit |
| --- | --- |
| Un import reste `pending` | Le processus de traitement tourne-t-il ? `GET /ready`, champ `worker` |
| Une entreprise n'a aucune adresse | Sa `crawl_notes` : `robots_disallowed`, `no_website`, `site_excluded`, `unreachable` |
| Un import s'arrête en route | Son statut : `quota_blocked` veut dire qu'un plafond est atteint, pas qu'il a échoué |
| Les fournisseurs ne sont jamais appelés | `ENCRYPTION_KEY` vide désactive l'enrichissement : leurs réponses ne seraient pas chiffrées |
| Une erreur 500 sans détail | L'identifiant de requête dans la réponse, puis les journaux Railway |

Procédures complètes : [`runbook.md`](runbook.md).
