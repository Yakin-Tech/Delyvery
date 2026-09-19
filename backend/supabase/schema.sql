-- Delyver schema — run once in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: guards with "if not exists" / "drop ... if exists" where practical.

create extension if not exists pgcrypto;

do $$ begin
  create type organization_status_enum as enum ('trial', 'active', 'suspended', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role_enum as enum ('super_admin', 'org_admin', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type active_status_enum as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status_enum as enum ('paid', 'partial', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_mode_enum as enum ('cash', 'upi', 'other');
exception when duplicate_object then null; end $$;

-- Re-running this file against a database created before bank_transfer/card
-- existed needs explicit ALTERs — a plain enum "create type" only runs once.
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction block in
-- Postgres, but is fine as its own top-level statement (which is how this
-- file's statements each execute — see the schema.sql header note on re-runs).
alter type payment_mode_enum add value if not exists 'bank_transfer';
alter type payment_mode_enum add value if not exists 'card';

do $$ begin
  create type deposit_status_enum as enum ('held', 'partially_returned', 'fully_returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stock_movement_type_enum as enum ('out', 'return', 'received_from_supplier');
exception when duplicate_object then null; end $$;

-- How an organization records deliveries — chosen per-org by the Super Admin.
--   route_staff : staff log each delivery live, per customer, while on their
--                 route (the original model — DailyRunSheet, offline queue).
--   vehicle_eod : drivers keep a paper note per vehicle; office staff key the
--                 whole day in at end of day, per vehicle (see vehicles below).
do $$ begin
  create type delivery_model_enum as enum ('route_staff', 'vehicle_eod');
exception when duplicate_object then null; end $$;

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- organizations ---------------------------------------------------------

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type text,
  logo_url text,
  unit_of_measure text not null default 'litre',
  delivery_modes text[] not null default '{}',
  default_language text not null default 'en',
  phone_numbers text[] not null default '{}',
  address text,
  default_price_per_unit numeric(10, 2) not null default 0,
  status organization_status_enum not null default 'trial',
  staff_sees_all_customers boolean not null default true,
  staff_can_add_customers boolean not null default false,
  payment_allocation_mode text not null default 'fifo',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running this file against a database created before delivery_modes
-- existed needs an explicit ALTER — "create table if not exists" alone
-- won't add a new column to an already-existing table.
alter table organizations add column if not exists delivery_modes text[] not null default '{}';
alter table organizations add column if not exists payment_allocation_mode text not null default 'fifo';
-- First-login setup wizard progress. Null onboarding_completed_at means the
-- wizard should still be shown (see organization.controller.js / the frontend
-- OnboardingWizardPage); onboarding_step tracks how far they got so it
-- resumes on the same step across logins/devices instead of restarting.
alter table organizations add column if not exists onboarding_completed_at timestamptz;
alter table organizations add column if not exists onboarding_step integer not null default 0;
-- Products/Routes/Stock are optional modules, off by default for every new
-- org (see organization.controller.js EDITABLE_FIELDS and AppLayout.jsx's nav
-- filtering) until the org admin turns them on in Settings. The backfill
-- below runs every time this file is re-run, but only ever turns a flag on
-- for an org that already has real data in that module — never off — so it's
-- a no-op once an org's flags reflect its actual usage.
alter table organizations add column if not exists products_enabled boolean not null default false;
alter table organizations add column if not exists routes_enabled boolean not null default false;
alter table organizations add column if not exists stock_enabled boolean not null default false;
-- The backfill that flips these on for orgs with pre-existing module data
-- runs near the end of this file, after the products/stock_movements tables
-- below exist — see the "Module enable-flag backfill" comment there.
-- Super-Admin-owned (not in organization.controller.js EDITABLE_FIELDS). Every
-- pre-existing org stays on 'route_staff', so nothing changes for them.
alter table organizations add column if not exists delivery_model delivery_model_enum not null default 'route_staff';

drop trigger if exists trg_organizations_updated_at on organizations;
create trigger trg_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- users -------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  role user_role_enum not null,
  name text not null,
  phone text not null unique,
  password_hash text not null,
  preferred_language text not null default 'en',
  theme_mode text not null default 'light',
  status active_status_enum not null default 'active',
  assigned_zone text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running this file against a database from before per-user theming
-- existed needs explicit ALTERs, same reasoning as delivery_modes above.
alter table users add column if not exists theme_mode text not null default 'light';

create index if not exists idx_users_organization_id on users(organization_id);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();

-- vehicles --------------------------------------------------------------------
-- The unit of work for 'vehicle_eod' organizations (see delivery_model_enum).
-- A driver has no login — they're just a name/phone on the vehicle they
-- currently drive (admin edits it when the driver changes). Office staff key in
-- each vehicle's paper note at end of day; deliveries, payments and customer
-- assignment are then tracked against the vehicle. Never hard-deleted —
-- deliveries reference it — so a vehicle is retired by setting status inactive.

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_number text not null,
  label text,
  driver_name text,
  driver_phone text,
  status active_status_enum not null default 'active',
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicles_organization_id on vehicles(organization_id);
-- One vehicle number per org. Case/space/hyphen differences are normalised by
-- the controller (upper-cased, whitespace and hyphens stripped) before insert,
-- so "ka 01 ab-1234" and "KA01AB1234" collide here as they should.
create unique index if not exists idx_vehicles_org_number_unique on vehicles(organization_id, vehicle_number);

drop trigger if exists trg_vehicles_updated_at on vehicles;
create trigger trg_vehicles_updated_at before update on vehicles
  for each row execute function set_updated_at();

-- customers -----------------------------------------------------------------

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text,
  alternate_phone text,
  address text,
  default_quantity numeric(10, 2) not null default 1,
  custom_price_per_unit numeric(10, 2),
  assigned_staff_id uuid references users(id) on delete set null,
  status active_status_enum not null default 'active',
  notes text,
  -- What this customer already owed before they were entered into Delyver.
  -- Shown in their ledger as "Opening Balance (carried forward)" and counted
  -- into pending dues — otherwise the pending-dues report is wrong from day 1
  -- for every customer who had a running balance before going digital.
  opening_balance numeric(10, 2) not null default 0,
  -- Order to visit this customer in within their assigned staff's daily
  -- round. Nullable — customers with no sequence set sort after ones that
  -- have one (see todayBoard in delivery.controller.js).
  route_sequence integer,
  -- Running credit from an overpayment (a lump payment that exceeded total
  -- outstanding), auto-applied against this customer's next delivery instead
  -- of just sitting unapplied. See apply_payment_fifo / apply_payment_manual
  -- (which add to it) and apply_delivery_credit (which draws it down).
  credit_balance numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running this file against a database from before these existed needs
-- explicit ALTERs, same reasoning as delivery_modes above.
alter table customers add column if not exists opening_balance numeric(10, 2) not null default 0;
alter table customers add column if not exists route_sequence integer;
alter table customers add column if not exists credit_balance numeric(10, 2) not null default 0;
-- Null means "use the organization's default_language" — for WhatsApp
-- reminders/statements (see customer.controller.js), so a customer only
-- needs a language set when it actually differs from the org default.
alter table customers add column if not exists preferred_language text;
-- Lazily generated (see POST /customers/:id/portal-link in customer.controller.js)
-- the first time an org admin asks for a shareable link. gen_random_uuid()
-- gives 122 bits of entropy — the token itself is the only credential the
-- public self-service portal checks (see portal.controller.js), so this must
-- never be predictable or reused.
alter table customers add column if not exists portal_token uuid unique;
-- 'vehicle_eod' orgs assign a customer to the vehicle that regularly serves
-- them instead of to a staff member (assigned_staff_id, which stays for
-- 'route_staff' orgs). Powers the vehicle-wise pending-dues breakdown.
alter table customers add column if not exists assigned_vehicle_id uuid references vehicles(id) on delete set null;

create index if not exists idx_customers_organization_id on customers(organization_id);
create index if not exists idx_customers_assigned_staff_id on customers(assigned_staff_id);
create index if not exists idx_customers_assigned_vehicle_id on customers(assigned_vehicle_id);

-- A customer doesn't have one fixed delivery location — where a delivery
-- happens is recorded per-delivery instead (see deliveries.place below).
alter table customers drop column if exists zone;

-- One-time (idempotent) cleanup for data created before the unique index below
-- existed: merges any customers that got duplicated by phone (e.g. from using
-- the delivery-logging "new customer" flow more than once for the same
-- person). Keeps the oldest row per (organization_id, phone), re-points its
-- deliveries/payments onto that row, then drops the newer duplicates. Once
-- the data is clean this loop finds nothing and is a no-op on every future run.
do $$
declare
  dup record;
  keeper_id uuid;
begin
  for dup in
    select organization_id, phone
    from customers
    where phone is not null
    group by organization_id, phone
    having count(*) > 1
  loop
    select id into keeper_id
    from customers
    where organization_id = dup.organization_id and phone = dup.phone
    order by created_at asc
    limit 1;

    update deliveries set customer_id = keeper_id
    where customer_id in (
      select id from customers
      where organization_id = dup.organization_id and phone = dup.phone and id <> keeper_id
    );

    update payments set customer_id = keeper_id
    where customer_id in (
      select id from customers
      where organization_id = dup.organization_id and phone = dup.phone and id <> keeper_id
    );

    delete from customers
    where organization_id = dup.organization_id and phone = dup.phone and id <> keeper_id;
  end loop;
end $$;

-- One phone number = one customer per org. Partial (phone is not null) so
-- customers without a phone on file don't collide with each other. This is
-- the backstop against the duplicate-customer bug above — see
-- resolveCustomerId in delivery.controller.js, which now looks up by phone
-- before inserting instead of always creating a new row.
create unique index if not exists idx_customers_org_phone_unique on customers(organization_id, phone) where phone is not null;

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

-- products --------------------------------------------------------------------
-- Multi-product catalog: an org that used to have exactly one org-wide unit/price
-- (organizations.unit_of_measure / default_price_per_unit — kept for backward
-- compatibility as the seed for an org's first product) can now sell several
-- distinct items (20L can vs 10L bottle, full-cream vs toned milk, 14.2kg vs
-- 5kg cylinder), each with its own unit and price. Deliveries reference one.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  unit_of_measure text not null,
  default_price numeric(10, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_organization_id on products(organization_id);

-- Null means low-stock alerting is off for this product (most orgs don't
-- track stock at all — see stock.controller.js, which only compares against
-- this when it's set).
alter table products add column if not exists reorder_level integer;

-- Optional, litre products only (enforced in product.controller.js, which nulls
-- it for any other unit): how many litres one delivery of this product usually
-- is. A product named "Tanker 2000 Ltr" then fills the quantity in itself when
-- it's picked on a delivery, instead of the person typing 2000 every time.
alter table products add column if not exists default_quantity numeric(10, 2);
alter table products drop constraint if exists chk_products_default_quantity_positive;
alter table products add constraint chk_products_default_quantity_positive check (default_quantity is null or default_quantity > 0);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();

-- deliveries ------------------------------------------------------------------

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  staff_id uuid not null references users(id),
  product_id uuid references products(id) on delete set null,
  delivery_date date not null default current_date,
  delivery_time timestamptz not null default now(),
  quantity numeric(10, 2) not null,
  unit_price_at_delivery numeric(10, 2) not null,
  total_amount numeric(10, 2) not null,
  payment_status payment_status_enum not null default 'pending',
  amount_paid numeric(10, 2) not null default 0,
  payment_mode payment_mode_enum,
  place text,
  notes text,
  edited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Re-running this file against a database from before "place"/"product_id"
-- existed needs explicit ALTERs, same reasoning as delivery_modes above. These
-- must run before the indexes below — on a pre-existing table, "create table
-- if not exists" is a no-op, so the product_id column wouldn't exist yet for
-- the index statement that references it if these ran after.
alter table deliveries add column if not exists place text;
alter table deliveries add column if not exists product_id uuid references products(id) on delete set null;
-- Set by the staff app's offline queue when a delivery is logged without
-- connectivity. Lets the reconnect-sync endpoint (POST /deliveries/sync-batch,
-- see delivery.controller.js) upsert idempotently: if the same queued item is
-- resent after a flaky-network retry, the unique index below turns the second
-- insert into a no-op read instead of a duplicate delivery.
alter table deliveries add column if not exists client_ref_id uuid;
-- The vehicle that made this delivery, for 'vehicle_eod' orgs (null for
-- 'route_staff' orgs). staff_id keeps its meaning of "who is accountable for
-- this row": for route_staff that's the delivering staff, for vehicle_eod it's
-- the office staff member who keyed the day's note in. client_ref_id (above) is
-- reused there for double-submit safety on the end-of-day batch.
alter table deliveries add column if not exists vehicle_id uuid references vehicles(id) on delete set null;

create index if not exists idx_deliveries_organization_id on deliveries(organization_id);
create index if not exists idx_deliveries_customer_id on deliveries(customer_id);
create index if not exists idx_deliveries_staff_id on deliveries(staff_id);
create index if not exists idx_deliveries_payment_status on deliveries(payment_status);
create index if not exists idx_deliveries_delivery_date on deliveries(delivery_date);
create index if not exists idx_deliveries_product_id on deliveries(product_id);
create index if not exists idx_deliveries_vehicle_id on deliveries(vehicle_id);
create unique index if not exists idx_deliveries_client_ref_id_unique on deliveries(client_ref_id) where client_ref_id is not null;

drop trigger if exists trg_deliveries_updated_at on deliveries;
create trigger trg_deliveries_updated_at before update on deliveries
  for each row execute function set_updated_at();

-- route_skips ------------------------------------------------------------------
-- Staff explicitly marking "no delivery today, here's why" for a route
-- customer. Deliberately not a deliveries row — a skip has no quantity, price,
-- or payment. todayBoard (delivery.controller.js) reports each customer as
-- pending / delivered / skipped by checking for a deliveries row or a
-- route_skips row on the given date; the unique (customer_id, skip_date)
-- index keeps a customer from being skipped twice in one day.

create table if not exists route_skips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  staff_id uuid not null references users(id),
  skip_date date not null default current_date,
  reason text not null,
  -- Same offline-sync idempotency purpose as deliveries.client_ref_id above.
  client_ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_route_skips_organization_id on route_skips(organization_id);
create index if not exists idx_route_skips_customer_id on route_skips(customer_id);
create unique index if not exists idx_route_skips_customer_date_unique on route_skips(customer_id, skip_date);
create unique index if not exists idx_route_skips_client_ref_id_unique on route_skips(client_ref_id) where client_ref_id is not null;

-- payments -------------------------------------------------------------------

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric(10, 2) not null,
  payment_date date not null default current_date,
  payment_mode payment_mode_enum not null default 'cash',
  recorded_by uuid not null references users(id),
  notes text,
  linked_delivery_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_organization_id on payments(organization_id);
create index if not exists idx_payments_customer_id on payments(customer_id);
-- Set only by apply_wallet_topup below — distinguishes a customer
-- proactively topping up their wallet from a normal payment settling
-- existing dues, so the customer ledger (frontend) can label it distinctly
-- instead of it looking like an unexplained overpayment.
alter table payments add column if not exists is_wallet_topup boolean not null default false;
-- vehicle_eod orgs: the vehicle whose driver collected this payment (a customer
-- settling an old due on the round). Null = paid at the office / not through a vehicle.
alter table payments add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
-- Idempotency key from the client (same idea as deliveries.client_ref_id): a
-- double-tap or a retry after a dropped response returns the payment already
-- recorded instead of counting the money twice.
alter table payments add column if not exists client_ref_id uuid;
create index if not exists idx_payments_vehicle_id on payments(vehicle_id);
create unique index if not exists idx_payments_client_ref_id_unique on payments(client_ref_id) where client_ref_id is not null;

drop trigger if exists trg_payments_updated_at on payments;
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

-- customer_deposits -----------------------------------------------------------
-- Security deposits for equipment on loan (a gas cylinder, a water can body).
-- Tracked separately from deliveries/payments since a deposit isn't revenue —
-- it's refundable, and its return (partial or full) is its own event.

create table if not exists customer_deposits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  item_name text not null,
  quantity_deposited numeric(10, 2) not null default 1,
  deposit_amount_per_item numeric(10, 2) not null,
  total_deposit numeric(10, 2) not null,
  deposit_date date not null default current_date,
  status deposit_status_enum not null default 'held',
  returned_amount numeric(10, 2) not null default 0,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_deposits_organization_id on customer_deposits(organization_id);
create index if not exists idx_customer_deposits_customer_id on customer_deposits(customer_id);

drop trigger if exists trg_customer_deposits_updated_at on customer_deposits;
create trigger trg_customer_deposits_updated_at before update on customer_deposits
  for each row execute function set_updated_at();

-- credit_notes ------------------------------------------------------------------
-- A damaged/returned product or an overcharge, reducing what the customer owes
-- without it looking like they paid cash for it. Not a payment — computePendingDues
-- subtracts these directly (see pendingDues.controller.js). voided_at lets a
-- mistaken note be corrected without deleting the financial record.

create table if not exists credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  delivery_id uuid references deliveries(id) on delete set null,
  amount numeric(10, 2) not null,
  reason text,
  issued_by uuid not null references users(id),
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_notes_organization_id on credit_notes(organization_id);
create index if not exists idx_credit_notes_customer_id on credit_notes(customer_id);

-- price_history -----------------------------------------------------------------
-- One row per change to a product's default_price, for "when did I change from
-- ₹40 to ₹45?" GST/accounting questions. Written by product.controller.js
-- whenever an update changes default_price — never edited after the fact.

create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  old_price numeric(10, 2),
  new_price numeric(10, 2) not null,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_price_history_product_id on price_history(product_id);

-- Unit prices keep six decimals. A litre product can be priced as one overall
-- amount per delivery (₹850 for 2000 L), which makes the price per litre
-- ₹0.425 — more than the two decimals these columns started with. Money totals
-- (total_amount, amount_paid, ...) stay at two decimals. Widening is lossless
-- and safe to re-run.
alter table products alter column default_price type numeric(14, 6);
alter table price_history alter column old_price type numeric(14, 6);
alter table price_history alter column new_price type numeric(14, 6);
alter table deliveries alter column unit_price_at_delivery type numeric(14, 6);

-- stock_movements -----------------------------------------------------------------
-- Optional module for orgs (typically gas) that track how many units of a
-- product are out with customers vs. in the godown. Current stock is derived
-- by summing movements at read time (see stock.controller.js) rather than
-- stored, so it can never drift out of sync with the ledger of movements.

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  movement_type stock_movement_type_enum not null,
  quantity numeric(10, 2) not null,
  movement_date date not null default current_date,
  reference_delivery_id uuid references deliveries(id) on delete set null,
  notes text,
  recorded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_organization_id on stock_movements(organization_id);
create index if not exists idx_stock_movements_product_id on stock_movements(product_id);

-- cash_handovers (removed) ------------------------------------------------------
-- The Daily Cash Flow feature was taken out of the product. This drops its table
-- on databases that still have it; a fresh database never creates it.
drop table if exists cash_handovers cascade;

-- place_dismissals -----------------------------------------------------------------
-- "Remove this from suggestions" for the delivery form's place field (see
-- recentPlaces in delivery.controller.js). One row per (customer, place) —
-- dismissing an already-dismissed place just bumps dismissed_at rather than
-- piling up rows. recentPlaces suppresses a place while dismissed_at is more
-- recent than the last delivery actually made there; once a new delivery
-- uses that place again, its delivery_time passes dismissed_at and the
-- suggestion comes back on its own — no separate "undo" action needed.

create table if not exists place_dismissals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  place text not null,
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_place_dismissals_customer_id on place_dismissals(customer_id);
create unique index if not exists idx_place_dismissals_customer_place_unique on place_dismissals(customer_id, place);

-- Module enable-flag backfill --------------------------------------------------
-- Products/Routes/Stock default to off for every org (see the products_enabled/
-- routes_enabled/stock_enabled columns on organizations above), but an org that
-- was already using one of these modules before the toggle existed shouldn't
-- have it silently hidden out from under it. Runs after products/customers/
-- stock_movements exist, since it reads all three. Only ever turns a flag on,
-- never off, so re-running this file is safe once an org's flags already
-- reflect its real usage.
update organizations set products_enabled = true
where products_enabled = false and id in (select distinct organization_id from products);

update organizations set routes_enabled = true
where routes_enabled = false and id in (select distinct organization_id from customers where route_sequence is not null);

update organizations set stock_enabled = true
where stock_enabled = false and id in (select distinct organization_id from stock_movements);

-- audit_logs -----------------------------------------------------------------

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_organization_id on audit_logs(organization_id);
create index if not exists idx_audit_logs_user_id on audit_logs(user_id);

-- activity_events --------------------------------------------------------------
-- Append-only log of logins and server errors (organization_id/user_id are
-- nullable since a failed-auth error, for instance, may not resolve to
-- either). Backs Super Admin's DAU/MAU, error-rate, and onboarding-funnel
-- views (see superAdmin.controller.js) — rows are only ever inserted, never
-- updated, and aggregated at read time. Distinct from audit_logs, which
-- records explicit business actions (org created, admin activated, etc.)
-- rather than raw traffic/login/error events.

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_events_organization_id on activity_events(organization_id);
create index if not exists idx_activity_events_user_id on activity_events(user_id);
create index if not exists idx_activity_events_event_type on activity_events(event_type);
create index if not exists idx_activity_events_created_at on activity_events(created_at);

-- Row Level Security --------------------------------------------------------
-- The backend talks to Postgres using the service_role key, which bypasses RLS,
-- and does its own org/role scoping in Express middleware. RLS is still enabled
-- (with no policies) on every table so the anon/authenticated keys can never read
-- or write anything here, even if one of those keys is ever exposed to a client.

alter table organizations enable row level security;
alter table users enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table deliveries enable row level security;
alter table payments enable row level security;
alter table customer_deposits enable row level security;
alter table credit_notes enable row level security;
alter table price_history enable row level security;
alter table stock_movements enable row level security;
alter table audit_logs enable row level security;
alter table route_skips enable row level security;
alter table activity_events enable row level security;
alter table place_dismissals enable row level security;
alter table vehicles enable row level security;

-- FIFO payment settlement -----------------------------------------------------
-- Applies a lump-sum payment to a customer's opening balance (the oldest debt
-- there is — it predates every tracked delivery) first, then their oldest
-- pending/partial deliveries by delivery_date, then records the Payment row
-- with the delivery ids it touched. Any amount still left over after that
-- (the customer overpaid) becomes a credit balance that the next delivery
-- created for them draws down automatically — see apply_delivery_credit.
-- Runs as a single Postgres function call so the whole settlement is atomic.

-- p_vehicle_id / p_client_ref_id were added after the first version, which changes
-- the signature — drop the old one so the two can't sit side by side (an RPC call
-- with named args would then be ambiguous).
drop function if exists apply_payment_fifo(uuid, uuid, numeric, uuid, payment_mode_enum, date, text);

create or replace function apply_payment_fifo(
  p_organization_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_recorded_by uuid,
  p_payment_mode payment_mode_enum,
  p_payment_date date,
  p_notes text,
  p_vehicle_id uuid default null,
  p_client_ref_id uuid default null
) returns table(payment_id uuid, unapplied_amount numeric) as $$
declare
  v_remaining numeric := p_amount;
  v_touched uuid[] := '{}';
  v_delivery record;
  v_due numeric;
  v_applied numeric;
  v_payment_id uuid;
  v_opening_balance numeric;
begin
  select opening_balance into v_opening_balance from customers where id = p_customer_id for update;

  if v_opening_balance > 0 and v_remaining > 0 then
    v_applied := least(v_opening_balance, v_remaining);
    update customers set opening_balance = opening_balance - v_applied where id = p_customer_id;
    v_remaining := v_remaining - v_applied;
  end if;

  for v_delivery in
    select id, total_amount, amount_paid
    from deliveries
    where organization_id = p_organization_id
      and customer_id = p_customer_id
      and payment_status in ('pending', 'partial')
    order by delivery_date asc, created_at asc
    for update
  loop
    exit when v_remaining <= 0;

    v_due := v_delivery.total_amount - v_delivery.amount_paid;
    if v_due <= 0 then
      continue;
    end if;

    v_applied := least(v_due, v_remaining);

    update deliveries
    set amount_paid = v_delivery.amount_paid + v_applied,
        payment_status = case
          when v_delivery.amount_paid + v_applied >= v_delivery.total_amount then 'paid'::payment_status_enum
          else 'partial'::payment_status_enum
        end
    where id = v_delivery.id;

    v_touched := array_append(v_touched, v_delivery.id);
    v_remaining := v_remaining - v_applied;
  end loop;

  if v_remaining > 0 then
    update customers set credit_balance = credit_balance + v_remaining where id = p_customer_id;
  end if;

  insert into payments (organization_id, customer_id, amount, payment_date, payment_mode, recorded_by, notes, linked_delivery_ids, vehicle_id, client_ref_id)
  values (
    p_organization_id,
    p_customer_id,
    p_amount,
    coalesce(p_payment_date, current_date),
    coalesce(p_payment_mode, 'cash'),
    p_recorded_by,
    p_notes,
    v_touched,
    p_vehicle_id,
    p_client_ref_id
  )
  returning id into v_payment_id;

  return query select v_payment_id, greatest(v_remaining, 0);
end;
$$ language plpgsql;

-- Manual payment allocation -----------------------------------------------------
-- Used instead of apply_payment_fifo when the org's payment_allocation_mode is
-- 'manual': the caller (Org Admin) picks exactly which deliveries a payment
-- covers and how much goes to each, rather than always settling oldest-first.
-- p_allocations is a JSON array of {"delivery_id": "...", "amount": 123.45}.
-- Any amount not allocated to a delivery (deliberately, or because an
-- allocation exceeded that delivery's remaining due and got capped) becomes
-- credit balance, same as the FIFO path.

drop function if exists apply_payment_manual(uuid, uuid, numeric, uuid, payment_mode_enum, date, text, jsonb);

create or replace function apply_payment_manual(
  p_organization_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_recorded_by uuid,
  p_payment_mode payment_mode_enum,
  p_payment_date date,
  p_notes text,
  p_allocations jsonb,
  p_vehicle_id uuid default null,
  p_client_ref_id uuid default null
) returns table(payment_id uuid, unapplied_amount numeric) as $$
declare
  v_alloc jsonb;
  v_delivery_id uuid;
  v_alloc_amount numeric;
  v_delivery record;
  v_touched uuid[] := '{}';
  v_total_allocated numeric := 0;
  v_remaining numeric;
  v_payment_id uuid;
begin
  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_delivery_id := (v_alloc->>'delivery_id')::uuid;
    v_alloc_amount := (v_alloc->>'amount')::numeric;
    if v_alloc_amount is null or v_alloc_amount <= 0 then
      continue;
    end if;

    select id, total_amount, amount_paid into v_delivery
    from deliveries
    where id = v_delivery_id and organization_id = p_organization_id and customer_id = p_customer_id
    for update;

    if not found then
      raise exception 'Delivery % not found for this customer', v_delivery_id;
    end if;

    v_alloc_amount := least(v_alloc_amount, greatest(v_delivery.total_amount - v_delivery.amount_paid, 0));
    if v_alloc_amount <= 0 then
      continue;
    end if;

    update deliveries
    set amount_paid = v_delivery.amount_paid + v_alloc_amount,
        payment_status = case
          when v_delivery.amount_paid + v_alloc_amount >= v_delivery.total_amount then 'paid'::payment_status_enum
          else 'partial'::payment_status_enum
        end
    where id = v_delivery_id;

    v_touched := array_append(v_touched, v_delivery_id);
    v_total_allocated := v_total_allocated + v_alloc_amount;
  end loop;

  v_remaining := greatest(p_amount - v_total_allocated, 0);
  if v_remaining > 0 then
    update customers set credit_balance = credit_balance + v_remaining where id = p_customer_id;
  end if;

  insert into payments (organization_id, customer_id, amount, payment_date, payment_mode, recorded_by, notes, linked_delivery_ids, vehicle_id, client_ref_id)
  values (
    p_organization_id,
    p_customer_id,
    p_amount,
    coalesce(p_payment_date, current_date),
    coalesce(p_payment_mode, 'cash'),
    p_recorded_by,
    p_notes,
    v_touched,
    p_vehicle_id,
    p_client_ref_id
  )
  returning id into v_payment_id;

  return query select v_payment_id, v_remaining;
end;
$$ language plpgsql;

-- Delivery-time credit draw-down --------------------------------------------------
-- Called right after a delivery is inserted: if the customer has a credit
-- balance (from a prior overpayment), applies as much of it as this delivery's
-- remaining due can absorb, on top of whatever amount_paid the delivery was
-- created with. Cheap no-op when credit_balance is 0.

create or replace function apply_delivery_credit(
  p_delivery_id uuid,
  p_customer_id uuid
) returns table(amount_paid numeric, payment_status payment_status_enum, credit_applied numeric) as $$
declare
  v_customer_credit numeric;
  v_delivery record;
  v_credit_to_apply numeric;
  v_new_amount_paid numeric;
  v_new_status payment_status_enum;
begin
  select credit_balance into v_customer_credit from customers where id = p_customer_id for update;
  -- Table-qualified (d.amount_paid, d.payment_status), not just "amount_paid"/
  -- "payment_status" — this function's own RETURNS TABLE output columns are
  -- named identically to those deliveries columns, so an unqualified
  -- reference here is genuinely ambiguous to Postgres (could mean the output
  -- variable or the table column) and raises "column reference is ambiguous".
  select d.id, d.total_amount, d.amount_paid, d.payment_status into v_delivery from deliveries d where d.id = p_delivery_id for update;

  v_credit_to_apply := least(coalesce(v_customer_credit, 0), greatest(v_delivery.total_amount - v_delivery.amount_paid, 0));

  if v_credit_to_apply > 0 then
    v_new_amount_paid := v_delivery.amount_paid + v_credit_to_apply;
    v_new_status := case
      when v_new_amount_paid >= v_delivery.total_amount then 'paid'::payment_status_enum
      else 'partial'::payment_status_enum
    end;

    update deliveries set amount_paid = v_new_amount_paid, payment_status = v_new_status where id = p_delivery_id;
    update customers set credit_balance = credit_balance - v_credit_to_apply where id = p_customer_id;
  else
    v_new_amount_paid := v_delivery.amount_paid;
    v_new_status := v_delivery.payment_status;
    v_credit_to_apply := 0;
  end if;

  return query select v_new_amount_paid, v_new_status, v_credit_to_apply;
end;
$$ language plpgsql;

-- Wallet top-up -----------------------------------------------------------------
-- A customer proactively adding money to their standing balance (e.g.
-- prepaying for a month of deliveries), as opposed to a normal payment that
-- settles existing dues first (apply_payment_fifo/apply_payment_manual). This
-- skips due-settlement entirely and deposits the full amount straight to
-- credit_balance — deliveries then draw it down automatically via
-- apply_delivery_credit, exactly as they already do for an ordinary
-- overpayment. Recorded as a payments row (is_wallet_topup = true) so it's
-- visible in the customer ledger, but never touches linked_delivery_ids since
-- it doesn't settle anything at the moment it's recorded.

create or replace function apply_wallet_topup(
  p_organization_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_recorded_by uuid,
  p_payment_mode payment_mode_enum,
  p_payment_date date,
  p_notes text
) returns table(payment_id uuid) as $$
declare
  v_payment_id uuid;
begin
  update customers set credit_balance = credit_balance + p_amount where id = p_customer_id;

  insert into payments (organization_id, customer_id, amount, payment_date, payment_mode, recorded_by, notes, is_wallet_topup)
  values (
    p_organization_id,
    p_customer_id,
    p_amount,
    coalesce(p_payment_date, current_date),
    coalesce(p_payment_mode, 'cash'),
    p_recorded_by,
    p_notes,
    true
  )
  returning id into v_payment_id;

  return query select v_payment_id;
end;
$$ language plpgsql;

-- Super Admin: create organization + first admin -----------------------------
-- Inserts the organization and its first org_admin user in one function call
-- so a duplicate-phone failure on the second insert rolls back the org too,
-- instead of leaving an orphaned organization with no admin.

-- Adding p_delivery_model changes this function's signature, and "create or
-- replace" can't do that — Postgres would keep the old 9-arg overload alongside
-- the new one, making a 9-named-arg RPC call ambiguous. Drop the old one first.
drop function if exists create_organization_with_admin(text, text, text, text[], uuid, text, text, text, text);

create or replace function create_organization_with_admin(
  p_name text,
  p_business_type text,
  p_address text,
  p_phone_numbers text[],
  p_created_by uuid,
  p_admin_name text,
  p_admin_phone text,
  p_admin_password_hash text,
  p_unit_of_measure text default 'litre',
  p_delivery_model delivery_model_enum default 'route_staff'
) returns table(organization_id uuid, admin_user_id uuid) as $$
declare
  v_org_id uuid;
  v_admin_id uuid;
  v_product_name text;
begin
  insert into organizations (name, business_type, address, phone_numbers, status, created_by, unit_of_measure, delivery_model)
  values (p_name, p_business_type, p_address, coalesce(p_phone_numbers, '{}'), 'trial', p_created_by, coalesce(p_unit_of_measure, 'litre'), coalesce(p_delivery_model, 'route_staff'))
  returning id into v_org_id;

  insert into users (organization_id, role, name, phone, password_hash, created_by)
  values (v_org_id, 'org_admin', p_admin_name, p_admin_phone, p_admin_password_hash, p_created_by)
  returning id into v_admin_id;

  -- Seed one starter product so the org isn't left with an empty catalog —
  -- the org admin can rename it or add more from Settings.
  v_product_name := case coalesce(p_business_type, 'other')
    when 'water' then 'Standard Water'
    when 'milk' then 'Standard Milk'
    when 'gas' then 'Standard Gas Cylinder'
    else 'Standard Product'
  end;
  insert into products (organization_id, name, unit_of_measure, default_price)
  values (v_org_id, v_product_name, coalesce(p_unit_of_measure, 'litre'), 0);

  return query select v_org_id, v_admin_id;
end;
$$ language plpgsql;
