-- Un import, ses lignes, et les entreprises qui en sortent.
--
-- Les statuts sont des types enumeres et non du texte libre : une faute de
-- frappe sur un statut doit echouer a l'ecriture, pas produire une ligne que
-- plus aucune requete ne retrouve.

create type import_status as enum (
  'pending',    -- recu, pas encore planifie
  'planning',   -- normalisation et dedoublonnage en cours
  'running',    -- entreprises en cours de traitement
  'cancelled',  -- arrete par l'utilisateur (F-205)
  'completed',
  'failed'
);

create type import_row_status as enum (
  'pending',
  'accepted',   -- a produit ou rejoint une entreprise
  'rejected',   -- inexploitable, avec son motif (F-202)
  'duplicate'   -- rattachee a une entreprise deja connue (F-303)
);

create type crawl_status as enum ('pending', 'running', 'done', 'failed', 'skipped');

-- Etat du domaine d'une entreprise. « to_confirm » existe parce que la
-- recherche du site officiel rend un indice de confiance, et qu'en dessous du
-- seuil c'est l'utilisateur qui tranche (F-305).
create type domain_status as enum ('unknown', 'provided', 'confirmed', 'to_confirm');

create table imports (
  id                uuid primary key default uuidv7(),
  user_id           uuid not null references users (id) on delete cascade,
  filename          text not null,
  storage_key       text,
  settings          jsonb not null default '{}'::jsonb,
  total_rows        integer not null default 0,
  processed_rows    integer not null default 0,
  status            import_status not null default 'pending',
  estimated_credits integer not null default 0,
  used_credits      integer not null default 0,
  error             text,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz,

  constraint imports_rows_positive check (total_rows >= 0 and processed_rows >= 0),
  constraint imports_progress_within_total check (processed_rows <= total_rows),
  constraint imports_credits_positive check (estimated_credits >= 0 and used_credits >= 0)
);

comment on column imports.storage_key is
  'Fichier d''origine dans R2. Nul tant qu''il n''y est pas, ou une fois purge.';
comment on column imports.settings is
  'Profondeur, types recherches, fournisseurs autorises, etiquettes (etape 4 du parcours).';
comment on column imports.used_credits is
  'Credits fournisseurs reellement consommes. Renseigne par la confirmation qui suit chaque appel paye, jamais par l''estimation.';

create index imports_user_created_idx on imports (user_id, created_at desc);

create table companies (
  id                uuid primary key default uuidv7(),
  user_id           uuid not null references users (id) on delete cascade,

  -- Le nom tel qu'il s'affiche, et le nom reduit pour comparer. Les deux, car
  -- ecraser l'un par l'autre perdrait soit la lisibilite, soit le
  -- dedoublonnage (F-302).
  name              text not null,
  normalized_name   text not null,
  legal_name        text,

  domain            text,
  domain_status     domain_status not null default 'unknown',
  domain_confidence smallint,
  website_url       text,
  careers_url       text,

  siren             text,
  city              text,
  country           text,
  industry          text,
  employee_range    text,
  linkedin_url      text,
  phone             text,
  contact_form_url  text,

  crawl_status      crawl_status not null default 'pending',
  tags              text[] not null default '{}',
  notes             text,

  -- Colonnes du CSV que MailFind ne connait pas : gardees telles quelles et
  -- rendues a l'export (F-204).
  attributes        jsonb not null default '{}'::jsonb,

  last_enriched_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint companies_domain_confidence_range
    check (domain_confidence is null or (domain_confidence between 0 and 100)),
  constraint companies_siren_shape
    check (siren is null or siren ~ '^[0-9]{9}$')
);

comment on table companies is
  'Bibliotheque d''un utilisateur. Aucune entreprise n''est visible d''un autre compte (F-103).';

-- Dedoublonnage, dans l'ordre du cahier des charges (F-303). Trois index
-- partiels plutot qu'un seul : chaque cle ne vaut que quand elle est connue, et
-- c'est la base qui garantit qu'un doublon ne peut pas etre cree, pas le code
-- qui y pense.
create unique index companies_user_domain_key
  on companies (user_id, domain) where domain is not null;

create unique index companies_user_siren_key
  on companies (user_id, siren) where siren is not null;

-- Dernier recours, quand ni domaine ni SIREN ne sont connus : le nom normalise
-- et la ville.
create unique index companies_user_name_city_key
  on companies (user_id, normalized_name, coalesce(lower(city), ''))
  where domain is null and siren is null;

create index companies_user_created_idx on companies (user_id, created_at desc);
create index companies_crawl_status_idx on companies (crawl_status) where crawl_status = 'pending';

create table import_rows (
  id         uuid primary key default uuidv7(),
  import_id  uuid not null references imports (id) on delete cascade,
  line       integer not null,
  raw        jsonb not null,
  -- Mis a nul si l'entreprise est supprimee : la ligne d'origine reste, elle
  -- dit ce que le fichier contenait.
  company_id uuid references companies (id) on delete set null,
  status     import_row_status not null default 'pending',
  error      text,
  created_at timestamptz not null default now(),

  constraint import_rows_line_positive check (line > 0),
  -- Une ligne de fichier ne peut exister qu'une fois par import. C'est ce qui
  -- rend la planification rejouable sans doublon apres une coupure (F-206).
  constraint import_rows_unique_line unique (import_id, line)
);

comment on column import_rows.raw is
  'La ligne telle qu''elle a ete lue, champs reconnus compris. Traitee comme hostile a l''affichage et a l''export (S-07).';

create index import_rows_import_status_idx on import_rows (import_id, status);
