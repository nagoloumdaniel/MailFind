-- Conservation et purge automatique (R-06).
--
-- « Non consultee ni exportee depuis douze mois » demande de savoir quand une
-- adresse a servi pour la derniere fois. `updated_at` ne le dit pas : il bouge
-- quand MailFind reecrit la ligne, pas quand une personne s'en sert.
alter table emails
  add column last_used_at timestamptz not null default now();

comment on column emails.last_used_at is
  'Derniere fois que l''adresse a servi : exportee, modifiee, envoyee. Sert a la purge des douze mois (R-06).';

-- La purge balaye par date : sans index, elle lirait toute la table chaque
-- nuit. `audit_events` a deja le sien depuis la migration 0001.
create index emails_last_used_idx on emails (last_used_at);
create index provider_calls_created_idx on provider_calls (created_at);
create index verifications_verified_idx on verifications (verified_at);
