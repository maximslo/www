-- Run once in the Supabase SQL editor.

create table if not exists messages (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_created_idx
  on messages (session_id, created_at);

-- RLS on with no policies: the anon/public key can't read or write anything.
-- Only the API route, using the service-role key, touches this table.
alter table messages enable row level security;

-- With "Automatically expose new tables" off, grant access explicitly:
-- only the service role (used by the API route) may read and insert.
revoke all on messages from anon, authenticated;
grant select, insert on messages to service_role;

-- Retention: delete messages older than 90 days, nightly at 04:00 UTC.
-- (Enable the pg_cron extension under Database → Extensions first.)
select cron.schedule(
  'purge-old-chat-messages',
  '0 4 * * *',
  $$ delete from messages where created_at < now() - interval '90 days' $$
);
