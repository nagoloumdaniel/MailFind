# Indicateurs de la section 2.2, relevés le 2 octobre 2026

```text
MAILFIND_API_URL=https://mailfind.vercel.app MAILFIND_API_KEY=mf_... npm run indicateurs -w backend
```

Le script lit en base ce que la base sait, et mesure la latence contre l'API déployée, parce que la seule latence qui compte est celle que voit un appelant, plateforme et réseau compris.

| Indicateur | Cible | Mesure | Verdict |
| --- | --- | --- | --- |
| Taux de couverture | 70 % ou plus | 1 % (1 entreprise sur 94) | non mesurable sans vérification de boîte, voir `phase-10-resultat.md` |
| Taux de rebond dans Campaign Mailer | moins de 3 % | non relevé | attend de vraies campagnes de bêta |
| Durée d'un import de 100 entreprises | moins de 15 minutes | 5 min 42 s | **tenu** |
| Adresses exportées sans source | 0 | 0 sur 636 | **tenu** |
| Latence de l'API en lecture, 95e centile | moins de 300 ms | 521 ms | **non tenu, et la cible est à revoir** |
| Coût fournisseur moyen par entreprise | affiché, sous le plafond | 0,00 centime sur 260 entreprises | **tenu** |

Le coût nul est exact : la recette n'a appelé aucun fournisseur payant. Hunter n'a pas été sollicité et Recherche d'entreprises est gratuite. Le chiffre devient significatif dès la première passe avec vérification de boîte.

## Pourquoi la cible de latence est à revoir, et non le code

Mesure décomposée, depuis la machine du propriétaire en France, contre l'hébergement en US East :

| Segment | Temps |
| --- | --- |
| Aller-retour réseau et poignée de main TLS, France vers US East, sur `/health` qui ne touche pas la base | 244 à 287 ms |
| Même appel à travers la réécriture Vercel | 269 à 431 ms, soit environ 25 ms de plus |
| Appel authentifié sur `/v1`, connexion réutilisée | médiane 370 ms, 95e centile 521 ms |

Lecture : environ 250 ms des 370 ms sont de la distance, irréductibles depuis l'Europe. La réécriture Vercel ajoute environ 25 ms. Il reste à peu près 100 ms pour l'application et ses requêtes, sur une instance Neon de 0,25 CU qui en enchaîne trois : la clé, le compte, la version des conditions.

Les 300 ms de 2.2 ne sont donc pas atteignables depuis l'Europe, quelle que soit la qualité du code, et ce n'est pas ce que l'indicateur cherche à dire. Trois issues, au choix du propriétaire :

1. **Lire l'indicateur côté serveur.** `pino-http` enregistre déjà `responseTime` sur chaque requête : c'est la mesure propre, sans la distance du client. C'est la voie recommandée, elle ne coûte rien et l'instrument existe.
2. **Mesurer depuis un client en US East**, dans la région d'hébergement, ce qui est la situation d'un intégrateur américain.
3. **Déplacer l'hébergement** si la clientèle visée est européenne. Décision de produit, pas de performance.

Tant que l'un des trois n'est pas tranché, le script affiche `INDICATIF` plutôt qu'un verdict, et dit pourquoi.

## Note sur la mesure elle-même

Au moment du relevé, le compte de production n'avait pas réaccepté les conditions montées en Phase 8, et l'API répondait donc `terms_not_accepted` avant la lecture. Le script mesure quand même : un tel refus traverse la plateforme, l'API, la recherche de la clé et celle du compte, soit presque tout le chemin de lecture. Il le signale par `(arretée au contrôle des conditions)` et refuse de rendre un verdict. Les chiffres ci-dessus sont donc un plancher : la lecture réelle ajoute la requête de liste.

Une clé d'API en lecture seule a été créée pour ce relevé puis révoquée aussitôt après ; son secret n'a jamais été écrit ailleurs que dans un fichier temporaire, effacé.
