import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { query } from '../db/pool.js';
import { AppError, PROBLEM_CONTENT_TYPE } from '../http/problem.js';
import { getLogger } from '../observability/logger.js';

/**
 * En-tete `Idempotency-Key` sur les creations de l'API publique (F-1305).
 *
 * Un client qui n'a pas recu la reponse (coupure, delai) renvoie sa requete
 * sous la meme cle : il recoit la reponse de la premiere, sans que rien soit
 * cree une seconde fois. La reponse est gardee 24 heures. Une erreur interne
 * (5xx) n'est pas gardee : la requete peut etre retentee pour de bon.
 */

const RETENTION = "interval '24 hours'";
const CLE_VALIDE = /^[\x21-\x7e]{1,255}$/;

interface Ligne {
  request_hash: string;
  status_code: number | null;
  response_body: unknown;
}

function empreinte(methode: string, chemin: string, corps: unknown): string {
  return createHash('sha256')
    .update(`${methode} ${chemin}\n${JSON.stringify(corps ?? null)}`, 'utf8')
    .digest('hex');
}

function rejouer(res: Response, ligne: Ligne & { status_code: number }): void {
  res.setHeader('Idempotent-Replayed', 'true');
  res.status(ligne.status_code);
  if (ligne.status_code >= 400) res.type(PROBLEM_CONTENT_TYPE);
  res.json(ligne.response_body);
}

export function idempotency(
  options: {
    /**
     * Chemins dont la reponse porte un secret montre une seule fois : la
     * garder 24 heures le stockerait en clair (S-01). L'en-tete y est ignore.
     */
    readonly except?: readonly string[];
  } = {},
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const cle = req.get('idempotency-key');
        const user = req.currentUser;
        if (
          req.method !== 'POST' ||
          cle === undefined ||
          user === undefined ||
          options.except?.includes(req.path) === true
        ) {
          next();
          return;
        }
        if (!CLE_VALIDE.test(cle)) {
          throw AppError.badRequest(
            'invalid_idempotency_key',
            'Idempotency-Key refusee',
            'De 1 a 255 caracteres ASCII visibles, par exemple un UUID.',
          );
        }
        const hash = empreinte(req.method, req.originalUrl, req.body);

        // Une cle de plus de 24 heures est oubliee : elle peut resservir.
        await query(
          `delete from idempotency_keys
            where user_id = $1 and key = $2 and created_at < now() - ${RETENTION}`,
          [user.id, cle],
        );
        const prise = await query<{ id: string }>(
          `insert into idempotency_keys (user_id, key, request_hash)
           values ($1, $2, $3)
           on conflict (user_id, key) do nothing
           returning id`,
          [user.id, cle, hash],
        );
        const id = prise.rows[0]?.id;

        if (id === undefined) {
          const existante = await query<Ligne>(
            `select request_hash, status_code, response_body
               from idempotency_keys where user_id = $1 and key = $2`,
            [user.id, cle],
          );
          const ligne = existante.rows[0];
          if (ligne !== undefined && ligne.request_hash !== hash) {
            throw new AppError({
              status: 422,
              code: 'idempotency_key_reused',
              title: 'Idempotency-Key deja utilisee',
              detail: 'Cette cle a servi pour une autre requete. Prenez-en une nouvelle.',
            });
          }
          const statut = ligne?.status_code ?? null;
          if (ligne === undefined || statut === null) {
            res.setHeader('Retry-After', '1');
            throw new AppError({
              status: 409,
              code: 'idempotency_key_in_progress',
              title: 'Requete encore en cours',
              detail: "La premiere requete sous cette cle n'est pas terminee. Reessayez.",
            });
          }
          rejouer(res, { ...ligne, status_code: statut });
          return;
        }

        // La reponse est gardee avant d'etre envoyee : un client qui la recoit
        // et renvoie aussitot sous la meme cle la retrouve, au lieu d'un 409.
        let reglee = false;
        const envoyer = res.json.bind(res);
        res.json = ((corps: unknown) => {
          reglee = true;
          const statut = res.statusCode;
          const garder =
            statut >= 500
              ? query('delete from idempotency_keys where id = $1', [id])
              : query(
                  `update idempotency_keys
                      set status_code = $2, response_body = $3::jsonb, completed_at = now()
                    where id = $1`,
                  [id, statut, JSON.stringify(corps ?? null)],
                );
          garder
            .catch((error: unknown) => {
              getLogger().error({ err: error }, 'reponse idempotente non gardee');
            })
            .finally(() => {
              envoyer(corps);
            });
          return res;
        }) as Response['json'];
        // Une reponse qui n'est pas passee par json (connexion coupee) libere
        // la cle : sinon elle resterait « en cours » pendant 24 heures.
        res.on('close', () => {
          if (!reglee) {
            query('delete from idempotency_keys where id = $1 and status_code is null', [id]).catch(
              () => undefined,
            );
          }
        });
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** Entretien quotidien : les cles de plus de 24 heures ne servent plus. */
export async function purgeExpiredIdempotencyKeys(): Promise<number> {
  const resultat = await query(
    `delete from idempotency_keys where created_at < now() - ${RETENTION}`,
  );
  return resultat.rowCount ?? 0;
}
