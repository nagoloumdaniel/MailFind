-- Verification d'une liste en tache par l'API publique (Phase 7, 6.13) :
-- au-dela de 100 adresses, POST /v1/verify rend un identifiant, et le
-- processus de traitement fait le travail.

create type verification_run_status as enum ('pending', 'running', 'done', 'failed');

-- Les adresses et les verdicts sont gardes le temps que le client vienne les
-- chercher : sept jours, puis effaces par l'entretien quotidien, et effaces
-- avec le compte.
create table verification_runs (
  id           uuid primary key default uuidv7(),
  user_id      uuid not null references users (id) on delete cascade,
  status       verification_run_status not null default 'pending',
  addresses    text[] not null,
  results      jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,

  constraint verification_runs_size check (cardinality(addresses) between 1 and 10000)
);

create index verification_runs_user_idx on verification_runs (user_id, created_at desc);
create index verification_runs_created_idx on verification_runs (created_at);
