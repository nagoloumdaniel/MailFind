import { getPool, query } from '../db/pool.js';

/**
 * Niveau 4 de la section 6.7 : domaines d'adresses jetables, d'apres une
 * liste publique rechargee chaque semaine.
 *
 * Une courte liste de base est integree au code : elle couvre les domaines
 * les plus courants tant que la liste publique n'a pas ete chargee, par
 * exemple sur une base neuve.
 */

const BASE = [
  'mailinator.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.net',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.fr',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'mailnesia.com',
  'mohmal.com',
  'emailondeck.com',
  'fakeinbox.com',
  'mintemail.com',
  'spamgourmet.com',
  'jetable.org',
  'jetable.fr.nf',
  'mail-temporaire.fr',
  'moakt.com',
  'tempr.email',
  'discard.email',
  'burnermail.io',
  'mytemp.email',
  'tempail.com',
  'mailcatch.com',
  'spam4.me',
  'grr.la',
  'inboxkitten.com',
  'mail.tm',
  'tmpmail.org',
  'minuteinbox.com',
];

/**
 * Une liste publique en compte plusieurs dizaines de milliers. En dessous de
 * ce seuil, le telechargement est tenu pour tronque ou errone, et la liste
 * en place est gardee : mieux vaut une liste d'une semaine qu'une liste vide.
 */
const MINIMUM_PLAUSIBLE = 1000;
const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;

export function isDisposableIn(domaines: ReadonlySet<string>, domaine: string): boolean {
  const parties = domaine.toLowerCase().split('.');
  // Le domaine lui-meme et ses parents : « x.yopmail.com » est jetable aussi.
  for (let debut = 0; debut < parties.length - 1; debut += 1) {
    if (domaines.has(parties.slice(debut).join('.'))) return true;
  }
  return false;
}

export async function loadDisposableDomains(): Promise<Set<string>> {
  const lus = await query<{ domain: string }>('select domain from disposable_domains');
  return new Set([...BASE, ...lus.rows.map((ligne) => ligne.domain)]);
}

/** Les domaines d'un fichier texte, un par ligne, commentaires ignores. */
export function parseDomainList(texte: string): string[] {
  const vus = new Set<string>();
  for (const ligne of texte.split(/\r?\n/)) {
    const domaine = ligne.replace(/#.*$/, '').trim().toLowerCase();
    if (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        domaine,
      )
    ) {
      vus.add(domaine);
    }
  }
  return [...vus];
}

export type RefreshOutcome =
  | { readonly kind: 'refreshed'; readonly count: number }
  | { readonly kind: 'kept'; readonly reason: string };

/**
 * Recharge la liste depuis son adresse publique. Remplace la table en une
 * transaction : a aucun moment une verification ne voit une liste a moitie
 * chargee.
 */
export async function refreshDisposableDomains(options: {
  readonly url: string;
  readonly timeoutMs?: number;
}): Promise<RefreshOutcome> {
  let texte: string;
  try {
    const reponse = await fetch(options.url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!reponse.ok) return { kind: 'kept', reason: `liste publique : ${String(reponse.status)}` };
    const octets = await reponse.arrayBuffer();
    if (octets.byteLength > TAILLE_MAX_OCTETS)
      return { kind: 'kept', reason: 'liste trop volumineuse' };
    texte = new TextDecoder().decode(octets);
  } catch (error) {
    return { kind: 'kept', reason: error instanceof Error ? error.message : 'erreur' };
  }

  const domaines = parseDomainList(texte);
  if (domaines.length < MINIMUM_PLAUSIBLE) {
    return {
      kind: 'kept',
      reason: `liste publique de ${String(domaines.length)} domaines seulement, tenue pour tronquee`,
    };
  }

  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('delete from disposable_domains');
    await client.query(
      `insert into disposable_domains (domain) select unnest($1::text[]) on conflict do nothing`,
      [domaines],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { kind: 'refreshed', count: domaines.length };
}
