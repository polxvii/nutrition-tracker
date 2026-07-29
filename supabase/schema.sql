-- =====================================================================
--  Nutrition Tracker — Stage 1 database schema
--  Run this whole file in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
--  profiles : ข้อมูลร่างกาย + เป้าหมาย + ค่าที่คำนวณได้ (1 แถวต่อ 1 user)
--  primary key = auth.users.id  → ผูกกับบัญชี login โดยตรง
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  -- ข้อมูลร่างกาย (ใช้คำนวณ TDEE)
  age            integer,
  weight_kg      numeric(5,2),
  height_cm      numeric(5,2),
  sex            text    check (sex in ('male','female')),
  body_fat_pct   numeric(4,1),
  activity_level text    check (activity_level in
                    ('sedentary','light','moderate','active','very_active')),
  -- เป้าหมาย
  goal_type      text    check (goal_type in ('recomp','cut','bulk','maintain')),
  goal_rate      text    check (goal_rate in ('slow','medium','fast')),
  -- ค่าที่คำนวณได้ (เก็บไว้โชว์ — แก้เองได้ในหน้า onboarding/settings)
  bmr            integer,
  tdee           integer,
  goal_calories  integer,
  goal_protein_g integer,
  goal_carbs_g   integer,
  goal_fat_g     integer,
  goal_weight_kg numeric(5,2),          -- target weight (for projection)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  food_logs : รายการอาหารที่ log แต่ละมื้อ
-- ---------------------------------------------------------------------
create table if not exists public.food_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  logged_at     timestamptz not null default now(),
  meal_type     text check (meal_type in ('breakfast','lunch','dinner','night','snack')),
  food_name     text not null,
  source        text default 'manual',   -- manual / frequent / ai / barcode / usda
  grams         numeric(7,1),             -- amount value (unit below)
  unit          text default 'g',         -- g / ml / piece / serving / cup / ...
  calories      numeric(7,1) not null default 0,
  protein_g     numeric(6,1) not null default 0,
  carbs_g       numeric(6,1) not null default 0,
  fat_g         numeric(6,1) not null default 0,
  photo_url     text,
  user_note     text,
  ai_confidence text,                     -- low / medium / high (ใช้ตอน Stage 2)
  components    jsonb,                     -- AI dish breakdown [{name,grams,calories,protein_g,carbs_g,fat_g}] — drill-down/edit
  created_at    timestamptz not null default now()
);
create index if not exists food_logs_user_time_idx
  on public.food_logs (user_id, logged_at desc);
-- Existing databases: add the column if it isn't there yet.
alter table public.food_logs add column if not exists components jsonb;

-- ---------------------------------------------------------------------
--  frequent_foods : อาหารกินบ่อย (cache ไว้ log เร็ว)
--  unique(user_id, food_name) → กันซ้ำ + ใช้ upsert เพิ่ม times_used
-- ---------------------------------------------------------------------
create table if not exists public.frequent_foods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  food_name     text not null,
  default_grams numeric(7,1),
  unit          text default 'g',
  calories      numeric(7,1) not null default 0,
  protein_g     numeric(6,1) not null default 0,
  carbs_g       numeric(6,1) not null default 0,
  fat_g         numeric(6,1) not null default 0,
  times_used    integer not null default 1,
  created_at    timestamptz not null default now(),
  unique (user_id, food_name)
);
create index if not exists frequent_foods_user_idx
  on public.frequent_foods (user_id, times_used desc);

-- ---------------------------------------------------------------------
--  saved_meals : combo อาหารหลายรายการ = 1 มื้อ (log ทีเดียวได้ครบ)
--  items = jsonb array ของ {food_name,grams,unit,calories,protein_g,carbs_g,fat_g}
-- ---------------------------------------------------------------------
create table if not exists public.saved_meals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  items      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists saved_meals_user_idx
  on public.saved_meals (user_id, created_at desc);

-- ---------------------------------------------------------------------
--  body_measurements : รอบวงต่างๆ (เอว/อก/แขน/ขา/สะโพก) หน่วย cm
--  measurements = jsonb { waist, chest, arms, thighs, hips } (ทุกช่อง optional)
--  unique(user_id, logged_date) → 1 แถวต่อวัน (upsert ทับได้)
-- ---------------------------------------------------------------------
create table if not exists public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  logged_date  date not null default current_date,
  measurements jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, logged_date)
);
create index if not exists body_measurements_user_date_idx
  on public.body_measurements (user_id, logged_date desc);

-- ---------------------------------------------------------------------
--  weight_logs : บันทึกน้ำหนักรายวัน
--  unique(user_id, logged_date) → 1 ค่าต่อวัน (upsert ทับได้)
-- ---------------------------------------------------------------------
create table if not exists public.weight_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  logged_date date not null default current_date,
  weight_kg   numeric(5,2) not null,
  created_at  timestamptz not null default now(),
  unique (user_id, logged_date)
);
create index if not exists weight_logs_user_date_idx
  on public.weight_logs (user_id, logged_date desc);

-- ---------------------------------------------------------------------
--  updated_at trigger for profiles
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =====================================================================
--  Row-Level Security — user เห็น/แก้ได้แค่ข้อมูลตัวเอง
-- =====================================================================
alter table public.profiles       enable row level security;
alter table public.food_logs      enable row level security;
alter table public.frequent_foods enable row level security;
alter table public.saved_meals    enable row level security;
alter table public.body_measurements enable row level security;
alter table public.weight_logs    enable row level security;

-- profiles : ยึด id = auth.uid()
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

-- food_logs : ยึด user_id = auth.uid()
drop policy if exists food_logs_all_own on public.food_logs;
create policy food_logs_all_own on public.food_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- frequent_foods
drop policy if exists frequent_foods_all_own on public.frequent_foods;
create policy frequent_foods_all_own on public.frequent_foods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- saved_meals
drop policy if exists saved_meals_all_own on public.saved_meals;
create policy saved_meals_all_own on public.saved_meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- body_measurements
drop policy if exists body_measurements_all_own on public.body_measurements;
create policy body_measurements_all_own on public.body_measurements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- weight_logs
drop policy if exists weight_logs_all_own on public.weight_logs;
create policy weight_logs_all_own on public.weight_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
--  Table privileges for API roles
--  RLS above already restricts WHICH ROWS each user sees. These GRANTs
--  just let the logged-in (authenticated) role reach the tables at all.
--  `anon` (not logged in) is intentionally given nothing = fully locked.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.profiles, public.food_logs, public.frequent_foods,
     public.saved_meals, public.body_measurements, public.weight_logs
  to authenticated;

-- =====================================================================
--  BYOK : per-user Gemini API keys (encrypted at rest) + role-based limit
--  Additive & idempotent — safe to re-run. Does NOT touch existing tables.
-- =====================================================================

-- 3.1  role on profiles (existing rows default to 'user')
alter table public.profiles add column if not exists role text not null default 'user';

-- 3.2  user_api_keys — one row per stored key. `encrypted_key` is AES-256-GCM
--      ciphertext (base64(iv).base64(ct)); the plaintext key is NEVER stored.
create table if not exists public.user_api_keys (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          text not null default 'gemini',
  encrypted_key     text not null,           -- ciphertext only, never plaintext
  key_last4         text not null,           -- for display only
  key_label         text,                    -- optional nickname
  status            text not null default 'active',  -- active | invalid | exhausted
  last_used_at      timestamptz,
  last_validated_at timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists user_api_keys_user_idx on public.user_api_keys (user_id);

-- 3.3  RLS — a user only ever sees / edits their own key rows.
alter table public.user_api_keys enable row level security;
drop policy if exists user_api_keys_all_own on public.user_api_keys;
create policy user_api_keys_all_own on public.user_api_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- §7  DB backstop for the per-role key limit (user 1 / admin 10). Runs even if
--     the client and edge layer are bypassed. SECURITY DEFINER so it can read
--     profiles.role regardless of the caller's RLS.
create or replace function public.enforce_api_key_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r   text;
  lim int;
  cnt int;
begin
  select coalesce(role, 'user') into r from public.profiles where id = new.user_id;
  lim := case when r = 'admin' then 10 else 1 end;
  select count(*) into cnt from public.user_api_keys where user_id = new.user_id;
  if cnt >= lim then
    raise exception 'API key limit reached for role % (max %).', coalesce(r, 'user'), lim
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists user_api_keys_limit on public.user_api_keys;
create trigger user_api_keys_limit
  before insert on public.user_api_keys
  for each row execute function public.enforce_api_key_limit();

grant select, insert, update, delete on public.user_api_keys to authenticated;

-- =====================================================================
--  Done. Tables + RLS + grants ready.
-- =====================================================================
