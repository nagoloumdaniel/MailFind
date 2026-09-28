drop table if exists exports;
drop type if exists export_status;
alter table verifications drop column if exists address;
alter table emails
  drop column if exists contact_name,
  drop column if exists salutation,
  drop column if exists tags;

-- Une valeur d'enumeration ne se retire pas : les types sont recrees sans
-- elle. Les adresses saisies a la main n'ont pas de place dans le schema
-- d'avant et partent avec leurs sources.
delete from emails
 where origin = 'manual'
    or id in (select email_id from email_sources where kind = 'manual');

alter type email_origin rename to email_origin_0006;
create type email_origin as enum ('found', 'provider', 'deduced', 'imported');
alter table emails alter column origin type email_origin using origin::text::email_origin;
drop type email_origin_0006;

-- Les contraintes qui comparent `kind` a une valeur sont retirees le temps du
-- changement de type : recompilees contre l'ancien type, elles le bloqueraient.
alter table email_sources
  drop constraint email_sources_website_complete,
  drop constraint email_sources_provider_named;
alter type email_source_kind rename to email_source_kind_0006;
create type email_source_kind as enum ('website', 'provider', 'import', 'deduction');
alter table email_sources
  alter column kind type email_source_kind using kind::text::email_source_kind;
drop type email_source_kind_0006;
alter table email_sources
  add constraint email_sources_website_complete
    check (kind <> 'website' or (url is not null and extraction_method is not null)),
  add constraint email_sources_provider_named check (kind <> 'provider' or provider is not null);
