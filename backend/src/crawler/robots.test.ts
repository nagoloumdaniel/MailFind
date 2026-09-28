import { describe, expect, it } from 'vitest';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, productToken } from './robots.js';

const TOKEN = 'mailfindbot';

describe('parseRobots (RFC 9309)', () => {
  it('applique le groupe qui nomme MailFind plutot que le groupe general', () => {
    const regles = parseRobots(
      `User-agent: *
Disallow: /prive

User-agent: MailFindBot
Disallow: /interdit
Allow: /interdit/public`,
      TOKEN,
    );

    expect(regles.isAllowed('/interdit')).toBe(false);
    expect(regles.isAllowed('/interdit/page')).toBe(false);
    expect(regles.isAllowed('/interdit/public')).toBe(true);
    // Le groupe general ne s'applique plus des qu'un groupe nous nomme.
    expect(regles.isAllowed('/prive')).toBe(true);
  });

  it('se rabat sur le groupe general quand personne ne nous nomme', () => {
    const regles = parseRobots(
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin',
      TOKEN,
    );
    expect(regles.isAllowed('/')).toBe(true);
    expect(regles.isAllowed('/admin/x')).toBe(false);
  });

  it('autorise tout sans groupe applicable', () => {
    const regles = parseRobots('User-agent: Googlebot\nDisallow: /', TOKEN);
    expect(regles.isAllowed('/contact')).toBe(true);
  });

  it('compare le nom de l agent sans tenir compte de la casse', () => {
    const regles = parseRobots('user-agent: mailfindbot\ndisallow: /', TOKEN);
    expect(regles.isAllowed('/contact')).toBe(false);
  });

  it('fusionne les groupes qui nomment le meme agent', () => {
    const regles = parseRobots(
      'User-agent: MailFindBot\nDisallow: /a\n\nUser-agent: Autre\nDisallow: /\n\nUser-agent: MailFindBot\nDisallow: /b',
      TOKEN,
    );
    expect(regles.isAllowed('/a')).toBe(false);
    expect(regles.isAllowed('/b')).toBe(false);
    expect(regles.isAllowed('/c')).toBe(true);
  });

  it('partage les regles entre agents consecutifs du meme groupe', () => {
    const regles = parseRobots('User-agent: Autre\nUser-agent: MailFindBot\nDisallow: /x', TOKEN);
    expect(regles.isAllowed('/x')).toBe(false);
  });

  it('retient la regle la plus longue, et l autorisation a egalite', () => {
    const regles = parseRobots(
      'User-agent: *\nDisallow: /page\nAllow: /page\nDisallow: /dossier/\nAllow: /dossier/page',
      TOKEN,
    );
    expect(regles.isAllowed('/page')).toBe(true);
    expect(regles.isAllowed('/dossier/autre')).toBe(false);
    expect(regles.isAllowed('/dossier/page.html')).toBe(true);
  });

  it('comprend * et $', () => {
    const regles = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache', TOKEN);
    expect(regles.isAllowed('/doc/plaquette.pdf')).toBe(false);
    expect(regles.isAllowed('/doc/plaquette.pdf?v=2')).toBe(true);
    expect(regles.isAllowed('/tmp123/cache/x')).toBe(false);
    expect(regles.isAllowed('/contact')).toBe(true);
  });

  it('ignore une interdiction vide et les commentaires', () => {
    const regles = parseRobots('# commentaire\nUser-agent: * # tout le monde\nDisallow:\n', TOKEN);
    expect(regles.isAllowed('/')).toBe(true);
  });

  it('laisse toujours lire robots.txt lui-meme', () => {
    expect(parseRobots('User-agent: *\nDisallow: /', TOKEN).isAllowed('/robots.txt')).toBe(true);
  });

  it('interdit tout avec Disallow: /', () => {
    const regles = parseRobots('User-agent: *\nDisallow: /', TOKEN);
    expect(regles.isAllowed('/')).toBe(false);
    expect(regles.isAllowed('/contact')).toBe(false);
  });

  it('releve un delai entre requetes, borne', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 3', TOKEN).crawlDelayMs).toBe(3000);
    expect(parseRobots('User-agent: *\nCrawl-delay: 600', TOKEN).crawlDelayMs).toBe(10_000);
    expect(parseRobots('User-agent: *\nCrawl-delay: abc', TOKEN).crawlDelayMs).toBeUndefined();
  });

  it('compare les chemins sous leur forme encodee', () => {
    const regles = parseRobots('User-agent: *\nDisallow: /café', TOKEN);
    expect(regles.isAllowed('/caf%C3%A9')).toBe(false);
  });

  it('ignore ce qui depasse 500 Kio', () => {
    const remplissage = `# ${'x'.repeat(600 * 1024)}\n`;
    const regles = parseRobots(`User-agent: *\n${remplissage}Disallow: /tard`, TOKEN);
    expect(regles.isAllowed('/tard')).toBe(true);
  });
});

describe('regles toutes faites', () => {
  it('ALLOW_ALL et DISALLOW_ALL', () => {
    expect(ALLOW_ALL.isAllowed('/x')).toBe(true);
    expect(DISALLOW_ALL.isAllowed('/x')).toBe(false);
    expect(DISALLOW_ALL.isAllowed('/robots.txt')).toBe(true);
  });
});

describe('productToken', () => {
  it('extrait le nom de l agent, sans version ni commentaire', () => {
    expect(productToken('MailFindBot/0.1 (+https://mailfind.app/bot)')).toBe('mailfindbot');
  });
});
