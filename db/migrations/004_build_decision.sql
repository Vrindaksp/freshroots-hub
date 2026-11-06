-- Pre-build decision gate (Head of Ops): nine checks answered by a person, then a recorded STOP BUILD / PAUSE /
-- REBUILD SMALLER / CONTINUE decision. The system suggests an outcome; a human decides and gives a reason.

-- Latest answer to each check. The question text lives in code (src/lib/decision/checks.ts); only the answer is stored.
create table if not exists build_checks (
  check_key  text primary key,
  status     text not null check (status in ('pass', 'partial', 'fail', 'unassessed')),
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'unknown'
);

-- Append-only decision log. `snapshot` freezes every check (status + note) as it stood at the moment of the decision.
create table if not exists build_decisions (
  id          bigint generated always as identity primary key,
  outcome     text not null check (outcome in ('stop_build', 'pause', 'rebuild_smaller', 'continue')),
  suggested   text,
  reason      text not null,
  score_pass  integer not null,
  score_total integer not null,
  snapshot    jsonb not null default '[]'::jsonb,
  also_paused boolean not null default false,
  actor       text not null default 'unknown',
  created_at  timestamptz not null default now()
);
create index if not exists build_decisions_recent on build_decisions (id desc);
