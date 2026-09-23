-- Ordre inverse de la migration montante : audit_events reference users.
drop table if exists audit_events;
drop table if exists users;
