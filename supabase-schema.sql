-- SplitEasy Supabase Schema
-- Führe dieses SQL KOMPLETT im Supabase SQL Editor aus
-- Dashboard → SQL Editor → New Query → Paste → Run

-- ============================================
-- 1. TABELLEN
-- ============================================

create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text not null default '',
  email text not null default '',
  avatar_url text,
  created_at timestamp with time zone default now()
);

create table if not exists groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  created_by uuid references auth.users on delete set null,
  created_at timestamp with time zone default now()
);

create table if not exists group_members (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  joined_at timestamp with time zone default now(),
  unique(group_id, user_id)
);

create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups on delete cascade not null,
  paid_by uuid references auth.users on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  description text not null,
  category text not null default 'other',
  date date not null default current_date,
  created_at timestamp with time zone default now()
);

create table if not exists expense_splits (
  id uuid default gen_random_uuid() primary key,
  expense_id uuid references expenses on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  amount numeric(10,2) not null,
  is_settled boolean default false,
  unique(expense_id, user_id)
);

-- ============================================
-- 2. ROW LEVEL SECURITY
-- ============================================

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

-- Profiles
drop policy if exists "Profiles are viewable by everyone" on profiles;
drop policy if exists "Users can insert own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;

create policy "Profiles are viewable by everyone"
  on profiles for select using (true);
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- Groups
drop policy if exists "Group members can view groups" on groups;
drop policy if exists "Authenticated users can create groups" on groups;
drop policy if exists "Group creators can update groups" on groups;

create policy "Group members can view groups"
  on groups for select using (
    exists (select 1 from group_members where group_id = groups.id and user_id = auth.uid())
  );
create policy "Authenticated users can create groups"
  on groups for insert with check (auth.uid() = created_by);
create policy "Group creators can update groups"
  on groups for update using (auth.uid() = created_by);

-- Group Members
drop policy if exists "Group members can view members" on group_members;
drop policy if exists "Authenticated users can join groups" on group_members;

create policy "Group members can view members"
  on group_members for select using (
    exists (select 1 from group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid())
  );
create policy "Authenticated users can join groups"
  on group_members for insert with check (
    auth.uid() is not null
  );

-- Expenses
drop policy if exists "Group members can view expenses" on expenses;
drop policy if exists "Group members can create expenses" on expenses;

create policy "Group members can view expenses"
  on expenses for select using (
    exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid())
  );
create policy "Group members can create expenses"
  on expenses for insert with check (
    exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid())
  );

-- Expense Splits
drop policy if exists "Group members can view splits" on expense_splits;
drop policy if exists "Group members can create splits" on expense_splits;
drop policy if exists "Users can update own splits" on expense_splits;

create policy "Group members can view splits"
  on expense_splits for select using (
    exists (
      select 1 from expenses e
      join group_members gm on gm.group_id = e.group_id
      where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
    )
  );
create policy "Group members can create splits"
  on expense_splits for insert with check (
    exists (
      select 1 from expenses e
      join group_members gm on gm.group_id = e.group_id
      where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
    )
  );
create policy "Users can update own splits"
  on expense_splits for update using (
    user_id = auth.uid() or exists (
      select 1 from expenses e
      join group_members gm on gm.group_id = e.group_id
      where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
    )
  );

-- ============================================
-- 3. TRIGGER: Profil automatisch anlegen
--    (mit Fehlerbehandlung – blockiert niemals die Registrierung)
-- ============================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    -- Fehler im Trigger soll User-Erstellung NIEMALS blockieren
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================
-- 4. STORAGE: Avatar-Bucket
-- ============================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;

create policy "Avatar images are publicly accessible"
  on storage.objects for select using (bucket_id = 'avatars');
create policy "Users can upload own avatar"
  on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy "Users can update own avatar"
  on storage.objects for update using (bucket_id = 'avatars' and auth.uid() is not null);
