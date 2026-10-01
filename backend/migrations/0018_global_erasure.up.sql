-- Effacement a la demande d'une personne (A9, R-07).
--
-- `suppressions` est la liste d'un utilisateur : elle ne vaut que pour lui.
-- Quand c'est la personne concernee qui demande, la portee n'est pas la meme :
-- l'adresse doit disparaitre de tous les comptes, et ne plus jamais etre
-- collectee par personne.
--
-- Seule l'empreinte est gardee, comme pour `suppressions` : une liste
-- d'effacement ne doit pas devenir, elle-meme, une liste d'adresses.
create table erased_addresses (
  address_hash text primary key check (address_hash ~ '^[0-9a-f]{64}$'),
  -- Combien d'adresses la demande a reellement effacees, pour pouvoir
  -- repondre a la personne si elle redemande.
  erased_count integer not null default 0 check (erased_count >= 0),
  created_at   timestamptz not null default now()
);

comment on table erased_addresses is
  'Adresses effacees a la demande de la personne concernee (A9). Empreintes seulement, et pour tous les comptes.';
