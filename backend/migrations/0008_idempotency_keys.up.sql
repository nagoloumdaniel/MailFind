-- En-tete Idempotency-Key de l'API publique (Phase 7, F-1305).

-- Une creation envoyee deux fois sous la meme cle ne cree qu'une fois : la
-- seconde recoit la reponse de la premiere. La reponse est gardee 24 heures.
-- `status_code` nul : la premiere requete est encore en cours.
create table idempotency_keys (
  id            uuid primary key default uuidv7(),
  user_id       uuid not null references users (id) on delete cascade,
  key           text not null,
  -- Empreinte de la methode, du chemin et du corps : la meme cle pour une
  -- autre requete est une erreur du client, pas une repetition.
  request_hash  text not null,
  status_code   smallint,
  response_body jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint idempotency_keys_key_length check (char_length(key) between 1 and 255),
  constraint idempotency_keys_hash_shape check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint idempotency_keys_unique unique (user_id, key)
);

create index idempotency_keys_created_idx on idempotency_keys (created_at);
