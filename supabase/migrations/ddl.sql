-- =========================
-- EXTENSIONS
-- =========================
create extension if not exists pgcrypto;

-- =========================
-- ENUMS
-- =========================
-- Si ya existía el enum con el typo 'comertial_proposal', lo corregimos a 'commercial_proposal'.
DO $$
BEGIN
  -- 1) Crear el enum si no existe (ya con el nombre correcto)
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'contact_type_enum'
  ) THEN
    CREATE TYPE contact_type_enum AS ENUM (
      'budget_request',
      'general_query',
      'commercial_proposal',
      'other'
    );
    RETURN;
  END IF;

END$$;

-- =========================
-- TENANT SETTINGS
-- =========================
create table if not exists tenant_contact_settings (
  tenant_slug text primary key,
  allowed_origins text[] not null,
  slack_webhook_url text not null,
  rate_limit_per_hour integer not null default 10 check (rate_limit_per_hour > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_contact_settings_enabled_idx
  on tenant_contact_settings (enabled);

-- =========================
-- RATE LIMIT COUNTERS
-- =========================
create table if not exists rate_limit_counters (
  tenant_slug text not null,
  ip inet not null,
  bucket_hour timestamptz not null,
  count integer not null default 0,
  primary key (tenant_slug, ip, bucket_hour),
  constraint fk_rate_limit_tenant
    foreign key (tenant_slug)
    references tenant_contact_settings(tenant_slug)
    on delete cascade
);

create index if not exists rate_limit_counters_bucket_idx
  on rate_limit_counters (bucket_hour);

-- =========================
-- RATE LIMIT RPC (ATOMIC)
-- =========================
create or replace function check_and_increment_rate_limit(
  p_tenant_slug text,
  p_ip inet,
  p_limit int
) returns boolean
language plpgsql
security definer
as $$
declare
  v_bucket timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  insert into rate_limit_counters (tenant_slug, ip, bucket_hour, count)
  values (p_tenant_slug, p_ip, v_bucket, 1)
  on conflict (tenant_slug, ip, bucket_hour)
  do update
    set count = rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- =========================
-- FORM SUBMISSIONS (AUDIT)
-- =========================
create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null
    references tenant_contact_settings(tenant_slug)
    on delete cascade,

  name text not null,
  email text not null,
  phone text,
  company_name text,

  contact_type contact_type_enum not null default 'general_query',

  message text not null,

  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists form_submissions_tenant_created_idx
  on form_submissions (tenant_slug, created_at desc);

create index if not exists form_submissions_contact_type_idx
  on form_submissions (contact_type);

-- =========================
-- RLS
-- =========================
alter table tenant_contact_settings enable row level security;
alter table rate_limit_counters enable row level security;
alter table form_submissions enable row level security;

create policy "no public access to tenant settings"
  on tenant_contact_settings
  for all
  using (false);

create policy "no public access to rate limits"
  on rate_limit_counters
  for all
  using (false);

create policy "no public access to submissions"
  on form_submissions
  for all
  using (false);

-- =========================
-- SEED (EXAMPLE TENANT)
-- =========================
insert into tenant_contact_settings (
  tenant_slug,
  allowed_origins,
  slack_webhook_url,
  rate_limit_per_hour,
  enabled
) values (
  'cfobras',
  array[
    'https://cf-obras-civiles-web-kplb.bolt.host'
  ],
  'https://hooks.slack.com/services/XXX/YYY/ZZZ',
  10,
  true
)
on conflict (tenant_slug) do update
set
  allowed_origins = excluded.allowed_origins,
  slack_webhook_url = excluded.slack_webhook_url,
  rate_limit_per_hour = excluded.rate_limit_per_hour,
  enabled = excluded.enabled,
  updated_at = now();
