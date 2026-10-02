import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Un Campaign Mailer d'emprunt, fidele a son contrat, pour le parcours de
 * bout en bout.
 *
 * Le vrai Campaign Mailer est une autre application en ligne : le parcours ne
 * peut pas en dependre. Ce serveur tient les deux routes que MailFind appelle,
 * avec ce qui compte vraiment : il **exige** la cle d'idempotence, et rend la
 * meme reponse pour la meme cle, sans rien recreer. Un envoi rejoue ne doit
 * produire aucun doublon, et c'est ici que cela se verifie.
 */

export interface FakeCampaignMailer {
  readonly url: string;
  /** Les contacts recus, dans l'ordre, doublons compris s'il y en avait. */
  readonly contacts: { email: string; source_url?: string }[];
  /** Les cles d'idempotence vues, pour prouver qu'elles sont toutes distinctes. */
  readonly keys: string[];
  close(): Promise<void>;
}

const JETON = `cm_${'e'.repeat(43)}`;

export async function startFakeCampaignMailer(): Promise<FakeCampaignMailer> {
  const contacts: { email: string; source_url?: string }[] = [];
  const keys: string[] = [];
  /** Ce qui a deja ete repondu, par cle : l'idempotence, vue de l'autre cote. */
  const dejaVu = new Map<string, unknown>();
  let campagnes = 0;

  const serveur: Server = createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on('data', (morceau: Buffer) => morceaux.push(morceau));
    req.on('end', () => {
      const repondre = (status: number, corps: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corps));
      };

      if (req.headers.authorization !== `Bearer ${JETON}`) {
        repondre(401, { error: 'Token refused', code: 'invalid_token' });
        return;
      }
      const cle = req.headers['idempotency-key'];
      if (typeof cle !== 'string' || cle === '') {
        repondre(400, { error: 'Idempotency-Key required', code: 'idempotency_key_required' });
        return;
      }
      keys.push(cle);

      const deja = dejaVu.get(cle);
      if (deja !== undefined) {
        repondre(200, deja);
        return;
      }

      const corps = JSON.parse(morceaux.join('') || '{}') as {
        name?: string;
        contacts?: { email: string; source_url?: string }[];
      };
      const recus = corps.contacts ?? [];
      contacts.push(...recus);
      if (req.url === '/api/v1/campaigns') campagnes += 1;

      const reponse = {
        campaign: {
          id: `campagne-${String(campagnes)}`,
          name: corps.name ?? 'Brouillon',
          // Un brouillon, toujours : seul l'utilisateur lance une campagne.
          status: 'draft',
          url: `http://campaign-mailer.test/campagnes/${String(campagnes)}`,
        },
        report: { read: recus.length, imported: recus.length, rejected: [] },
      };
      dejaVu.set(cle, reponse);
      repondre(req.url === '/api/v1/campaigns' ? 201 : 200, reponse);
    });
  });

  await new Promise<void>((resoudre) => {
    serveur.listen(0, '127.0.0.1', resoudre);
  });
  const port = (serveur.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    contacts,
    keys,
    close: () =>
      new Promise<void>((resoudre) => {
        serveur.close(() => {
          resoudre();
        });
      }),
  };
}

/** Le jeton que ce faux Campaign Mailer accepte, a coller dans la page Compte. */
export const FAKE_CAMPAIGN_MAILER_TOKEN = JETON;
