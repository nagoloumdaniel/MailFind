/**
 * Ce qui ne doit jamais sortir dans un journal ni chez Sentry (S-03) : une
 * adresse email, un secret de l'application, un jeton d'un tiers. MailFind
 * manipule des adresses a longueur de journee, et une erreur de pilote ou de
 * fournisseur peut citer la valeur qui l'a provoquee.
 *
 * Masquer par motif plutot que par nom de champ : un champ libre, un message
 * d'erreur ou une URL portent eux aussi des adresses.
 */
const MOTIFS: readonly (readonly [RegExp, string])[] = [
  // Les secrets d'abord : un jeton Campaign Mailer ou une cle peut contenir
  // une suite qu'on prendrait pour autre chose.
  [/\bmf_[A-Za-z0-9_-]{20,}/g, '[cle-api]'],
  [/\bcm_[A-Za-z0-9_-]{20,}/g, '[jeton-campaign-mailer]'],
  [/\bwhsec_[A-Za-z0-9_-]{20,}/g, '[secret-webhook]'],
  [/\bv1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[chiffre]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [coupe]'],
  [/\bya29\.[\w.-]+/g, '[jeton-google]'],
  // Codes et etats de la connexion croisee, dans une URL de retour.
  [/([?&](?:code|state|token|key|api_key)=)[^&#\s]+/gi, '$1[coupe]'],
  [/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g, '[adresse]'],
];

export function scrubText(texte: string): string {
  return MOTIFS.reduce(
    (sortie, [motif, remplacement]) => sortie.replace(motif, remplacement),
    texte,
  );
}

/**
 * Parcourt une valeur et masque chaque chaine. Les cycles et la profondeur
 * sont bornes : un objet d'erreur peut se referencer lui-meme.
 */
export function scrubValue<T>(valeur: T, profondeur = 0, vus = new WeakSet<object>()): T {
  if (typeof valeur === 'string') return scrubText(valeur) as T;
  if (valeur === null || typeof valeur !== 'object' || profondeur > 8) return valeur;
  if (vus.has(valeur)) return valeur;
  vus.add(valeur);

  if (Array.isArray(valeur)) {
    return valeur.map((element: unknown) => scrubValue(element, profondeur + 1, vus)) as T;
  }
  if (valeur instanceof Date || Buffer.isBuffer(valeur)) return valeur;
  if (valeur instanceof Error) {
    // Message et pile ne sont pas enumerables : une copie naive rendrait `{}`
    // et ferait disparaitre l'erreur du journal.
    return scrubValue(
      {
        type: valeur.name,
        message: valeur.message,
        stack: valeur.stack,
        ...(valeur.cause === undefined ? {} : { cause: valeur.cause }),
        ...Object.fromEntries(Object.entries(valeur)),
      },
      profondeur + 1,
      vus,
    ) as T;
  }

  // Une instance de classe (requete HTTP, socket, client) n'est pas parcourue :
  // son serialiseur la reduit d'abord a quelques champs, masques a leur tour.
  const prototype: unknown = Object.getPrototypeOf(valeur);
  if (prototype !== Object.prototype && prototype !== null) return valeur;

  const entrees: [string, unknown][] = Object.entries(valeur);
  return Object.fromEntries(
    entrees.map(([cle, contenu]) => [cle, scrubValue(contenu, profondeur + 1, vus)]),
  ) as T;
}
