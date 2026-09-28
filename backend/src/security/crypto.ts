import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Chiffrement au repos, AES-256-GCM (S-01).
 *
 * Sert a ce qui ne doit pas etre lisible dans une copie de la base : les
 * reponses des fournisseurs d'enrichissement, qui contiennent des adresses
 * nominatives (F-604), et plus tard les jetons et secrets de webhooks.
 *
 * Chaque valeur chiffree porte l'identifiant de sa cle. La rotation se fait
 * donc sans rien perdre : la nouvelle cle chiffre, l'ancienne, gardee dans
 * ENCRYPTION_KEY_PREVIOUS, dechiffre encore ce qu'elle a chiffre, le temps
 * que ces valeurs expirent ou soient reecrites.
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const VERSION = 'v1';
const ALGORITHME = 'aes-256-gcm';

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

interface Cle {
  readonly id: string;
  readonly octets: Buffer;
}

function lireCle(hex: string): Cle {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new EncryptionError(
      'Une cle de chiffrement fait 32 octets, ecrits en 64 caracteres hexadecimaux.',
    );
  }
  const octets = Buffer.from(hex, 'hex');
  // L'identifiant ne revele rien de la cle : huit caracteres d'une empreinte.
  const id = createHash('sha256').update(octets).digest('hex').slice(0, 8);
  return { id, octets };
}

export interface Cipher {
  encrypt(texte: string): string;
  decrypt(chiffre: string): string;
  encryptJson(valeur: unknown): string;
  decryptJson<T>(chiffre: string): T;
}

export function createCipher(courante: string, precedente?: string): Cipher {
  const cle = lireCle(courante);
  const cles = new Map<string, Cle>([[cle.id, cle]]);
  if (precedente !== undefined && precedente !== '') {
    const ancienne = lireCle(precedente);
    cles.set(ancienne.id, ancienne);
  }

  const encrypt = (texte: string): string => {
    // Un vecteur d'initialisation neuf a chaque fois : le reutiliser avec la
    // meme cle casserait GCM.
    const iv = randomBytes(12);
    const chiffreur = createCipheriv(ALGORITHME, cle.octets, iv);
    const contenu = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()]);
    const etiquette = chiffreur.getAuthTag();
    return [VERSION, cle.id, iv, etiquette, contenu]
      .map((partie) => (typeof partie === 'string' ? partie : partie.toString('base64url')))
      .join('.');
  };

  const decrypt = (chiffre: string): string => {
    const [version, id, iv, etiquette, contenu, ...reste] = chiffre.split('.');
    if (
      version !== VERSION ||
      id === undefined ||
      iv === undefined ||
      etiquette === undefined ||
      contenu === undefined ||
      reste.length > 0
    ) {
      throw new EncryptionError('Valeur chiffree illisible.');
    }
    const utilisee = cles.get(id);
    if (utilisee === undefined) {
      throw new EncryptionError(
        `Cle ${id} inconnue : elle a ete retiree avant que ses valeurs expirent.`,
      );
    }
    try {
      const dechiffreur = createDecipheriv(
        ALGORITHME,
        utilisee.octets,
        Buffer.from(iv, 'base64url'),
      );
      dechiffreur.setAuthTag(Buffer.from(etiquette, 'base64url'));
      return Buffer.concat([
        dechiffreur.update(Buffer.from(contenu, 'base64url')),
        dechiffreur.final(),
      ]).toString('utf8');
    } catch {
      // L'etiquette GCM ne correspond pas : la valeur a ete alteree.
      throw new EncryptionError('Valeur chiffree alteree ou cle incorrecte.');
    }
  };

  return {
    encrypt,
    decrypt,
    encryptJson: (valeur) => encrypt(JSON.stringify(valeur)),
    decryptJson: <T>(chiffre: string) => JSON.parse(decrypt(chiffre)) as T,
  };
}
