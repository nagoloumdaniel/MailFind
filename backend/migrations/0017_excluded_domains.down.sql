-- PostgreSQL ne sait pas retirer une valeur d'un enum : la note reste
-- declaree, et les entreprises qui la portaient la perdent.
update companies
   set crawl_notes = array_remove(crawl_notes, 'site_excluded')
 where 'site_excluded' = any (crawl_notes);

drop table if exists excluded_domains;
drop type if exists domain_exclusion_status;
