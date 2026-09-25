-- Ordre inverse : import_rows reference imports et companies.
drop table if exists import_rows;
drop table if exists companies;
drop table if exists imports;

drop type if exists domain_status;
drop type if exists crawl_status;
drop type if exists import_row_status;
drop type if exists import_status;
