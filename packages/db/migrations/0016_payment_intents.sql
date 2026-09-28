-- Оплата через эквайера (ЮKassa): намерение живёт, пока гость на странице оплаты.
-- В счёт стола (payments) платёж попадает только после подтверждения эквайера;
-- до тех пор его сумма зарезервирована, чтобы сосед не оплатил то же самое.

create table if not exists payment_intents (
  id               uuid primary key,
  table_session_id uuid not null references table_sessions(id) on delete cascade,
  guest_id         uuid references guests(id) on delete set null,
  amount           numeric(12,2) not null check (amount > 0),
  scope            text not null check (scope in ('own', 'equal', 'full')),
  method           text not null default 'sbp',
  idem_key         text,
  provider         text not null default 'yookassa',
  provider_id      text,
  confirmation_url text,
  -- authorized — деньги заморожены, сервер решил списать и списывает
  status           text not null check (status in ('creating', 'pending', 'authorized', 'succeeded', 'canceled')),
  cancel_reason    text,
  receipt_no       text not null,
  receipt_lines    jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists payment_intents_session_idx on payment_intents(table_session_id);
create unique index if not exists payment_intents_provider_uniq on payment_intents(provider_id) where provider_id is not null;
-- Один платёж эквайера — одна строка в счёте, даже если уведомление пришло дважды
create unique index if not exists payments_provider_uniq on payments(provider_id) where provider_id is not null;
