import { getPool } from '../db/pool.js';
import { query } from '../db/pool.js';
import { normalizeAddress } from '../verification/local.js';
import { hashAddress } from './repository.js';

/**
 * Effacement a la demande de la personne concernee (A9, R-07).
 *
 * La liste de suppression d'un utilisateur ne vaut que pour lui. Quand c'est
 * la personne dont l'adresse a ete collectee qui demande, la portee est
 * autre : l'adresse part de tous les comptes, et ne peut plus etre collectee
 * par personne.
 *
 * L'effacement et l'interdiction vont ensemble, dans la meme transaction :
 * effacer sans interdire laisserait le prochain import la retrouver, ce qui
 * serait pire que de ne rien faire.
 */

export interface ErasureOutcome {
  /** Adresses reellement effacees, tous comptes confondus. */
  readonly erased: number;
  /** Vrai quand la demande avait deja ete faite. */
  readonly alreadyKnown: boolean;
}

export async function eraseAddressEverywhere(address: string): Promise<ErasureOutcome> {
  const normalisee = normalizeAddress(address);
  if (normalisee === undefined) return { erased: 0, alreadyKnown: false };
  const empreinte = hashAddress(normalisee);

  const client = await getPool().connect();
  try {
    await client.query('begin');

    const effacees = await client.query('delete from emails where normalized_address = $1', [
      normalisee,
    ]);
    const nombre = effacees.rowCount ?? 0;

    const notee = await client.query<{ deja: boolean }>(
      `insert into erased_addresses (address_hash, erased_count) values ($1, $2)
       on conflict (address_hash) do update
          set erased_count = erased_addresses.erased_count + excluded.erased_count
       returning (xmax <> 0) as deja`,
      [empreinte, nombre],
    );

    await client.query('commit');
    return { erased: nombre, alreadyKnown: notee.rows[0]?.deja === true };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Les empreintes effacees pour tout le monde. Chargees a la collecte et a
 * l'enrichissement, a cote de la liste du compte.
 */
export async function loadErasedHashes(): Promise<Set<string>> {
  const lues = await query<{ address_hash: string }>('select address_hash from erased_addresses');
  return new Set(lues.rows.map((ligne) => ligne.address_hash));
}
