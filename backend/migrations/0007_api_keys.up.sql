-- Cles de l'API publique (Phase 7, F-1302, F-1303, S-02).

-- Une cle n'est jamais gardee en clair : seule son empreinte SHA-256 l'est,
-- et un prefixe affichable pour la reconnaitre. La cle tiree au hasard a
-- 256 bits d'entropie : une empreinte rapide suffit, un hachage lent ne
-- protegerait rien de plus et couterait a chaque requete.
create table api_keys (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references users (id) on delete cascade,
  name         text not null,
  prefix       text not null,
  key_hash     text not null,
  scopes       text[] not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),

  constraint api_keys_name_length check (char_length(name) between 1 and 100),
  constraint api_keys_prefix_shape check (prefix ~ '^mf_[A-Za-z0-9_-]{8}$'),
  constraint api_keys_hash_shape check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_keys_hash_unique unique (key_hash),
  -- F-1303 : une portee au moins, et seulement des portees connues.
  constraint api_keys_scopes_known check (
    cardinality(scopes) >= 1
    and scopes <@ array['companies:read', 'companies:write', 'emails:read', 'imports:write',
                        'verify', 'exports:write', 'integrations:write']::text[]
  )
);

create index api_keys_user_idx on api_keys (user_id, created_at desc);
