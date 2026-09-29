/**
 * Lecture d'un CSV envoye a l'API (RFC 4180) : champs entre guillemets,
 * guillemets doubles echappes, retours a la ligne dans un champ, fins de
 * ligne CRLF ou LF. Le separateur est la virgule, le point-virgule ou la
 * tabulation, choisi d'apres la premiere ligne, hors guillemets : c'est ce
 * que produit un tableur francais comme un anglais.
 *
 * Le texte arrive deja decode (le corps JSON est en UTF-8) ; une marque
 * d'ordre d'octets en tete est retiree.
 */

const SEPARATEURS = [',', ';', '\t'] as const;

function separateurDe(texte: string): string {
  const comptes = new Map<string, number>(SEPARATEURS.map((s) => [s, 0]));
  let entreGuillemets = false;
  for (const caractere of texte) {
    if (caractere === '"') entreGuillemets = !entreGuillemets;
    else if (!entreGuillemets && (caractere === '\n' || caractere === '\r')) break;
    else if (!entreGuillemets && comptes.has(caractere)) {
      comptes.set(caractere, (comptes.get(caractere) ?? 0) + 1);
    }
  }
  let meilleur = ',';
  for (const [separateur, n] of comptes) {
    if (n > (comptes.get(meilleur) ?? 0)) meilleur = separateur;
  }
  return meilleur;
}

export function parseCsv(brut: string): string[][] {
  const texte = brut.startsWith('﻿') ? brut.slice(1) : brut;
  const separateur = separateurDe(texte);
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let entreGuillemets = false;

  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i += 1;
        } else {
          entreGuillemets = false;
        }
      } else {
        champ += c;
      }
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === separateur) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i += 1;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
    } else {
      champ += c;
    }
  }
  if (champ !== '' || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  // Une ligne entierement vide (fin de fichier, saut en trop) n'est pas une donnee.
  return lignes.filter((l) => l.some((valeur) => valeur.trim() !== ''));
}
