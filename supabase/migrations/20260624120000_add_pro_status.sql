-- ============================================================
-- Freemium / Pro-Status
--   * Pro-Felder auf profiles
--   * Spaltenschutz: nur service_role (RevenueCat-Webhook) darf
--     is_pro / rc_customer_id / pro_expires_at schreiben
--   * Helper is_user_pro()
--   * Server-seitige Limits: 3 Gruppen, 5 Mitglieder (Free)
-- ============================================================

-- 1. Pro-Felder ------------------------------------------------
alter table profiles
  add column if not exists is_pro         boolean      not null default false,
  add column if not exists rc_customer_id text,
  add column if not exists pro_expires_at timestamptz;

create index if not exists idx_profiles_rc_customer_id
  on profiles (rc_customer_id);

-- 2. Spaltenschutz --------------------------------------------
-- RLS-Policy "Users can update own profile" erlaubt sonst, dass ein
-- Client is_pro = true selbst setzt. Da profiles ein TABLE-LEVEL
-- UPDATE-Grant hat, greift ein spaltenweises REVOKE nicht (Postgres
-- ignoriert es solange das Tabellen-Grant existiert). Daher Trigger:
-- für jede Rolle außer service_role werden die Pro-Spalten auf ihren
-- bisherigen Wert zurückgesetzt (still, ohne Fehler).
-- WICHTIG: kein SECURITY DEFINER – sonst liefert current_user den
-- Function-Owner statt der anfragenden Rolle.
create or replace function public.protect_pro_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    new.is_pro         := old.is_pro;
    new.rc_customer_id := old.rc_customer_id;
    new.pro_expires_at := old.pro_expires_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_pro_columns on profiles;
create trigger trg_protect_pro_columns
  before update on profiles
  for each row execute function public.protect_pro_columns();

-- 3. Pro-Status-Helper ----------------------------------------
create or replace function public.is_user_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select is_pro
         and (pro_expires_at is null or pro_expires_at > now())
      from profiles
      where id = uid
    ),
    false
  );
$$;

-- 4. Gruppen-Limit (Free: 3) ----------------------------------
create or replace function public.enforce_group_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt int;
begin
  if public.is_user_pro(new.created_by) then
    return new;
  end if;

  select count(*) into cnt
  from groups
  where created_by = new.created_by;

  if cnt >= 3 then
    raise exception 'FREE_GROUP_LIMIT'
      using errcode = 'P0001',
            hint = 'Free-Limit von 3 Gruppen erreicht.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_group_limit on groups;
create trigger trg_enforce_group_limit
  before insert on groups
  for each row execute function public.enforce_group_limit();

-- 5. Mitglieder-Limit (Free: 5 pro Gruppe) --------------------
-- Maßgeblich ist der Pro-Status des Gruppen-Erstellers, nicht der
-- des beitretenden Users.
create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt     int;
  creator uuid;
begin
  select created_by into creator
  from groups
  where id = new.group_id;

  if public.is_user_pro(creator) then
    return new;
  end if;

  select count(*) into cnt
  from group_members
  where group_id = new.group_id;

  if cnt >= 5 then
    raise exception 'FREE_MEMBER_LIMIT'
      using errcode = 'P0001',
            hint = 'Free-Limit von 5 Mitgliedern erreicht.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_member_limit on group_members;
create trigger trg_enforce_member_limit
  before insert on group_members
  for each row execute function public.enforce_member_limit();
