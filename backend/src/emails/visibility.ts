/**
 * F-503 : une candidate deduite que la verification a refusee n'est ni
 * comptee ni montree. La regle tient au statut, pas au drapeau `excluded`,
 * qui dit seulement « hors des exports et des envois » : l'utilisateur peut
 * exclure une adresse sans la faire disparaitre de sa bibliotheque.
 *
 * A utiliser dans une requete ou la table `emails` porte l'alias `e`.
 */
export const SHOWN_EMAIL = "not (e.origin = 'deduced' and e.status in ('invalid', 'disposable'))";

/** Le motif d'une exclusion decidee par l'utilisateur, que la verification ne defait pas. */
export const USER_EXCLUSION_REASON = "Exclue par l'utilisateur.";
