-- Connexion a Campaign Mailer (Phase 7, F-1201, S-01).

-- Le jeton d'integration personnel qu'un utilisateur cree dans Campaign
-- Mailer. Il est chiffre au repos : il doit etre relu pour appeler l'API de
-- Campaign Mailer, une empreinte ne suffirait pas. Un prefixe affichable le
-- fait reconnaitre dans la page Compte. Une connexion par compte.
create table campaign_mailer_connections (
  user_id         uuid primary key references users (id) on delete cascade,
  token_encrypted text not null,
  token_prefix    text not null,
  connected_at    timestamptz not null default now(),
  last_used_at    timestamptz,

  constraint campaign_mailer_connections_prefix_shape check (token_prefix ~ '^cm_[A-Za-z0-9_-]{8}$')
);
