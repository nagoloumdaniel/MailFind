-- Retrait des sites (R-07, F-1603).
--
-- Un site qui demande a ne plus etre explore l'est pour tout le monde, pas
-- pour le seul compte qui l'avait importe : c'est le site qui refuse, pas un
-- utilisateur qui filtre. La liste de suppression d'un utilisateur, elle,
-- reste la sienne (`suppressions`).
create type domain_exclusion_status as enum (
  'pending',   -- demande recue par la page publique, appliquee tout de suite
  'confirmed', -- revue par l'exploitant
  'rejected'   -- revue et refusee : le site redevient explorable
);

create table excluded_domains (
  domain     text primary key check (domain = lower(domain) and domain <> ''),
  status     domain_exclusion_status not null default 'pending',
  -- Ce que le demandeur a ecrit, sans contact : la page ne demande ni nom ni
  -- adresse, et n'en garde donc aucun (S-03).
  reason     text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

comment on table excluded_domains is
  'Sites ayant demande a ne pas etre explores (R-07). Une demande s''applique des sa reception : respecter un refus ne doit pas attendre une revue.';

-- Le robot a note pourquoi il n'a rien explore : une raison de plus.
alter type crawl_note add value 'site_excluded';
