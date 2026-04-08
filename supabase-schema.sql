-- SplitEasy Supabase Schema
-- Führe dieses SQL im Supabase SQL Editor aus

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text not null,
  email text not null,
  avatar_url text,
  created_at timestamp with time zone default now()
);

-- Groups
create table if not exists groups (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  created_by uuid references auth.users on delete set null,
  created_at timestamp with time zone default now()
);

-- Group Members
create table if not exists group_members (
  id uuid default uuid_generate_v4() primary key,
  group_id uuid references groups on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  joined_at timestamp with time zone default now(),
  unique(group_id, user_id)
);

-- Expenses
create table if not exists expenses (
  id uuid default uuid_generate_v4() primary key,
  group_id uuid references groups on delete cascade not null,
  paid_by uuid references auth.users on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  description text not null,
  category text not null default 'other',
  date date not null default current_date,
  created_at timestamp with time zone default now()
);

-- Expense Splits
create table if not exists expense_splits (
  id uuid default uuid_generate_v4() primary key,
  expense_id uuid references expenses on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  amount numeric(10,2) not null,
  is_settled boolean default false,
  unique(expense_id, user_id)
);

-- Row Level Security
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

-- Profiles: User can read all profiles, update only own
create policy "Profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Groups: Members can view, creators can modify
create policy "Group members can view groups" on groups for select
  using (exists (select 1 from group_members where group_id = groups.id and user_id = auth.uid()));
create policy "Authenticated users can create groups" on groups for insert
  with check (auth.uid() = created_by);
create policy "Group creators can update groups" on groups for update
  using (auth.uid() = created_by);

-- Group Members: Members can view, authenticated can join
create policy "Group members can view members" on group_members for select
  using (exists (select 1 from group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid()));
create policy "Authenticated users can join groups" on group_members for insert
  with check (auth.uid() = user_id or exists (select 1 from group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid()));

-- Expenses: Group members can view/create
create policy "Group members can view expenses" on expenses for select
  using (exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid()));
create policy "Group members can create expenses" on expenses for insert
  with check (exists (select 1 from group_members where group_id = expenses.group_id and user_id = auth.uid()));

-- Expense Splits: Group members can view/update
create policy "Group members can view splits" on expense_splits for select
  using (exists (
    select 1 from expenses e
    join group_members gm on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
  ));
create policy "Group members can create splits" on expense_splits for insert
  with check (exists (
    select 1 from expenses e
    join group_members gm on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
  ));
create policy "Users can update own splits" on expense_splits for update
  using (user_id = auth.uid() or exists (
    select 1 from expenses e
    join group_members gm on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id and gm.user_id = auth.uid()
  ));

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Storage bucket for avatars
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict do nothing;

create policy "Avatar images are publicly accessible" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "Users can upload own avatar" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy "Users can update own avatar" on storage.objects
  for update using (bucket_id = 'avatars' and auth.uid() is not null);
