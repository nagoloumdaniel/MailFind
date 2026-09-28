-- Les adresses trouvees, leurs sources, et les etapes du pipeline par
-- entreprise (Phase 3).

-- Section 6.8 du cahier des charges.
create type email_type as enum (
  'recruitment', 'hr', 'generic', 'sales', 'press', 'support', 'personal', 'unknown'
);

-- D'ou vient l'adresse. « found » : publiee sur le site de l'entreprise.
create type email_origin as enum ('found', 'provider', 'deduced', 'imported');

-- Section 6.7. « unverified » par defaut : une adresse trouvee n'est pas une
-- adresse verifiee, et rien ne doit pouvoir le laisser croire.
create type email_status as enum (
  'valid', 'accept_all', 'risky', 'unknown', 'invalid', 'disposable', 'suppressed', 'unverified'
);

create type email_source_kind as enum ('website', 'provider', 'import', 'deduction');

-- F-406. « written_form » : « contact [at] exemple [point] fr » et ses variantes.
create type extraction_method as enum (
  'mailto', 'text', 'attribute', 'json_ld', 'microdata', 'written_form'
);

-- Ce que la collecte a constate sur un site, sans que ce soit une erreur.
create type crawl_note as enum (
  'robots_disallowed',  -- robots.txt interdit tout ou partie du site (F-403)
  'masked_address',     -- une adresse masquee volontairement, non decodee (F-407)
  'dynamic_content',    -- page rendue par JavaScript, non analysee (F-412)
  'contact_form',       -- un formulaire de contact tient lieu d'adresse (F-408)
  'no_website',         -- aucun site connu pour cette entreprise
  'unreachable'         -- le site n'a pas repondu
);

create type pipeline_step as enum ('identify', 'crawl', 'enrich', 'verify');
create type pipeline_job_status as enum ('pending', 'running', 'done', 'failed', 'skipped');

alter table companies
  add column crawl_notes crawl_note[] not null default '{}',
  add column crawl_error text,
  add column crawled_at  timestamptz;

create table emails (
  id                 uuid primary key default uuidv7(),
  company_id         uuid not null references companies (id) on delete cascade,
  user_id            uuid not null references users (id) on delete cascade,
  address            text not null,
  normalized_address text not null,
  local_part         text not null,
  type               email_type not null default 'unknown',
  origin             email_origin not null,
  status             email_status not null default 'unverified',
  score              smallint,
  excluded           boolean not null default false,
  excluded_reason    text,
  last_verified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint emails_score_range check (score is null or score between 0 and 100),
  constraint emails_normalized_lowercase check (normalized_address = lower(normalized_address)),
  -- Une adresse n'existe qu'une fois par entreprise : la retrouver sur une
  -- seconde page ajoute une source, pas une adresse.
  constraint emails_unique_per_company unique (company_id, normalized_address)
);

create index emails_user_created_idx on emails (user_id, created_at desc);
create index emails_company_idx on emails (company_id);

create table email_sources (
  id                uuid primary key default uuidv7(),
  email_id          uuid not null references emails (id) on delete cascade,
  kind              email_source_kind not null,
  url               text,
  provider          text,
  extraction_method extraction_method,
  -- Traite comme hostile a l'affichage (S-06) : c'est du texte venu d'une
  -- page qu'on ne controle pas.
  context_excerpt   text,
  discovered_at     timestamptz not null default now(),

  -- F-411 : une adresse vue sur un site porte l'URL exacte de la page et la
  -- methode qui l'a relevee. Sans elles, ce n'est pas une source.
  constraint email_sources_website_complete
    check (kind <> 'website' or (url is not null and extraction_method is not null)),
  constraint email_sources_provider_named check (kind <> 'provider' or provider is not null),
  constraint email_sources_excerpt_length
    check (context_excerpt is null or char_length(context_excerpt) <= 200)
);

-- La meme adresse, vue sur la meme page de la meme facon, n'est qu'une source :
-- une collecte rejouee ne la duplique pas.
-- `nulls not distinct` : une source de fournisseur n'a pas d'URL, et deux
-- nuls doivent compter pour la meme valeur.
create unique index email_sources_unique_idx
  on email_sources (email_id, kind, url, provider, extraction_method) nulls not distinct;

-- « Chaque adresse a une source » (regle non negociable du depot) est tenu
-- par la base, pas seulement par le code : une adresse sans source ne peut
-- pas etre validee, et la derniere source d'une adresse ne peut pas etre
-- supprimee sans elle. Les contraintes sont differees a la fin de la
-- transaction, le temps d'inserer l'adresse puis sa source.
create function emails_require_source() returns trigger
language plpgsql as $$
declare
  cible uuid;
begin
  -- Un IF et non un CASE : PL/pgSQL resout les champs des deux branches d'un
  -- CASE, et OLD n'a pas de champ email_id quand le declencheur vient d'emails.
  if tg_table_name = 'emails' then
    cible := new.id;
  else
    cible := old.email_id;
  end if;
  if exists (select 1 from emails where id = cible)
     and not exists (select 1 from email_sources where email_id = cible) then
    raise exception 'Adresse % sans source : elle ne peut pas etre enregistree.', cible
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger emails_need_a_source
  after insert on emails
  deferrable initially deferred
  for each row execute function emails_require_source();

create constraint trigger email_sources_keep_one
  after delete on email_sources
  deferrable initially deferred
  for each row execute function emails_require_source();

create table pipeline_jobs (
  id           uuid primary key default uuidv7(),
  -- Nul quand l'etape est relancee hors d'un import, apres correction du
  -- domaine par exemple (F-307).
  import_id    uuid references imports (id) on delete cascade,
  company_id   uuid not null references companies (id) on delete cascade,
  step         pipeline_step not null,
  status       pipeline_job_status not null default 'pending',
  attempts     integer not null default 0,
  error        text,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint pipeline_jobs_attempts_positive check (attempts >= 0),
  -- Une etape par entreprise et par import : la rejouer met a jour la meme
  -- ligne, elle n'en ajoute pas une.
  constraint pipeline_jobs_unique_step unique nulls not distinct (import_id, company_id, step)
);

create index pipeline_jobs_import_idx on pipeline_jobs (import_id, step, status);
create index pipeline_jobs_company_idx on pipeline_jobs (company_id);
