-- Page Contacts, fiche entreprise et exports (Phase 6).

-- F-1013 : une adresse saisie par l'utilisateur porte l'origine « manual », et
-- sa source dit qui l'a saisie et quand. Ajoutees sans etre utilisees dans
-- cette transaction, ce que PostgreSQL exige d'une valeur d'enumeration neuve.
alter type email_origin add value if not exists 'manual';
alter type email_source_kind add value if not exists 'manual';

-- F-1013 : nom, civilite et etiquettes d'un contact. La civilite part telle
-- quelle vers Campaign Mailer (colonne `salutation`).
alter table emails
  add column contact_name text,
  add column salutation   text,
  add column tags         text[] not null default '{}',
  add constraint emails_contact_name_length
    check (contact_name is null or char_length(contact_name) <= 200),
  add constraint emails_salutation_length
    check (salutation is null or char_length(salutation) <= 100);

-- F-1014 : l'adresse verifiee, gardee avec chaque verification. Quand
-- l'utilisateur corrige une adresse, l'historique de l'ancienne reste lisible
-- et ne se confond pas avec celui de la nouvelle.
alter table verifications add column address text;

-- 6.11, F-1104, F-1106 : chaque export est journalise ; un export volumineux
-- est produit en tache, depose dans R2 et garde sept jours.
create type export_status as enum ('pending', 'running', 'done', 'failed', 'expired');

create table exports (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references users (id) on delete cascade,
  format       text not null,
  -- Le perimetre et les filtres, tels que l'utilisateur les a choisis.
  filters      jsonb not null default '{}'::jsonb,
  status       export_status not null default 'pending',
  row_count    integer,
  filename     text,
  storage_key  text,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  expires_at   timestamptz,

  constraint exports_format_known check (
    format in ('csv_emails', 'csv_companies', 'xlsx', 'json', 'campaign_mailer')
  ),
  constraint exports_row_count_positive check (row_count is null or row_count >= 0)
);

create index exports_user_created_idx on exports (user_id, created_at desc);
