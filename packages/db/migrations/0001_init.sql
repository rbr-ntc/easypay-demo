-- Базовая схема EasyPay.
--
-- Мультиарендность заложена с первого дня: организация → точка → зона/этаж → стол.
-- Это несколько лишних колонок сейчас и переписывание всех запросов потом, если не заложить.
-- Деньги — numeric(12,2), никаких float.

create extension if not exists "pgcrypto";

-- --- Организация и её точки ---

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Точка = конкретный ресторан. У одной организации их может быть много.
create table venues (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  timezone    text not null default 'Europe/Moscow',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index venues_org_idx on venues(org_id);

-- Зона или этаж внутри точки: «Терраса», «Второй этаж», «Бар»
create table zones (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id) on delete cascade,
  name        text not null,
  floor       int  not null default 1,
  sort        int  not null default 0
);
create index zones_venue_idx on zones(venue_id);

-- Стол. Номер уникален внутри точки, а QR-слаг — глобально:
-- иначе QR одного ресторана открыл бы стол в другом.
create table restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id) on delete cascade,
  zone_id     uuid references zones(id) on delete set null,
  number      text not null,
  seats       int  not null default 2,
  qr_slug     text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (venue_id, number)
);
create index tables_venue_idx on restaurant_tables(venue_id);

-- --- Персонал ---

create table staff (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  -- null = сотрудник работает на всех точках организации (например, владелец)
  venue_id     uuid references venues(id) on delete cascade,
  name         text not null,
  role         text not null check (role in ('manager', 'waiter', 'cook', 'hostess')),
  pin_hash     text not null,
  active_from  timestamptz not null default now(),
  active_to    timestamptz,
  created_at   timestamptz not null default now()
);
create index staff_org_idx on staff(org_id);

-- Закрепление столов за официантом: ответственность, а не подсветка
create table staff_tables (
  staff_id  uuid not null references staff(id) on delete cascade,
  table_id  uuid not null references restaurant_tables(id) on delete cascade,
  primary key (staff_id, table_id)
);

-- Сессии сотрудника: журнал обязан различать людей и устройства, а не только аккаунт
create table staff_sessions (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references staff(id) on delete cascade,
  token_hash    text not null unique,
  device_label  text,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
create index staff_sessions_staff_idx on staff_sessions(staff_id) where revoked_at is null;

-- --- Смена ---

create table shifts (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id) on delete cascade,
  opened_at   timestamptz not null default now(),
  opened_by   uuid references staff(id),
  closed_at   timestamptz,
  closed_by   uuid references staff(id),
  report      jsonb
);
create index shifts_venue_open_idx on shifts(venue_id) where closed_at is null;

-- --- Гостевая сессия стола ---

create table table_sessions (
  id                uuid primary key default gen_random_uuid(),
  table_id          uuid not null references restaurant_tables(id) on delete cascade,
  shift_id          uuid references shifts(id) on delete set null,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references staff(id),
  closed_with_debt  numeric(12,2) not null default 0,
  overpaid          numeric(12,2) not null default 0
);
-- Открытая сессия у стола может быть только одна
create unique index table_sessions_open_uniq on table_sessions(table_id) where closed_at is null;
create index table_sessions_shift_idx on table_sessions(shift_id);

create table guests (
  id                uuid primary key default gen_random_uuid(),
  table_session_id  uuid not null references table_sessions(id) on delete cascade,
  name              text not null,
  animal            text not null,
  secret_hash       text not null,
  joined_at         timestamptz not null default now()
);
create index guests_session_idx on guests(table_session_id);

create table order_lines (
  id                uuid primary key default gen_random_uuid(),
  table_session_id  uuid not null references table_sessions(id) on delete cascade,
  guest_id          uuid references guests(id) on delete set null,
  seq               int not null,                    -- номер позиции внутри сессии (бывший uid)
  dish_id           text not null,
  name              text not null,
  price             numeric(12,2) not null,          -- цена фиксируется в момент заказа
  qty               int not null check (qty between 1 and 99),
  options           jsonb not null default '{}'::jsonb,
  station           text not null default 'kitchen',
  shared            boolean not null default false,
  shared_with       uuid[] not null default '{}',    -- кто делит общее блюдо на момент отправки
  sent_at           timestamptz,
  started_at        timestamptz,
  started_by        uuid references staff(id),
  served_at         timestamptz,
  served_by         uuid references staff(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid references staff(id),
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  unique (table_session_id, seq)
);
create index order_lines_session_idx on order_lines(table_session_id);
-- Очередь кухни: только отправленное, не поданное и не отменённое
create index order_lines_kitchen_idx on order_lines(sent_at)
  where sent_at is not null and served_at is null and cancelled_at is null;

create table payments (
  id                uuid primary key default gen_random_uuid(),
  table_session_id  uuid not null references table_sessions(id) on delete cascade,
  guest_id          uuid references guests(id) on delete set null,
  amount            numeric(12,2) not null check (amount > 0),
  scope             text not null check (scope in ('own', 'equal', 'full')),
  method            text not null default 'sbp',
  status            text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  provider_id       text,
  idem_key          text,
  fiscal_receipt_id text,
  created_at        timestamptz not null default now(),
  unique (table_session_id, idem_key)
);
create index payments_session_idx on payments(table_session_id);

create table refunds (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references payments(id) on delete cascade,
  amount            numeric(12,2) not null check (amount > 0),
  reason            text not null,
  status            text not null default 'pending',
  fiscal_receipt_id text,
  created_at        timestamptz not null default now()
);

create table tips (
  id                uuid primary key default gen_random_uuid(),
  table_session_id  uuid not null references table_sessions(id) on delete cascade,
  guest_id          uuid references guests(id) on delete set null,
  waiter_id         uuid references staff(id),
  amount            numeric(12,2) not null check (amount > 0),
  idem_key          text,
  payout_status     text not null default 'pending',
  created_at        timestamptz not null default now(),
  unique (table_session_id, idem_key)
);
create index tips_waiter_idx on tips(waiter_id);

create table calls (
  id                uuid primary key default gen_random_uuid(),
  table_session_id  uuid not null references table_sessions(id) on delete cascade,
  guest_id          uuid references guests(id) on delete set null,
  reason            text not null,
  created_at        timestamptz not null default now(),
  ack_at            timestamptz,
  ack_by            uuid references staff(id)
);
create index calls_open_idx on calls(table_session_id) where ack_at is null;

-- --- Журнал ---
-- Только добавление: строки не меняются и не удаляются.
create table audit_log (
  id           bigserial primary key,
  venue_id     uuid references venues(id) on delete set null,
  at           timestamptz not null default now(),
  actor_type   text not null check (actor_type in ('guest', 'staff', 'system')),
  actor_id     uuid,
  actor_name   text,
  session_id   uuid,                    -- сессия сотрудника: различает людей под одним PIN
  action       text not null,
  table_id     uuid references restaurant_tables(id) on delete set null,
  amount       numeric(12,2),
  detail       text,
  payload      jsonb
);
create index audit_venue_at_idx on audit_log(venue_id, at desc);
create index audit_table_idx on audit_log(table_id, at desc);
