-- Quotas par utilisateur et par mois (F-1401, F-1403).
--
-- Les appels payants sont deja comptes dans `provider_calls`, qui porte leur
-- cout en credits. Ce qui manquait est le reste : entreprises traitees, pages
-- explorees, exports. Ceux-la ne coutent pas un credit mais du temps machine
-- et des requetes chez des tiers, et rien ne les bornait.
--
-- Un compteur plutot qu'un decompte a la volee : il faut pouvoir prendre une
-- place et refuser la suivante dans la meme operation, ce qu'un `count(*)`
-- sur plusieurs tables ne garantit pas sous concurrence.
create type quota_metric as enum (
  'companies',  -- entreprises dont le traitement a commence
  'pages',      -- pages reellement demandees a un site
  'exports'     -- exports produits, quelle que soit leur taille
);

create table quota_usage (
  user_id    uuid not null references users (id) on delete cascade,
  -- Premier jour du mois, en UTC : la meme borne que les plafonds des
  -- fournisseurs, pour que tout se renouvelle au meme instant.
  period     date not null,
  metric     quota_metric not null,
  used       integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),

  primary key (user_id, period, metric)
);

comment on table quota_usage is
  'Consommation par utilisateur et par mois (F-1401). Les appels payants, eux, sont dans provider_calls.';

-- Une entreprise que le quota a arretee n'est ni faite ni en echec : elle
-- attend le renouvellement, ou que l'utilisateur relance (F-1403).
alter type pipeline_job_status add value 'quota_blocked';

-- Et l'import qui n'a plus que des entreprises en attente n'est pas termine :
-- le dire « termine » laisserait croire que tout a ete traite.
alter type import_status add value 'quota_blocked';
