-- Envois vers Campaign Mailer (Phase 7, F-1202 a F-1209).

-- Un envoi est une selection d'adresses qui devient une campagne en brouillon
-- dans Campaign Mailer : un premier lot cree le brouillon, les suivants s'y
-- ajoutent, 500 adresses par lot. Chaque lot porte une cle d'idempotence
-- derivee de l'envoi et de son rang : un lot renvoye apres une coupure est
-- rejoue par Campaign Mailer, jamais importe deux fois (A7). La progression
-- est gardee lot par lot, pour reprendre ou l'envoi s'etait arrete.
create type campaign_mailer_push_status as enum ('pending', 'running', 'done', 'failed');

create table campaign_mailer_pushes (
  id             uuid primary key default uuidv7(),
  user_id        uuid not null references users (id) on delete cascade,
  campaign_name  text not null,
  -- Le perimetre et le filtre de statut, tels que l'utilisateur les a choisis.
  request        jsonb not null,
  status         campaign_mailer_push_status not null default 'pending',
  campaign_id    text,
  campaign_url   text,
  batches_total  integer,
  batches_done   integer not null default 0,
  sent           integer not null default 0,
  imported       integer not null default 0,
  rejected       integer not null default 0,
  -- Adresses laissees de cote avant l'envoi : que Campaign Mailer refuserait.
  skipped        integer not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,

  constraint campaign_mailer_pushes_name_length check (char_length(campaign_name) between 1 and 200)
);

create index campaign_mailer_pushes_user_idx on campaign_mailer_pushes (user_id, created_at desc);
