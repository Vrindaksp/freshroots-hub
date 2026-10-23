-- Manual SKU management: SKUs can be added by hand and "removed" by archiving (history is kept).
alter table skus add column if not exists source text not null default 'seed' check (source in ('seed', 'manual'));
alter table skus add column if not exists archived_at timestamptz;
alter table skus add column if not exists archived_reason text;

-- Zoho Inventory link. zoho_item_id is the item's id in Zoho once the SKU has been synced.
alter table skus add column if not exists zoho_item_id text;
alter table skus add column if not exists zoho_synced_at timestamptz;

-- Zoho purchase order that an approved PO was pushed to (zoho_sync_status already exists: not_staged/staged/pushed/failed).
alter table purchase_orders add column if not exists zoho_po_id text;
alter table purchase_orders add column if not exists zoho_po_number text;
alter table purchase_orders add column if not exists zoho_synced_at timestamptz;
alter table purchase_orders add column if not exists zoho_error text;

-- Append-only history of SKU changes. No foreign key on purpose: the record outlives a permanently deleted SKU.
create table if not exists sku_events (
  id         bigint generated always as identity primary key,
  sku_id     text not null,
  action     text not null check (action in ('add', 'edit', 'archive', 'restore', 'delete')),
  detail     jsonb not null default '{}'::jsonb,
  actor      text not null default 'unknown',
  created_at timestamptz not null default now()
);
create index if not exists sku_events_recent on sku_events (id desc);

-- Every call made to Zoho (and connection tests), successful or not, for troubleshooting.
create table if not exists zoho_sync_log (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('test', 'item', 'purchase_order')),
  ref        text,
  ok         boolean not null,
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists zoho_sync_log_recent on zoho_sync_log (id desc);
