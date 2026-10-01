# Registre des activités de traitement

Exigé par l'article 30 du RGPD, et par R-11. Tenu par le responsable du traitement, à jour du code réellement déployé.

- **Version** : 2 octobre 2026
- **Responsable du traitement** : Daniel Nagoloum Talla
- **Délégué à la protection des données** : aucun. Le traitement n'atteint aucun des trois seuils de l'article 37, à revoir si l'annuaire partagé ouvre (D-25)

MailFind tient deux rôles, et le registre les sépare parce que les obligations ne sont pas les mêmes : **responsable** pour les comptes de ses utilisateurs, **sous-traitant** pour les adresses qu'il collecte sur leurs instructions.

---

## T-01. Gestion des comptes utilisateurs

| | |
| --- | --- |
| **Rôle** | Responsable du traitement |
| **Finalité** | Permettre à une personne de se connecter, de retrouver son travail, et de prouver son acceptation des conditions |
| **Base légale** | Exécution du contrat (art. 6.1.b) |
| **Personnes concernées** | Les utilisateurs de MailFind |
| **Catégories de données** | Identifiant Google, adresse email, nom, version des conditions acceptée et sa date |
| **Destinataires** | Google (authentification), Neon, Railway, Vercel, Redis Cloud |
| **Transferts hors UE** | États-Unis, clauses contractuelles types |
| **Conservation** | Jusqu'à la suppression du compte, déclenchée par l'utilisateur |
| **Mesures** | Pas de mot de passe stocké, session en Redis, cookie `httpOnly` `secure` `sameSite=lax`, jeton anti-CSRF |

## T-02. Collecte et vérification d'adresses professionnelles

| | |
| --- | --- |
| **Rôle** | Sous-traitant de l'utilisateur, qui en est responsable |
| **Finalité** | Trouver, qualifier et vérifier les adresses de contact qu'une entreprise publie, pour la prospection professionnelle de l'utilisateur |
| **Base légale** | Intérêt légitime de l'utilisateur (art. 6.1.f), apprécié par lui |
| **Personnes concernées** | Les personnes dont une adresse nominative figure sur le site public de leur employeur. Les adresses de rôle (`contact@`, `recrutement@`) n'identifient personne |
| **Catégories de données** | Adresse, partie locale, nom quand l'utilisateur l'a fourni, type, statut de vérification, score, et toujours la source : URL, méthode, date |
| **Source** | Pages publiques du site officiel ; Hunter quand le site n'a rien donné ; déduction à partir d'un format observé |
| **Destinataires** | Hunter, Brave Search, Recherche d'entreprises, et les hébergeurs de T-01 |
| **Transferts hors UE** | États-Unis pour Hunter, Brave et les hébergeurs ; France pour Recherche d'entreprises |
| **Conservation** | Douze mois sans usage, puis effacement automatique (R-06) |
| **Mesures** | Réponses des fournisseurs chiffrées au repos (AES-256-GCM), liste de suppression par compte, exclusion de sites pour tous, source obligatoire en base |

## T-03. Journal d'audit

| | |
| --- | --- |
| **Rôle** | Responsable du traitement |
| **Finalité** | Rendre compte de qui a fait quoi : connexions, imports, exports, suppressions, création et révocation de clés |
| **Base légale** | Intérêt légitime (art. 6.1.f) : sécurité du service et réponse aux demandes d'exercice de droits |
| **Personnes concernées** | Les utilisateurs |
| **Catégories de données** | Identifiant de compte, action, entité concernée, date. **Jamais d'adresse en clair ni de secret** |
| **Destinataires** | Neon |
| **Conservation** | Douze mois |
| **Mesures** | Contrainte en base sur la liste des actions, masquage des adresses avant écriture |

## T-04. Traces techniques et rapports d'erreur

| | |
| --- | --- |
| **Rôle** | Responsable du traitement |
| **Finalité** | Comprendre une panne et la corriger |
| **Base légale** | Intérêt légitime (art. 6.1.f) |
| **Personnes concernées** | Les utilisateurs, et incidemment les personnes citées par un message d'erreur |
| **Catégories de données** | Identifiant de requête, méthode, chemin, code de réponse, pile d'appel. Les adresses, jetons, clés et valeurs chiffrées sont **masqués avant enregistrement** (S-03) |
| **Destinataires** | Railway, Vercel, Sentry |
| **Transferts hors UE** | États-Unis, clauses contractuelles types |
| **Conservation** | Quatre-vingt-dix jours |
| **Mesures** | Masquage par motif et non par nom de champ, pas d'IP ni de cookie envoyés à Sentry, compte réduit à son identifiant |

## T-05. Liste de suppression et exclusion de sites

| | |
| --- | --- |
| **Rôle** | Responsable du traitement |
| **Finalité** | Garantir qu'une adresse signalée ne soit plus jamais collectée, et qu'un site qui refuse ne soit plus exploré (R-04, R-07) |
| **Base légale** | Obligation légale (art. 6.1.c) : donner effet au droit d'opposition |
| **Catégories de données** | **Empreinte SHA-256 de l'adresse, jamais l'adresse.** Pour un site : le nom de domaine, et le motif écrit par le demandeur |
| **Destinataires** | Neon |
| **Conservation** | Sans limite : effacer la liste reviendrait à permettre la recollecte de ce qu'on s'est engagé à ne plus collecter |
| **Mesures** | Hachage, page d'opposition publique sans authentification et sans demande d'identité |

---

## Ce qui n'est pas traité

- **Aucune donnée sensible** au sens de l'article 9. Les adresses collectées sont professionnelles.
- **Aucune décision automatisée** produisant un effet juridique. Le score est une aide à la lecture, affiché critère par critère ; il n'écarte personne tout seul.
- **Aucune donnée de mineur** recherchée. Le service s'adresse à des professionnels.
- **Aucun contenu de messagerie.** MailFind n'a aucune portée Gmail et n'envoie aucun courrier.

## Révisions

| Date | Changement |
| --- | --- |
| 2 octobre 2026 | Création, à l'ouverture de la Phase 8 |
