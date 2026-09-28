-- Appels aux fournisseurs payants : comptes, mis en cache, plafonnes (section
-- 8.4 du cahier des charges, regle non negociable du depot).

create type provider_call_status as enum (
  'reserved',   -- credit reserve, appel en cours ou interrompu
  'confirmed',  -- appel fait, credit consomme
  'cached',     -- repondu par le cache, aucun credit consomme
  'failed'      -- le fournisseur a refuse ou n'a pas repondu
);

create table provider_calls (
  id              uuid primary key default uuidv7(),
  -- Nul si le compte est supprime : le compteur global du mois doit garder
  -- ce qui a ete depense, sinon supprimer un compte rendrait des credits.
  user_id         uuid references users (id) on delete set null,
  import_id       uuid references imports (id) on delete set null,
  company_id      uuid references companies (id) on delete set null,
  provider        text not null,
  operation       text not null,
  -- Derivee de l'import, de l'entreprise et de l'operation : une tache
  -- rejouee retombe sur la meme ligne et ne reserve pas une seconde fois.
  idempotency_key text not null,
  credits         numeric(6, 2) not null default 1,
  status          provider_call_status not null default 'reserved',
  error           text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,

  constraint provider_calls_idempotency unique (idempotency_key),
  constraint provider_calls_credits_positive check (credits >= 0)
);

create index provider_calls_provider_month_idx on provider_calls (provider, created_at);
create index provider_calls_user_month_idx on provider_calls (user_id, provider, created_at);

create table provider_cache (
  provider   text not null,
  operation  text not null,
  key        text not null,
  -- Pour la recherche web, seul le resultat deduit est garde (domaine et
  -- confiance), pas la reponse brute : il ne contient aucune donnee
  -- personnelle. Les reponses des fournisseurs d'enrichissement, qui en
  -- contiennent, seront chiffrees au repos (F-604, Phase 4).
  response   jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  primary key (provider, operation, key)
);
