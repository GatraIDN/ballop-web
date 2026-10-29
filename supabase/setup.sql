-- BALLOP: run once in Supabase > SQL Editor.
-- One row per collection (products, sales, content, ...). Only the server (service role key) reads/writes it.
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kv enable row level security;
-- no policies on purpose: the anon key cannot read or write this table

-- public bucket for uploaded photos (product, event, gallery, blog)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = true;
