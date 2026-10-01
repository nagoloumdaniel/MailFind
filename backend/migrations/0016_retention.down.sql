drop index if exists verifications_verified_idx;
drop index if exists provider_calls_created_idx;
drop index if exists emails_last_used_idx;
alter table emails drop column if exists last_used_at;
