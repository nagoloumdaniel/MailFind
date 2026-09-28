-- Ordre inverse de la migration montante.
drop table if exists pipeline_jobs;
drop trigger if exists email_sources_keep_one on email_sources;
drop trigger if exists emails_need_a_source on emails;
drop table if exists email_sources;
drop table if exists emails;
drop function if exists emails_require_source();

alter table companies
  drop column if exists crawled_at,
  drop column if exists crawl_error,
  drop column if exists crawl_notes;

drop type if exists pipeline_job_status;
drop type if exists pipeline_step;
drop type if exists crawl_note;
drop type if exists extraction_method;
drop type if exists email_source_kind;
drop type if exists email_status;
drop type if exists email_origin;
drop type if exists email_type;
