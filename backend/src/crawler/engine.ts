import { registrableDomain } from '../net/domain.js';
import type { CrawlerClient } from './client.js';
import { parsePage, type PageLink, type ParsedPage } from './document.js';
import { extractAddresses, type ExtractionMethod } from './extract.js';
import { filterAddresses } from './filter.js';
import { MAX_PAGES, pageKey, selectInternalLinks, selectPages, type CrawlDepth } from './pages.js';
import { pageSignals } from './signals.js';

/**
 * La collecte d'une entreprise, du premier appel a l'accueil au rapport
 * (section 6.4). Tout passe par le client poli : robots.txt et la file par
 * domaine s'appliquent a chaque page, sans exception possible ici.
 *
 * Le moteur ne touche pas la base : il rend un rapport, que l'etape du
 * pipeline enregistre. On peut ainsi le tester sur le jeu de sites local, page
 * par page, sans rien d'autre.
 */

export type CrawlNote =
  'robots_disallowed' | 'masked_address' | 'dynamic_content' | 'contact_form' | 'unreachable';

export interface CrawlInput {
  /** Domaine confirme de l'entreprise. */
  readonly domain: string;
  readonly websiteUrl?: string;
  readonly careersUrl?: string;
  readonly depth: CrawlDepth;
}

export interface CrawledAddress {
  readonly address: string;
  readonly normalized: string;
  readonly method: ExtractionMethod;
  readonly excerpt: string;
  /** L'URL exacte de la page ou l'adresse figure, apres redirections (F-411). */
  readonly pageUrl: string;
}

export interface CrawledPage {
  readonly url: string;
  readonly outcome: 'read' | 'disallowed' | 'failed';
  readonly reason?: string;
}

export interface CrawlReport {
  readonly pages: CrawledPage[];
  readonly addresses: CrawledAddress[];
  readonly notes: CrawlNote[];
  readonly contactFormUrl?: string;
  readonly careersUrl?: string;
  readonly phone?: string;
  readonly linkedinUrl?: string;
}

/** Le point de depart : le site donne par l'import s'il est bien sur le domaine. */
function depart(input: CrawlInput): URL[] {
  const racine = [new URL(`https://${input.domain}/`), new URL(`http://${input.domain}/`)];
  if (input.websiteUrl === undefined) return racine;
  try {
    const site = new URL(input.websiteUrl);
    if (registrableDomain(site.hostname) === registrableDomain(input.domain)) {
      return [site, ...racine];
    }
  } catch {
    // Adresse de site illisible : on part de la racine du domaine.
  }
  return racine;
}

export async function crawlCompany(client: CrawlerClient, input: CrawlInput): Promise<CrawlReport> {
  const pages: CrawledPage[] = [];
  const lues: ParsedPage[] = [];
  const notes = new Set<CrawlNote>();
  const tentees = new Set<string>();
  const plafond = MAX_PAGES[input.depth];

  const visiter = async (url: URL): Promise<ParsedPage | undefined> => {
    tentees.add(pageKey(url));
    const issue = await client.get(url.toString());
    if (issue.kind === 'disallowed') {
      notes.add(issue.because === 'robots' ? 'robots_disallowed' : 'unreachable');
      pages.push({ url: url.toString(), outcome: 'disallowed' });
      return undefined;
    }
    if (issue.kind === 'failed') {
      pages.push({ url: url.toString(), outcome: 'failed', reason: issue.reason });
      return undefined;
    }
    const finale = new URL(issue.page.url);
    tentees.add(pageKey(finale));
    if (issue.page.status >= 400) {
      pages.push({
        url: finale.toString(),
        outcome: 'failed',
        reason: `HTTP ${String(issue.page.status)}`,
      });
      return undefined;
    }
    pages.push({ url: finale.toString(), outcome: 'read' });
    const lue = parsePage(issue.page.body, finale);
    lues.push(lue);
    return lue;
  };

  // L'accueil, en https puis en http : beaucoup de petits sites n'ont encore
  // que l'un des deux.
  let accueil: ParsedPage | undefined;
  const essayees = new Set<string>();
  for (const url of depart(input)) {
    // Comparees sur l'URL entiere, protocole compris : la cle de page ignore
    // le protocole, et http ne serait jamais essaye apres https.
    if (essayees.has(url.href)) continue;
    essayees.add(url.href);
    accueil = await visiter(url);
    // Un site qui a repondu, meme pour refuser, n'est pas retente sur un
    // autre protocole : seul un echec de connexion le justifie.
    if (accueil !== undefined || pages.at(-1)?.outcome === 'disallowed') break;
  }

  if (accueil === undefined) {
    // Une seule raison, la vraie : interdit par le site, ou injoignable.
    if (notes.has('robots_disallowed')) notes.delete('unreachable');
    else notes.add('unreachable');
    return { pages, addresses: [], notes: [...notes] };
  }

  const site = accueil.url;
  let careers: URL | undefined;
  if (input.careersUrl !== undefined) {
    try {
      careers = new URL(input.careersUrl);
    } catch {
      careers = undefined;
    }
  }

  for (const url of selectPages({
    site,
    links: accueil.links,
    depth: input.depth,
    visited: new Set([pageKey(site)]),
    ...(careers === undefined ? {} : { careersUrl: careers }),
  })) {
    if (tentees.size >= plafond) break;
    if (tentees.has(pageKey(url))) continue;
    await visiter(url);
  }

  if (input.depth === 'deep') {
    const liens: PageLink[] = lues.flatMap((lue) => [...lue.links]);
    for (const url of selectInternalLinks({
      site,
      links: liens,
      visited: tentees,
      limit: plafond - tentees.size,
    })) {
      if (tentees.size >= plafond) break;
      await visiter(url);
    }
  }

  // Les domaines que l'entreprise declare elle-meme : ceux des adresses de ses
  // mentions legales, et celui de son site s'il a redirige ailleurs.
  const extractions = lues.map((lue) => ({
    lue,
    extraction: extractAddresses(lue),
    signaux: pageSignals(lue),
  }));
  const confirmes = new Set<string>([registrableDomain(site.hostname)]);
  for (const { extraction, signaux } of extractions) {
    if (!signaux.legalNotice) continue;
    for (const trouvee of extraction.found) {
      const domaine = trouvee.normalized.split('@')[1];
      if (domaine !== undefined) confirmes.add(domaine);
    }
  }

  const addresses: CrawledAddress[] = [];
  let contactFormUrl: string | undefined;
  let careersUrl: string | undefined;
  let phone: string | undefined;
  let linkedinUrl: string | undefined;

  for (const { lue, extraction, signaux } of extractions) {
    if (extraction.masked) notes.add('masked_address');
    if (signaux.dynamicContent) notes.add('dynamic_content');
    if (signaux.contactForm) {
      notes.add('contact_form');
      contactFormUrl ??= lue.url.toString();
    }
    careersUrl ??= signaux.careersUrl?.toString();
    phone ??= signaux.phone;
    linkedinUrl ??= signaux.linkedinUrl;

    const { kept } = filterAddresses(extraction.found, {
      companyDomain: input.domain,
      confirmedDomains: confirmes,
    });
    for (const trouvee of kept) addresses.push({ ...trouvee, pageUrl: lue.url.toString() });
  }

  return {
    pages,
    addresses,
    notes: [...notes],
    ...(contactFormUrl === undefined ? {} : { contactFormUrl }),
    ...(careersUrl === undefined ? {} : { careersUrl }),
    ...(phone === undefined ? {} : { phone }),
    ...(linkedinUrl === undefined ? {} : { linkedinUrl }),
  };
}
