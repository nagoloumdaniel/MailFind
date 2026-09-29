import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Le jeu de sites servis localement pour la suite de tests du moteur (13.1).
 *
 * Chaque dossier voisin porte le nom d'un hote, `acme.test` par exemple, et
 * contient les pages de ce site. Le serveur choisit le dossier d'apres
 * l'en-tete Host : le client de collecte, aiguille vers lui par `testRouting`,
 * croit parler a https://acme.test/.
 *
 * Quelques chemins simulent ce qu'un dossier de fichiers ne sait pas faire :
 * une page qui n'en finit pas, une page trop grosse, une redirection, un site
 * en Windows-1252. Chaque requete est notee, pour qu'un test puisse prouver
 * qu'une page interdite n'a jamais ete demandee.
 */

const RACINE = fileURLToPath(new URL('.', import.meta.url));

export interface SiteRequest {
  readonly host: string;
  readonly path: string;
  readonly userAgent: string;
  readonly at: number;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Le corps d'un POST, pour qu'un test de webhook verifie ce qui a ete signe. */
  readonly body: string;
}

export interface TestSites {
  readonly port: number;
  readonly hosts: readonly string[];
  readonly requests: SiteRequest[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

function hoteDe(req: IncomingMessage): string {
  return (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
}

async function lireFichier(hote: string, chemin: string): Promise<[Buffer, string] | undefined> {
  // `normalize` et le controle du prefixe empechent un « ../ » de sortir du
  // dossier du site : meme en test, un serveur de fichiers ne sert que les siens.
  const base = join(RACINE, hote);
  const candidats =
    chemin === '/' ? ['/index.html'] : [chemin, `${chemin}.html`, `${chemin}/index.html`];
  for (const candidat of candidats) {
    const fichier = normalize(join(base, candidat));
    if (!fichier.startsWith(base)) return undefined;
    try {
      const contenu = await readFile(fichier);
      const extension = /\.[a-z]+$/.exec(fichier)?.[0] ?? '.html';
      return [contenu, TYPES[extension] ?? 'application/octet-stream'];
    } catch {
      // Candidat suivant.
    }
  }
  return undefined;
}

async function servir(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const hote = hoteDe(req);

  switch (url.pathname) {
    case '/__lent': {
      // Un octet toutes les 300 millisecondes, sans fin : chaque paquet
      // remet a zero un delai d'inactivite, seul un delai global l'arrete.
      res.writeHead(200, { 'content-type': 'text/html' });
      const minuterie = setInterval(() => res.write('.'), 300);
      res.on('close', () => clearInterval(minuterie));
      return;
    }
    case '/__enorme': {
      res.writeHead(200, { 'content-type': 'text/html' });
      const bloc = Buffer.alloc(64 * 1024, 'a');
      for (let i = 0; i < 48; i += 1) res.write(bloc); // 3 Mo
      res.end();
      return;
    }
    case '/__redirection': {
      res.writeHead(302, { location: url.searchParams.get('vers') ?? '/' });
      res.end();
      return;
    }
    case '/__pause': {
      const ms = Number(url.searchParams.get('ms') ?? '200');
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<p>apres la pause</p>');
      }, ms);
      return;
    }
    case '/__latin1': {
      res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' });
      res.end(Buffer.from('<p>Soci\xe9t\xe9 G\xe9n\xe9rale : contact@acme.test</p>', 'latin1'));
      return;
    }
    case '/__erreur': {
      res.writeHead(Number(url.searchParams.get('code') ?? '500'));
      res.end();
      return;
    }
    default:
  }

  // Un site peut simuler un robots.txt en panne : son dossier porte alors un
  // fichier « robots.status » qui contient le code a rendre.
  if (url.pathname === '/robots.txt') {
    const etat = await lireFichier(hote, '/robots.status');
    if (etat !== undefined) {
      res.writeHead(Number(etat[0].toString('utf8').trim()));
      res.end();
      return;
    }
  }

  const trouve = await lireFichier(hote, decodeURIComponent(url.pathname));
  if (trouve === undefined) {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Introuvable</h1>');
    return;
  }
  res.writeHead(200, { 'content-type': trouve[1] });
  res.end(trouve[0]);
}

export async function startTestSites(hosts: readonly string[]): Promise<TestSites> {
  const requests: SiteRequest[] = [];
  const serveur = createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on('data', (morceau: Buffer) => morceaux.push(morceau));
    req.on('end', () => {
      requests.push({
        host: hoteDe(req),
        path: req.url ?? '/',
        userAgent: req.headers['user-agent'] ?? '',
        at: Date.now(),
        method: req.method ?? 'GET',
        headers: req.headers,
        body: Buffer.concat(morceaux).toString('utf8'),
      });
      servir(req, res).catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
  });

  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const { port } = serveur.address() as AddressInfo;

  return {
    port,
    hosts,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        serveur.closeAllConnections();
        serveur.close(() => {
          resolve();
        });
      }),
  };
}
