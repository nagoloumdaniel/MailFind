-- Les deux premieres tables : qui utilise le produit, et ce qui a ete fait.
--
-- uuidv7() plutot que gen_random_uuid() : les identifiants sont ordonnes dans
-- le temps, donc les insertions se font en fin d'index au lieu de disperser
-- les ecritures. La difference est negligeable ici et decisive sur `emails` et
-- `email_sources`, qui suivront la meme regle. Disponible depuis PostgreSQL 18.

create table users (
  id                uuid primary key default uuidv7(),
  google_id         text not null unique,
  email             text not null,
  name              text,
  terms_version     text,
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table users is
  'Comptes. La suppression demandee par la personne est definitive (R-05) ; deleted_at ne marque que l''effacement en cours.';
comment on column users.google_id is
  'Identifiant stable rendu par Google. Seul lien d''authentification : MailFind ne stocke aucun mot de passe.';
comment on column users.terms_version is
  'Version des conditions acceptee (F-102). Nul tant que la premiere connexion n''a pas ete confirmee.';

-- Une adresse identifie un compte vivant. Un compte en cours d'effacement
-- libere la sienne, pour qu'une reinscription reste possible.
create unique index users_email_unique on users (lower(email)) where deleted_at is null;

create table audit_events (
  id         uuid primary key default uuidv7(),
  user_id    uuid references users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table audit_events is
  'Journal d''audit, conserve 12 mois (R-06).';
comment on column audit_events.user_id is
  'Mis a nul quand le compte est supprime : l''evenement de suppression doit survivre a la personne qu''il concerne, sans la designer.';
comment on column audit_events.metadata is
  'Jamais d''adresse email en clair ni de secret (S-03). Des identifiants et des comptes, rien qui identifie une personne exterieure.';

create index audit_events_user_created_idx on audit_events (user_id, created_at desc);

-- Sert la purge par anciennete (R-06), qui balaie par date sans filtre d'utilisateur.
create index audit_events_created_idx on audit_events (created_at);
