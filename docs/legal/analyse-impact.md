# Analyse d'impact relative à la protection des données

Exigée par R-12, et par l'article 35 du RGPD. Elle porte sur le traitement T-02 du [registre](registre-traitements.md) : la collecte et la vérification d'adresses professionnelles.

- **Version** : 2 octobre 2026
- **Responsable du traitement** : Daniel Nagoloum Talla

> Ce document est une analyse interne, pas un avis juridique. Il doit être relu par un juriste avant toute ouverture au public, et avant l'annuaire partagé (D-25), qui change la nature du traitement.

## 1. Pourquoi une analyse est nécessaire

L'article 35.3 ne l'impose pas de plein droit ici : il n'y a ni décision automatisée produisant un effet juridique, ni donnée sensible, ni surveillance systématique d'une zone accessible au public. Mais deux critères de la liste du CEPD sont réunis, et deux suffisent :

- **Collecte de données à grande échelle** auprès de personnes qui ne sont pas en relation avec nous ;
- **Données collectées sans être obtenues de la personne**, qui ne sait pas que le traitement a lieu.

L'analyse est donc faite, et elle le reste à chaque phase qui élargit le traitement.

## 2. Le traitement, décrit sans ménagement

Un utilisateur dépose une liste d'entreprises. MailFind lit les pages publiques de leurs sites et en extrait les adresses de contact qui y sont publiées, interroge Hunter quand le site n'a rien donné, déduit des adresses de rôle probables, puis vérifie chacune. Le résultat est une liste d'adresses utilisables pour une prospection, rattachées à une entreprise, avec leur source.

**La personne concernée n'est pas prévenue au moment de la collecte.** Elle l'est, au plus tard, au premier message que l'utilisateur lui envoie, grâce à la [mention type](mention-information.md). C'est le point le plus sensible du traitement, et c'est l'article 14 qui l'encadre.

## 3. Nécessité et proportionnalité

| Question | Réponse |
| --- | --- |
| La finalité est-elle légitime ? | Oui : la prospection entre professionnels est reconnue comme un intérêt légitime, y compris par la CNIL, à condition que le message soit en rapport avec la fonction du destinataire |
| Les données sont-elles minimisées ? | Oui : adresse, type, statut, source. Aucun contenu, aucune donnée privée, aucun profil |
| La collecte est-elle limitée ? | Oui : vingt-cinq pages au plus par site, une requête par seconde, seulement les pages de contact, carrières, mentions légales et équipe |
| Pourrait-on faire autrement ? | Non, pour la finalité visée. Un formulaire de contact ne permet pas une candidature ciblée, et acheter un fichier serait pire pour les personnes |
| Les durées sont-elles justifiées ? | Oui : douze mois sans usage, puis effacement. Une adresse d'un an est de toute façon souvent fausse |

## 4. Risques pour les personnes, et ce qui les réduit

### R1. Recevoir un message non sollicité, sans savoir d'où vient l'adresse

**Gravité** : limitée. **Vraisemblance** : élevée, c'est la finalité même.

Ce qui la réduit : la source de chaque adresse est conservée et affichée, la mention type est fournie à l'utilisateur, les conditions l'engagent à l'utiliser, et la possibilité de s'opposer est rappelée.

**Risque résiduel** : l'utilisateur peut ne pas reprendre la mention. MailFind ne peut pas l'y contraindre, puisqu'il n'envoie pas. Accepté, documenté dans les conditions.

### R2. Voir son adresse nominative collectée alors qu'on ne l'a pas publiée soi-même

**Gravité** : modérée. **Vraisemblance** : faible.

Ce qui la réduit : seules les pages publiques du site de l'employeur sont lues ; une adresse masquée volontairement n'est jamais décodée ; une adresse nominative n'est déduite que d'un nom que l'utilisateur a fourni **et** d'un format qu'un fournisseur a observé ; aucune adresse personnelle n'est cherchée.

**Risque résiduel** : faible. Le retrait est immédiat sur demande.

### R3. Ne pas pouvoir faire cesser la collecte

**Gravité** : élevée si réalisé. **Vraisemblance** : faible.

Ce qui la réduit : une adresse signalée entre dans la liste de suppression et ne peut plus être collectée ; un site peut demander à ne plus être exploré du tout, pour tous les comptes, depuis une page publique qui ne demande ni compte ni identité ; la demande prend effet à sa réception, avant toute revue.

**Risque résiduel** : négligeable.

### R4. Fuite de la base d'adresses

**Gravité** : élevée. **Vraisemblance** : faible.

Ce qui la réduit : connexion par Google sans mot de passe stocké ; secrets et réponses de fournisseurs chiffrés au repos en AES-256-GCM avec rotation documentée ; base chez Neon avec TLS vérifié ; journaux et rapports d'erreur masqués, donc une fuite de journaux ne livre aucune adresse ; clés d'API hachées ; garde contre la falsification de requête côté serveur sur toutes les requêtes sortantes.

**Risque résiduel** : résiduel accepté, à réexaminer à la revue de sécurité de fin de Phase 8.

### R5. Détournement de l'outil pour du harcèlement ou de la prospection de masse

**Gravité** : élevée. **Vraisemblance** : faible.

Ce qui la réduit : quotas mensuels par compte sur les entreprises, les pages et les exports ; plafond de dépense par fournisseur ; MailFind n'envoie rien, ce qui limite ce qu'un compte peut faire du résultat ; les conditions l'interdisent et le compte peut être fermé.

**Risque résiduel** : faible pour MailFind lui-même ; le risque se déplace vers l'outil d'envoi.

### R6. Exactitude : attribuer une adresse à la mauvaise personne ou à la mauvaise entreprise

**Gravité** : modérée. **Vraisemblance** : modérée.

Ce qui la réduit : le domaine officiel est confirmé avant toute collecte, et marqué « à confirmer » en dessous d'un seuil de confiance ; la source est affichée, donc vérifiable d'un clic ; la vérification distingue « valide » de « impossible de conclure » et ne promet jamais ; le score est détaillé critère par critère.

**Risque résiduel** : faible.

## 5. Avis des personnes concernées

Non recueilli : le traitement porte sur des personnes qui ne sont pas en relation avec le responsable, et les solliciter pour cela reviendrait à les contacter sans motif. L'avis est remplacé par deux garanties vérifiables : une page publique expliquant l'agent de collecte, et un retrait effectif sans condition.

## 6. Conclusion

Le traitement est proportionné à sa finalité, et les risques identifiés sont réduits par des mesures en place dans le code, pas seulement dans ce document. **Aucun risque résiduel élevé** ne subsiste, donc aucune consultation préalable de la CNIL n'est requise au titre de l'article 36.

## 7. À revoir

- Avant l'ouverture au public : relecture juridique de ce document et des conditions.
- Avant l'annuaire partagé (D-25) : nouvelle analyse. Mutualiser des adresses entre comptes change la finalité et les destinataires.
- Avant la vérification certifiée (D-24) : vérifier qu'aucun envoi SMTP ne part de nos serveurs, et que le fournisseur retenu est au registre.
- À chaque sous-traitant ajouté.

| Date | Changement |
| --- | --- |
| 2 octobre 2026 | Création |
