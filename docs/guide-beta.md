# MailFind : guide de prise en main de la bêta

Bienvenue, et merci. Vous faites partie des premières personnes à utiliser MailFind. Ce guide tient en une dizaine de minutes de lecture et vous mène d'un fichier d'entreprises à une campagne prête dans Campaign Mailer.

L'application est en ligne sur <https://mailfind.vercel.app>.

## Ce que MailFind fait, en une phrase

Vous donnez une liste d'entreprises ; MailFind trouve leurs adresses professionnelles publiques, vous dit d'où vient chacune, et les envoie dans Campaign Mailer en brouillon.

Ce qu'il ne fait pas, et ne fera pas : deviner une adresse personnelle, contourner un site qui masque ses adresses, ou envoyer un message à votre place. Une campagne créée depuis MailFind reste un brouillon, et c'est vous qui la lancez.

## 1. Se connecter

Trois boutons sur la page d'accueil :

- **Google** : votre compte Google. MailFind ne demande que votre identité, jamais l'accès à votre messagerie.
- **Campaign Mailer** : si vous avez déjà un compte là-bas, ce bouton suffit.
- Et inversement, depuis Campaign Mailer, un bouton **MailFind**.

Un seul compte derrière les trois, si l'adresse est la même. Vous n'aurez pas de doublon.

À la première connexion, les conditions d'utilisation vous sont présentées. Elles disent en clair ce qui est collecté, pourquoi, et combien de temps c'est gardé. Nous vous demanderons de les réaccepter si elles changent.

## 2. Préparer votre fichier

Un CSV. Une ligne par entreprise. MailFind reconnaît les colonnes tout seul, et vous montre sa lecture avant de commencer, pour que vous puissiez la corriger.

Les colonnes utiles, toutes facultatives sauf qu'il en faut au moins une :

| Colonne | Exemple | À quoi ça sert |
| --- | --- | --- |
| Nom de l'entreprise | `Doctolib` | Suffit à lui seul : MailFind cherchera le domaine officiel |
| Domaine | `doctolib.fr` | Le plus fiable : pas de recherche, donc pas d'erreur d'homonyme |
| Site ou page carrières | `https://pro.doctolib.fr` | Utile quand le domaine du site n'est pas celui des adresses |
| Prénom et nom | `Marie Dupont` | Seule façon d'obtenir une adresse nominative |
| Étiquettes | `lyon;prioritaire` | Pour retrouver un lot plus tard |

Un conseil qui change beaucoup de choses : **donnez le domaine quand vous l'avez**. Un nom seul demande une recherche, et une recherche peut se tromper d'entreprise, surtout sur un nom commun. Vous pourrez corriger un domaine après coup, mais autant ne pas en avoir besoin.

Pour votre première fois, prenez dix lignes, pas cinq cents. Vous verrez le résultat en deux minutes et vous saurez si votre fichier est bien formé.

## 3. Lancer un import

Page **Import**. Vous déposez le fichier, vous vérifiez la correspondance des colonnes, et vous choisissez trois choses :

- **La profondeur.** `Standard` convient presque toujours. `Rapide` se limite à la page d'accueil et aux pages de contact évidentes ; `Approfondie` va chercher plus loin, et prend plus de temps.
- **Les types d'adresses voulus.** Contact général, recrutement, commercial, presse, direction. Ne demandez que ce qui vous sert : chaque type demandé est du travail en plus.
- **La vérification de boîte.** C'est le point important, lisez la section suivante.

Au-delà de vingt entreprises, MailFind vous montre une estimation et vous demande de confirmer. C'est volontaire : vous devez savoir ce que vous engagez avant que ça parte.

## 4. Comprendre les statuts, c'est tout le produit

Un statut n'est jamais une promesse. Voici ce que chacun veut dire, exactement :

| Statut | Ce que ça veut dire | Peut-on écrire à cette adresse ? |
| --- | --- | --- |
| `valid` | Un fournisseur a interrogé le serveur de messagerie, la boîte existe | Oui |
| `risky` | L'adresse existe probablement mais quelque chose cloche : messagerie grand public, adresse de rôle partagée | À vos risques, et jamais en masse |
| `accept_all` | Le serveur accepte tout ce qu'on lui présente, il ne nous apprend rien | Non vérifiée, traitez-la comme inconnue |
| `unknown` | La vérification n'a pas abouti | Non vérifiée |
| `unverified` | Les contrôles locaux passent (syntaxe, domaine, MX), mais aucune boîte n'a été interrogée | Non vérifiée |
| `invalid` | Le domaine ou la boîte n'existe pas | Non |
| `disposable` | Domaine de messagerie jetable | Non |

**`unverified` n'est pas `valid`.** Si vous lancez l'import sans vérification de boîte, c'est le statut que vous obtiendrez pour presque tout. Cela ne veut pas dire que l'adresse est mauvaise : elle a passé tous nos contrôles. Cela veut dire que personne n'a frappé à la porte. Nous ne le faisons jamais depuis nos serveurs, pour une raison simple : un serveur qui sonde des boîtes finit sur une liste noire, et toutes vos campagnes avec lui. Le sondage passe donc par un fournisseur, et un fournisseur se paie.

Si le propriétaire vous a donné un budget de vérification, cochez la vérification de boîte. Sinon, sachez que vos adresses seront `unverified`, et que les exports ne les présenteront jamais comme vérifiées.

## 5. Lire un résultat

La page de l'import suit chaque étape en direct, et vous montre trois choses à regarder :

- **Les entreprises à vérifier.** Domaine incertain, site injoignable, homonyme possible. C'est là que votre œil vaut mieux que notre code : une correction de domaine se fait en une ligne, et relance juste cette entreprise.
- **Les adresses, avec leur score.** Survolez un score : il se décompose ligne par ligne, et les lignes font la somme. Si un score vous surprend, son détail vous dira pourquoi.
- **La source de chaque adresse.** L'URL exacte de la page où elle a été vue, ou le nom du fournisseur, avec la date. Cliquez : vous devez pouvoir retrouver l'adresse sur la page. Si vous n'y arrivez pas, c'est un défaut, et c'est exactement le genre de retour qui nous intéresse.

Les pages **Entreprises** et **Contacts** vous laissent filtrer, trier, corriger à la main, et agir en masse. `Exclu` retire une adresse des exports sans la supprimer.

## 6. Envoyer vers Campaign Mailer

Page **Exports**, ou l'action en masse depuis Contacts. Vous choisissez quelles adresses partent, selon leur statut, et MailFind crée une campagne **en brouillon** dans Campaign Mailer. Rien n'est envoyé. Vous ouvrez Campaign Mailer, vous relisez, vous lancez.

Un détail qui surprend la première fois : si vous demandez « uniquement les adresses vérifiées » sur un import sans vérification de boîte, la sélection sera vide, et MailFind vous le dira. Ce n'est pas un bogue. Choisissez « toutes, sauf invalides, jetables et supprimées » si c'est ce que vous voulez vraiment.

Les exports en fichier existent aussi : CSV, XLSX, JSON. Au-delà de deux mille lignes, le fichier est construit en arrière-plan et reste disponible sept jours.

## 7. Vérifier une liste sans rien stocker

Page **Vérifier**. Vous collez des adresses, vous obtenez leur statut, et rien n'est enregistré. Pratique pour trancher sur une liste qui vient d'ailleurs.

## Ce que nous aimerions apprendre de vous

Nous n'avons pas besoin que vous soyez indulgent. Cinq questions nous intéressent plus que les autres :

1. **Une adresse que vous n'avez pas retrouvée sur la page citée.** C'est le défaut le plus grave que le produit puisse avoir.
2. **Une entreprise dont le domaine est faux**, et ce que vous aviez mis dans le fichier.
3. **Un score qui ne correspond pas à votre jugement**, avec son détail.
4. **Un moment où vous avez hésité** devant l'interface sans savoir quoi faire.
5. **Ce que vous avez cherché et n'avez pas trouvé.**

### Comment nous le dire

Chaque retour part avec un **identifiant de requête** si une erreur s'est affichée : la page vous le montre, recopiez-le, il nous mène directement à la trace côté serveur.

Deux voies :

- **Un formulaire structuré** sur le dépôt, `Retour de bêta` dans les tickets. Il vous demande le minimum pour que nous puissions reproduire : ce que vous avez fait, ce que vous attendiez, ce qui s'est passé.
- **Par message direct** au propriétaire, si c'est plus rapide pour vous. Dites-nous juste l'entreprise concernée et l'heure approximative.

N'envoyez jamais de fichier contenant des données personnelles dans un ticket public. Décrivez la ligne, ou envoyez-la en direct.

## Vos droits, et ceux des autres

Vos données vous appartiennent : la page **Compte** exporte tout ce que nous avons sur vous, et supprime votre compte sans passer par nous.

Les adresses que vous collectez sont des données personnelles, et vous en devenez responsable au moment où vous les utilisez. Deux points concrets : les adresses sont gardées douze mois, et un site ou une personne peut demander à être retiré de nos collectes à tout moment, depuis la page **Robot**. Nous respectons ces demandes immédiatement, sans discuter.

Les conditions d'utilisation et la politique de confidentialité disent le reste, et elles sont écrites pour être lues.

## Si quelque chose ne va pas

| Symptôme | Ce qui se passe probablement |
| --- | --- |
| L'import reste en attente | Un incident de notre côté ; signalez-le, nous avons une alerte sur ce cas |
| Une entreprise n'a aucune adresse | Son site ne publie rien, ou son `robots.txt` nous interdit la page ; les deux sont normaux |
| Un site ignoré | Il a demandé à ne pas être collecté, ou son `robots.txt` l'interdit. Nous ne passons pas outre |
| Tout est `unverified` | Vérification de boîte non demandée à l'import, voir la section 4 |
| Un quota atteint | Le travail est suspendu, pas perdu. Il reprend au mois suivant, ou plus tôt si le plafond est relevé |

Merci encore. Un produit comme celui-ci se juge sur un point unique : est-ce que l'adresse qu'il vous donne est vraie, et est-ce qu'il vous dit honnêtement quand il n'en sait rien. Dites-nous quand ce n'est pas le cas.
