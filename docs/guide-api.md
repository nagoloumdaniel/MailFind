# Guide de l'API publique

Comment un programme utilise MailFind. La référence exhaustive est le document OpenAPI 3.1, servi sans clé sur **<https://mailfind.vercel.app/v1/openapi.json>** et lisible sur la page `/documentation-api`. Ce guide dit ce que le document ne dit pas : pourquoi les choses sont ainsi, et dans quel ordre les appeler.

- **Version** : 2 octobre 2026
- **Base** : `https://mailfind.vercel.app/v1`

## S'authentifier

Une clé d'API, créée depuis la page Compte, envoyée en en-tête :

```text
Authorization: Bearer mf_...
```

La clé est montrée **une seule fois**. Seule son empreinte est gardée, avec un préfixe pour la reconnaître. Perdue, elle se révoque et se recrée ; elle ne se retrouve pas.

`/v1` est monté avant la session : une clé ne se mélange jamais à un cookie, et aucun jeton CSRF n'est demandé.

### Portées

Une clé porte les portées qu'on lui donne, et chaque opération indique la sienne dans le document (`x-scope`).

| Portée | Ce qu'elle ouvre |
| --- | --- |
| `companies:read` | Lire les entreprises et leurs adresses |
| `companies:write` | Modifier une entreprise ou une adresse |
| `emails:read` | Lire les adresses |
| `imports:write` | Lancer un import, suivre sa progression |
| `verify` | Vérifier des adresses |
| `exports:write` | Produire un export |
| `integrations:write` | Envoyer une sélection vers Campaign Mailer |

Il n'y a pas de portée `emails:write` : modifier une adresse passe par `companies:write`. Une adresse appartient à une entreprise, et les deux droits n'avaient pas de raison d'être séparés.

## Le parcours habituel

```text
POST /v1/imports            → { id }          lance le traitement
GET  /v1/imports/{id}       → { status }      jusqu'a "completed"
GET  /v1/imports/{id}/progress                 etape par etape
GET  /v1/companies?import_id={id}              ce qui en est sorti
POST /v1/exports            → { id }          ou lire directement les adresses
```

Pour une seule entreprise, `POST /v1/find` répond tout de suite si elle est déjà connue, sans rien dépenser, et lance sinon un import d'une ligne.

## Les conventions, et pourquoi

### Idempotence

Toute création accepte `Idempotency-Key`. La même clé rejouée dans les 24 heures rend **la même réponse**, sans rien recréer. C'est ce qui rend un `retry` sans danger après un délai dépassé, quand on ne sait pas si l'appel est passé.

La création d'un webhook en est exclue : garder sa réponse voudrait dire garder son secret en clair.

### Pagination

Par curseur, jamais par numéro de page : `limit`, puis `cursor` repris de `next_cursor`. `next_cursor` nul veut dire dernière page.

Un décalage par numéro de page se décale quand des lignes arrivent pendant la lecture. Le curseur ne bouge pas.

### Limitation de débit

60 requêtes par minute et par clé. Les en-têtes `RateLimit-Limit`, `RateLimit-Remaining` et `RateLimit-Reset` le disent à chaque réponse ; un dépassement rend 429 avec `Retry-After`.

### Erreurs

Format RFC 9457, `application/problem+json` :

```json
{
  "type": "about:blank",
  "title": "Quota atteint",
  "status": 429,
  "code": "quota_reached",
  "detail": "...",
  "requestId": "..."
}
```

**`code` est le champ à lire par un programme** : il est stable et en anglais. `title` et `detail` sont écrits pour un humain et peuvent changer.

`requestId` est ce qu'il faut citer pour qu'on retrouve la requête dans les journaux.

## Les quotas

Les plafonds du compte s'appliquent à l'API comme à l'interface, et `GET /v1/usage` les rend. Un import qui dépasse le quota **ne échoue pas** : il passe en `quota_blocked`, et les entreprises restantes attendent le renouvellement du mois ou une relance.

## Les webhooks

Plutôt que d'interroger en boucle : `import.completed`, `import.failed`, `verification.completed`, `export.ready`.

Chaque envoi porte une signature HMAC-SHA256 horodatée. **À vérifier avant de lire le corps**, sinon la signature ne sert à rien :

1. recomposer `timestamp.corps` ;
2. calculer le HMAC avec le secret ;
3. comparer en temps constant ;
4. refuser un horodatage trop ancien.

Les événements sont minces : un identifiant et un statut. Le reste se lit par l'API, ce qui évite de faire transiter des adresses dans un message qu'on ne contrôle pas.

Quatre tentatives, espacement croissant, et un journal des livraisons consultable.

## Ce que l'API ne fera pas

- **Rendre une adresse sans sa source.** Chaque adresse porte d'où elle vient.
- **Présenter comme vérifiée une adresse qui ne l'est pas.** `accept_all`, `unknown` et `unverified` sortent avec leur statut.
- **Explorer un site qui a demandé à ne pas l'être**, même si l'appel le demande explicitement.
- **Dépasser un quota ou un budget.** La réponse le dit, elle ne contourne pas.

## Exemple complet

```bash
CLE="mf_..."

# Lancer un import de deux entreprises
curl -s https://mailfind.vercel.app/v1/imports \
  -H "Authorization: Bearer $CLE" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "content-type: application/json" \
  -d '{
    "name": "Alternance 2027",
    "companies": [
      { "name": "Acme", "domain": "acme.fr" },
      { "name": "Beta Group", "website_url": "https://beta.io" }
    ]
  }'

# Suivre, puis lire ce qui en est sorti
curl -s "https://mailfind.vercel.app/v1/imports/$ID" -H "Authorization: Bearer $CLE"
curl -s "https://mailfind.vercel.app/v1/companies?import_id=$ID&limit=50" -H "Authorization: Bearer $CLE"
```

Les champs exacts de chaque corps sont dans le document OpenAPI, qui fait foi : des tests de contrat appellent chaque opération et valident la vraie réponse contre lui. Une route et le document ne peuvent pas diverger sans faire échouer la CI.
