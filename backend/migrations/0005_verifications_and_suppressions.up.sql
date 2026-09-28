-- Verification des adresses, liste de suppression et score (Phase 5).

-- F-703 : chaque verification est gardee, avec son niveau, son statut, son
-- motif et son fournisseur. L'historique n'est jamais ecrase : il dit
-- pourquoi une adresse a le statut qu'elle a.
create table verifications (
  id            uuid primary key default uuidv7(),
  email_id      uuid not null references emails (id) on delete cascade,
  -- Niveau le plus eleve atteint (section 6.7) : 1 a 7 en local, 8 chez le
  -- fournisseur.
  level         smallint not null,
  status        email_status not null,
  sub_status    text,
  reason        text not null,
  provider      text,
  -- Reference de la reponse du fournisseur, jamais la reponse elle-meme.
  raw_reference text,
  verified_at   timestamptz not null default now(),

  constraint verifications_level_range check (level between 1 and 8),
  constraint verifications_provider_for_level_8 check (level < 8 or provider is not null)
);

create index verifications_email_idx on verifications (email_id, verified_at desc);

-- R-04 : une adresse que l'utilisateur ne veut plus jamais voir collectee ni
-- transmise. Seule son empreinte est gardee : la liste de suppression ne doit
-- pas devenir, elle-meme, une liste d'adresses.
create table suppressions (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references users (id) on delete cascade,
  address_hash text not null,
  reason       text,
  source       text not null default 'user',
  created_at   timestamptz not null default now(),

  constraint suppressions_hash_shape check (address_hash ~ '^[0-9a-f]{64}$'),
  constraint suppressions_unique unique (user_id, address_hash)
);

-- Niveau 4 : domaines jetables, d'apres une liste publique rechargee chaque
-- semaine.
create table disposable_domains (
  domain     text primary key,
  updated_at timestamptz not null default now()
);

-- 6.9 : le detail du score, critere par critere, tel qu'il a ete calcule.
-- L'interface l'affiche au survol : le garder evite de le recalculer
-- autrement qu'il ne l'a ete.
alter table emails add column score_breakdown jsonb;
