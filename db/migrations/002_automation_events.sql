-- Kill switch: an append-only audit log. The current state is simply the most recent event
-- (pause -> automation stopped, resume -> running), so every flip is recorded with who, when and why.
create table if not exists automation_events (
  id         bigint generated always as identity primary key,
  action     text not null check (action in ('pause', 'resume')),
  reason     text not null,
  actor      text not null default 'unknown',
  created_at timestamptz not null default now()
);
create index if not exists automation_events_recent on automation_events (id desc);
