-- Connexion croisee avec Campaign Mailer (D-26). MailFind, fournisseur
-- d'identite pour Campaign Mailer, emet un code a usage unique que Campaign
-- Mailer echange ensuite, de serveur a serveur, contre l'identite du compte.
--
-- Seule l'empreinte SHA-256 du code est gardee : 32 octets aleatoires ne se
-- devinent pas, et une base lue par un tiers ne livre aucun code utilisable.
-- Une minute de vie, un seul usage.
create table sso_codes (
  code_hash   text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid not null references users (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index sso_codes_expires_idx on sso_codes (expires_at);

comment on table sso_codes is
  'Codes de connexion croisee avec Campaign Mailer (D-26). Empreintes seulement, une minute, un usage.';
