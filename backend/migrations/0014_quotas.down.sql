-- PostgreSQL ne sait pas retirer une valeur d'un enum. Les etapes arretees
-- par un quota repassent donc en attente, et le type garde sa valeur.
update pipeline_jobs set status = 'pending' where status = 'quota_blocked';
update imports set status = 'running' where status = 'quota_blocked';

drop table if exists quota_usage;
drop type if exists quota_metric;
