-- Plafond global de depense par fournisseur et par mois (F-1405).
--
-- Les credits disent combien d'appels, pas combien d'euros : un credit de
-- recherche et un demi-credit de verification ne coutent pas la meme chose,
-- et un tarif peut changer en cours de mois. Le cout est donc fige sur la
-- ligne au moment de la reservation, en centimes, et c'est lui qu'on somme.
alter table provider_calls
  add column cost_cents integer not null default 0 check (cost_cents >= 0);

comment on column provider_calls.cost_cents is
  'Cout fige a la reservation (F-1405). Zero pour un appel gratuit, remis a zero au reglement quand le fournisseur n''a pas facture.';

-- L'alerte part une fois par fournisseur et par mois, pas a chaque appel
-- refuse : la cle primaire s''en charge, et le simple fait d''inserer dit
-- qu''il faut alerter.
create table provider_budget_alerts (
  provider   text not null,
  period     date not null,
  spent_cents integer not null,
  budget_cents integer not null,
  created_at timestamptz not null default now(),

  primary key (provider, period)
);

comment on table provider_budget_alerts is
  'Une ligne par fournisseur et par mois ou le plafond de depense a ete atteint (F-1405).';
