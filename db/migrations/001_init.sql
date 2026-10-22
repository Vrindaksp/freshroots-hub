-- Freshroots Operations & Demand Intelligence Hub — initial schema.
-- Runs on Neon (PostgreSQL 16+) and on the embedded PGlite used for zero-config local dev.
-- Primary keys for master data are the source system IDs (SKU001, DIST001) so CSV re-ingestion is idempotent.

-- ---------------------------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------------------------
create table if not exists distributors (
  id            text primary key,
  name          text not null,
  region        text not null,
  contact_info  text,
  active_status boolean not null default true
);

create table if not exists skus (
  id                  text primary key,
  name                text not null,
  category            text not null,
  perishability_level text not null default 'Low' check (perishability_level in ('High', 'Low')),
  perishability_flag  boolean not null default false,
  min_stock_weeks     numeric(4, 1) not null default 3,   -- perishable window floor
  max_stock_weeks     numeric(4, 1) not null default 4,   -- perishable window ceiling
  standard_order_qty  integer not null check (standard_order_qty > 0),
  unit_of_measure     text not null default 'Units',
  distributor_id      text references distributors (id),  -- primary distributor from the SKU master
  unit_cost_inr       numeric(12, 2),                      -- NOT in the source seed: placeholder until Zoho rates are loaded
  unit_price_inr      numeric(12, 2),
  pricing_source      text
);

-- Month-level calendar. demand_uplift is applied by the rule engine before threshold checks.
create table if not exists calendar (
  year_month        text primary key,                      -- '2026-10'
  year              integer not null,
  month             integer not null check (month between 1 and 12),
  is_festival_month boolean not null default false,
  demand_uplift     numeric(5, 4) not null default 0
);

-- ---------------------------------------------------------------------------------------------
-- Transactional / ingested data
-- ---------------------------------------------------------------------------------------------
-- date is the Monday of the ISO week for weekly-grain feeds; daily feeds may use any date.
create table if not exists sales_history (
  id             bigint generated always as identity primary key,
  distributor_id text references distributors (id),
  sku_id         text not null references skus (id),
  date           date not null,
  quantity_sold  integer not null check (quantity_sold >= 0),
  channel        text
);
create unique index if not exists sales_history_natural_key
  on sales_history (sku_id, date, coalesce(distributor_id, ''), coalesce(channel, ''));
create index if not exists sales_history_distributor_date on sales_history (distributor_id, date);

create table if not exists inventory_levels (
  sku_id               text not null references skus (id),
  location             text not null default 'Main',
  current_stock_units  integer not null check (current_stock_units >= 0),
  average_weekly_sales numeric(12, 2) not null default 0,  -- refreshed from the 12-week rolling average on every engine run
  open_purchase_orders integer not null default 0,         -- units already on order outside this system (Zoho/SAP)
  as_of_date           date not null,
  primary key (sku_id, location)
);

-- One row per metric reading. `source` keeps real data apart from illustrative sample series.
create table if not exists operational_metrics (
  id          bigint generated always as identity primary key,
  recorded_at timestamptz not null,
  metric_name text not null,
  value       double precision not null,
  region      text,
  source      text not null default 'derived' check (source in ('derived', 'ingested', 'sample'))
);
create unique index if not exists operational_metrics_natural_key
  on operational_metrics (metric_name, recorded_at, coalesce(region, ''));
create index if not exists operational_metrics_name_time on operational_metrics (metric_name, recorded_at desc);

-- ---------------------------------------------------------------------------------------------
-- Demand planning engine output
-- ---------------------------------------------------------------------------------------------
create table if not exists engine_runs (
  id              bigint generated always as identity primary key,
  as_of           date not null,
  ran_at          timestamptz not null default now(),
  festival_active boolean not null default false,
  uplift          numeric(5, 4) not null default 0,
  summary         jsonb not null default '{}'::jsonb
);

create table if not exists demand_signals (
  run_id                  bigint not null references engine_runs (id) on delete cascade,
  sku_id                  text not null references skus (id),
  avg_4w                  double precision not null,
  avg_12w                 double precision not null,
  trend_pct               double precision,
  effective_weekly_demand double precision not null,
  on_hand                 integer not null,
  open_po_units           integer not null default 0,
  cover_weeks             double precision,
  flags                   jsonb not null default '[]'::jsonb,
  is_edge_case            boolean not null default false,
  edge_reasons            jsonb not null default '[]'::jsonb,
  action                  text not null check (action in ('reorder', 'pause', 'hold')),
  recommended_qty         integer not null default 0,
  rationale               jsonb not null default '[]'::jsonb,
  weekly_series           jsonb not null default '[]'::jsonb,
  primary key (run_id, sku_id)
);

-- Staging table that mimics the Zoho Inventory purchase-order hand-off.
create table if not exists purchase_orders (
  id               bigint generated always as identity primary key,
  sku_id           text not null references skus (id),
  recommended_qty  integer not null check (recommended_qty >= 0),
  final_qty        integer not null check (final_qty >= 0),
  status           text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  override_reason  text,
  rule_flags       jsonb not null default '[]'::jsonb,
  rationale        text,
  est_value_inr    numeric(14, 2),
  run_id           bigint references engine_runs (id) on delete set null,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       text,
  zoho_sync_status text not null default 'not_staged' check (zoho_sync_status in ('not_staged', 'staged', 'pushed', 'failed')),
  zoho_payload     jsonb
);
create unique index if not exists purchase_orders_one_draft_per_sku on purchase_orders (sku_id) where status = 'draft';
create index if not exists purchase_orders_status on purchase_orders (status, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Gemini outputs, planner notes, alerts
-- ---------------------------------------------------------------------------------------------
create table if not exists ai_outputs (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('edge_case', 'ops_brief')),
  sku_id     text references skus (id),
  run_id     bigint references engine_runs (id) on delete cascade,
  content    jsonb not null,
  model      text not null,
  source     text not null check (source in ('gemini', 'rules')),
  created_at timestamptz not null default now()
);
create index if not exists ai_outputs_lookup on ai_outputs (kind, sku_id, created_at desc);

create table if not exists planner_notes (
  id         bigint generated always as identity primary key,
  sku_id     text references skus (id),
  raw_text   text not null,
  parsed     jsonb,
  source     text not null default 'rules' check (source in ('gemini', 'rules')),
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists planner_notes_sku on planner_notes (sku_id, created_at desc);

create table if not exists alerts (
  id              bigint generated always as identity primary key,
  dedupe_key      text not null unique,
  type            text not null,
  severity        text not null check (severity in ('info', 'warning', 'critical')),
  region          text,
  sku_id          text,
  metric_name     text,
  title           text not null,
  message         text not null,
  details         jsonb not null default '{}'::jsonb,
  detected_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz
);
create index if not exists alerts_open on alerts (resolved_at, severity, detected_at desc);
