-- Webhooks de l'API publique (Phase 7, F-1308).

-- Un abonnement : une URL, les evenements voulus, et un secret de signature.
-- Le secret est chiffre au repos (S-01) : il doit etre relu pour signer, une
-- empreinte ne suffirait pas.
create table webhooks (
  id               uuid primary key default uuidv7(),
  user_id          uuid not null references users (id) on delete cascade,
  url              text not null,
  events           text[] not null,
  secret_encrypted text not null,
  secret_prefix    text not null,
  description      text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint webhooks_url_https check (url ~ '^https://'),
  constraint webhooks_url_length check (char_length(url) <= 2000),
  constraint webhooks_description_length check (description is null or char_length(description) <= 200),
  constraint webhooks_events_known check (
    cardinality(events) >= 1
    and events <@ array['import.completed', 'import.failed', 'verification.completed',
                        'export.ready']::text[]
  )
);

create index webhooks_user_idx on webhooks (user_id) where deleted_at is null;

create type webhook_delivery_status as enum ('pending', 'succeeded', 'failed');

-- Le journal des livraisons : une ligne par evenement et par abonnement, qui
-- garde chaque tentative (nombre, dernier code, derniere erreur). Le corps
-- envoye est garde tel quel : la signature porte sur lui, octet pour octet.
create table webhook_deliveries (
  id               uuid primary key default uuidv7(),
  webhook_id       uuid not null references webhooks (id) on delete cascade,
  event_id         uuid not null,
  event_type       text not null,
  payload          text not null,
  status           webhook_delivery_status not null default 'pending',
  attempts         smallint not null default 0,
  last_status_code smallint,
  last_error       text,
  created_at       timestamptz not null default now(),
  last_attempt_at  timestamptz,
  delivered_at     timestamptz,

  constraint webhook_deliveries_unique unique (webhook_id, event_id)
);

create index webhook_deliveries_webhook_idx on webhook_deliveries (webhook_id, created_at desc);
