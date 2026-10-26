-- Ejecuta esto una vez en el SQL Editor de tu proyecto Supabase.
-- Cada usuario autenticado solo puede ver y modificar su propia fila.
create table if not exists public.dqos_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dqos_state enable row level security;

create policy "dqos select own" on public.dqos_state for select using (auth.uid() = user_id);
create policy "dqos insert own" on public.dqos_state for insert with check (auth.uid() = user_id);
create policy "dqos update own" on public.dqos_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
