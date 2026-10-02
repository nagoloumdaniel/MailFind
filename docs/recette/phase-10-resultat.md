# Recette de la Phase 10 : 100 entreprises réelles

Exécution du 2 octobre 2026, depuis la machine du propriétaire, contre la branche Neon `dev`.

```text
npm run recette -w backend -- docs/recette/phase-10-cent-entreprises.csv
```

Jeu d'essai : `phase-10-cent-entreprises.csv`, 100 lignes, volontairement mélangées comme le demande A1 : 78 domaines seuls, 12 URL seules, 10 noms seuls. Entreprises réelles, de la jeune pousse au grand groupe, plus des associations, des universités et des organismes publics, pour que la recette ne mesure pas seulement des sites bien tenus.

## Ce qui a été mesuré

| | |
| --- | --- |
| Entreprises traitées | 99 |
| Sites explorés (`crawl_status = done`) | 94 |
| Sites ignorés / en échec | 5 / 0 |
| Entreprises restées sans domaine | 1 |
| Adresses relevées | 636 |
| Durée de bout en bout | 5 min 42 s |

99 et non 100 : deux lignes du fichier désignaient le même domaine, et le dédoublonnage de la Phase 2 les a réunies. C'est le comportement attendu, pas une perte.

## Critères d'acceptation

| Critère | Mesure | Verdict |
| --- | --- | --- |
| A1 : un CSV de 100 entreprises réelles traité de bout en bout sans intervention, en moins de 15 minutes | 5 min 42 s, aucune intervention | **tenu** |
| A2 : taux de couverture de 2.2 atteint sur ce jeu | voir ci-dessous | **non mesurable en l'état** |
| A4 : aucune adresse exportée sans source | 0 adresse sans source, sur 636 | **tenu** |

## Pourquoi A2 n'est pas mesurable sans budget fournisseur

Le code impose une règle qui n'est pas négociable : **aucun sondage de boîte depuis nos serveurs**. Une adresse ne peut donc passer à `valid` que si un fournisseur l'a vérifiée. Les contrôles locaux, aussi complets soient-ils, s'arrêtent à `unverified`, avec la raison « Contrôles locaux passés ; boîte non vérifiée ».

Résultat de la passe, sans vérification de boîte :

| Statut | Adresses |
| --- | --- |
| `unverified` | 631 |
| `risky` | 5 |

Les 5 `risky` sont des messageries grand public relevées sur des sites, signalées comme telles.

Vérifier les 636 adresses coûterait environ 318 crédits Hunter, à un demi-crédit par vérification (D-08). Le plafond configuré est de 20 crédits par mois, calé sur le plan gratuit. A2 est donc **suspendu à une décision du propriétaire** : acheter des crédits Hunter, ou réduire l'échantillon de recette. Ce n'est pas un défaut du produit, et la recette le dit plutôt que de déclarer le critère manqué : le script affiche `NON MESURABLE : aucune verification de boite` tant qu'aucune vérification payée n'a eu lieu.

Quand le budget existe :

```text
npm run recette -w backend -- docs/recette/phase-10-cent-entreprises.csv --boites=found
```

`found` ne vérifie que les adresses réellement relevées sur les sites, pas les adresses de rôle déduites : 254 adresses, environ 127 crédits. `all` vérifie tout.

## Ce que la passe dit quand même de la qualité de la collecte

La couverture se lit à trois niveaux, du signal le plus fort au plus faible :

| Signal | Entreprises | Part des 94 sites explorés |
| --- | --- | --- |
| Au moins une adresse `valid` ou `risky` (A2) | 1 | 1 % |
| Au moins une adresse vue sur le site de l'entreprise | 39 | 41 % |
| Au moins une adresse passant tous les contrôles locaux | 91 | 97 % |

Lecture : le robot atteint 94 des 99 entreprises et en ramène quelque chose d'exploitable pour 91 d'entre elles. 39 entreprises publient une adresse sur leur propre site ; pour les autres, ce qu'on a est une adresse de rôle déduite sur un domaine qui a bien un MX. Sur 636 adresses, 254 ont une source `website` et 448 une source `deduction`. Les 70 % de 2.2 sont donc plausibles dès que la vérification de boîte tourne, puisque le vivier existe à 97 %.

## Relancer la recette

La collecte garde une entreprise explorée depuis moins d'une semaine et ne la reprend pas. Une seconde exécution sur la même base rendrait donc 94 sites `skipped` et 0 exploré, et la mesure ne voudrait rien dire. Pour refaire une passe complète : repartir d'une branche Neon neuve, ou attendre une semaine.
