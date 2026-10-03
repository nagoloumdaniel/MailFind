# Préparer le lancement public

Document de travail du propriétaire, écrit le 3 octobre 2026, à relire après la bêta. Il dit ce sur quoi MailFind se vend, ce qui bloque encore une ouverture publique, et dans quel ordre ouvrir.

## 1. Ce sur quoi le produit se vend

Le marché est occupé : Hunter, Apollo, Dropcontact, Lusha, et une dizaine d'autres. Tous trouvent des adresses. Aucun ne fait ce que MailFind fait au centre de son produit : **dire d'où vient chaque adresse, et refuser d'appeler vérifié ce qui ne l'est pas.**

C'est la seule phrase à tenir, et elle se décline en trois preuves vérifiables par le client lui-même :

1. **Chaque adresse porte l'URL exacte de la page où elle a été vue, la méthode, et la date.** Le client clique, et la retrouve. La base refuse une adresse sans source : ce n'est pas une intention, c'est une contrainte d'intégrité.
2. **`unverified` n'est jamais présenté comme `valid`.** Là où les concurrents affichent un score de confiance de 85 % qui se lit comme une certitude, MailFind affiche un statut et son détail, lignes qui font la somme.
3. **Le robot respecte les sites** : `robots.txt`, une requête par seconde et par domaine, agent identifié, aucune tentative de décoder une adresse masquée volontairement. Une page publique permet à n'importe quel site de se retirer, immédiatement.

À qui cela parle d'abord : les gens pour qui une adresse fausse coûte cher. Recrutement et candidature, prospection ciblée en petit volume, journalistes et chargés de partenariats. Pas les équipes qui veulent cent mille contacts : MailFind est plus lent et plus cher par adresse, et il faut l'assumer plutôt que le cacher.

Le canal naturel est Campaign Mailer. La connexion croisée existe déjà, un compte suffit pour les deux, et un utilisateur de Campaign Mailer a par définition le problème que MailFind résout.

## 2. Ce qui bloque une ouverture publique, aujourd'hui

### Bloquant, et c'est le seul vrai

**Le budget fournisseur ne peut pas servir des utilisateurs publics.** Le plafond configuré est de vingt crédits Hunter par mois, soit quarante vérifications de boîte, pour l'ensemble du produit. La recette a relevé six cent trente-six adresses pour cent entreprises, une seule fois. Un utilisateur public épuiserait le plafond du mois en un import.

Conséquence : sans vérification de boîte, tout sort `unverified`, et le produit ne peut pas tenir la promesse sur laquelle il se vend. Ce n'est pas un défaut de code, le plafond fait exactement son travail, et les quotas suspendent proprement plutôt que de dépenser. C'est une décision économique à prendre avant d'ouvrir, et elle en contient trois :

- Quel volume de vérification acheter chez Hunter.
- Qui le paie : offre gratuite limitée, crédits à l'usage, ou abonnement. La facturation est un lot de la Phase 11 et n'existe pas encore.
- Quel plafond par utilisateur, pour qu'un seul compte ne vide pas le budget commun. Le mécanisme existe (`quota_usage`, plafonds par fournisseur et par opération) ; seules les valeurs sont à poser.

Tant que ce point n'est pas tranché, une bêta fermée et gratuite est la bonne échelle, et une ouverture publique ne l'est pas.

### À traiter avant d'ouvrir, mais sans décision économique

| Point | État | Ce qu'il faut |
| --- | --- | --- |
| Lecture juridique des documents | `docs/legal/` est écrit, pas relu par un juriste | Faire relire les conditions, la politique de confidentialité, la mention d'information et l'analyse d'impact. Le produit traite des données personnelles de tiers : c'est le risque le plus mal couvert aujourd'hui |
| Cible de latence de 2.2 | 521 ms mesurés depuis l'Europe pour une cible de 300 ms, dont 250 ms de distance | Redéfinir l'indicateur côté serveur, où `pino-http` enregistre déjà `responseTime`. Voir `docs/recette/phase-10-indicateurs.md` |
| Taux de couverture et taux de rebond | Jamais mesurés sur de vraies campagnes | Les deux chiffres sont les seuls arguments commerciaux qui comptent. Ne rien annoncer avant de les avoir |
| Essai en production entre MailFind et Campaign Mailer | Le code des deux côtés est écrit et testé contre le contrat ; l'aller-retour entre les deux applications déployées n'a jamais tourné | Un essai réel, avec un vrai compte, avant d'en faire un argument |
| Conditions en cours | La version `2026-10-02` n'est pas acceptée par le compte de production | Une connexion et un clic. À faire avant tout relevé d'indicateur |
| Facturation et offres | Inexistantes | Phase 11. Une ouverture publique sans elles signifie offrir le coût fournisseur |

## 3. Ce qui est prêt, et n'a pas à être refait

À ne pas rouvrir par réflexe au moment du lancement :

- La page d'accueil porte déjà le bon message : « Des adresses professionnelles, avec leur source », les trois preuves, et un spécimen d'adresse avec son statut et sa source. Elle n'a pas besoin d'être réécrite, seulement relue après la bêta si un testeur a buté dessus.
- Les trois voies de connexion marchent, un seul compte par adresse.
- L'API publique est documentée, versionnée, et son document OpenAPI est validé par des tests qui échouent si une route et le document divergent.
- L'observabilité répond : `/health`, `/ready` avec le battement du processus de traitement, les alertes de la section 12, les journaux masqués par motif.
- La sauvegarde quotidienne existe et la restauration a été exécutée, pas seulement écrite.

## 4. Ordre d'ouverture

L'enchaînement, chaque étape conditionnant la suivante :

1. **Bêta fermée, gratuite, cinq à dix personnes** recrutées parmi les utilisateurs de Campaign Mailer. Guide : `docs/guide-beta.md`. Canal : le formulaire `Retour de bêta`. C'est l'étape en cours.
2. **Trancher le budget de vérification**, puis relancer la recette avec `--boites=found` pour obtenir enfin le taux de couverture réel.
3. **Mesurer le taux de rebond** dans Campaign Mailer sur les campagnes de la bêta. C'est le chiffre qui vaut le plus cher et il ne s'obtient pas autrement.
4. **Lecture juridique**, et correction des documents.
5. **Offres et facturation** (Phase 11), calées sur le coût fournisseur réel par entreprise, désormais connu.
6. **Ouverture publique**, avec les deux chiffres en avant plutôt qu'une promesse.

## 5. La règle à ne pas enfreindre au lancement

Le produit se vend sur son honnêteté. Une page de vente qui arrondit un statut, qui parle d'adresses « vérifiées » en comptant les `unverified`, ou qui annonce un taux de couverture non mesuré, détruit exactement ce qui distingue MailFind. Les chiffres annoncés doivent être ceux que le script rend, et le script est dans le dépôt.
