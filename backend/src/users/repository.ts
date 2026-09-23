import { query } from '../db/pool.js';

export interface User {
  readonly id: string;
  readonly googleId: string;
  readonly email: string;
  readonly name: string | null;
  readonly termsVersion: string | null;
  readonly termsAcceptedAt: Date | null;
  readonly createdAt: Date;
}

interface UserRow {
  id: string;
  google_id: string;
  email: string;
  name: string | null;
  terms_version: string | null;
  terms_accepted_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
  };
}

export interface GoogleIdentity {
  readonly googleId: string;
  readonly email: string;
  readonly name: string | null;
}

export interface SignInResult {
  readonly user: User;
  readonly created: boolean;
}

/**
 * Retrouve le compte lie a cette identite Google, ou le cree.
 *
 * L'adresse est rangee en minuscules : Google la rend telle qu'affichee, et
 * l'index d'unicite porte sur `lower(email)`. Le nom et l'adresse sont
 * rafraichis a chaque connexion, parce qu'ils peuvent changer chez Google et
 * que c'est lui la source.
 */
export async function signInWithGoogle(identity: GoogleIdentity): Promise<SignInResult> {
  const result = await query<UserRow & { inserted: boolean }>(
    `insert into users (google_id, email, name)
     values ($1, $2, $3)
     on conflict (google_id) do update
       set email = excluded.email,
           name = excluded.name,
           updated_at = now()
     returning *, (xmax = 0) as inserted`,
    [identity.googleId, identity.email.toLowerCase(), identity.name],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("La connexion n'a produit aucun compte.");
  }

  // Un compte en cours d'effacement ne se reveille pas par une connexion :
  // l'effacement demande doit aller jusqu'au bout (R-05).
  if (row.deleted_at !== null) {
    throw new Error('Ce compte est en cours de suppression.');
  }

  return { user: toUser(row), created: row.inserted };
}

export async function findUserById(id: string): Promise<User | undefined> {
  const result = await query<UserRow>('select * from users where id = $1 and deleted_at is null', [
    id,
  ]);
  const row = result.rows[0];
  return row === undefined ? undefined : toUser(row);
}

/** Enregistre l'acceptation d'une version des conditions (F-102). */
export async function acceptTerms(userId: string, version: string): Promise<User | undefined> {
  const result = await query<UserRow>(
    `update users
        set terms_version = $2, terms_accepted_at = now(), updated_at = now()
      where id = $1 and deleted_at is null
      returning *`,
    [userId, version],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toUser(row);
}
