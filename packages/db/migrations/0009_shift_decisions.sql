-- Смена как событие и решения по долгам.
--
-- Таблица shifts была с первой миграции (opened_at, closed_at, report), но ни
-- одного способа её закрыть: на стенде жила одна «вечная» смена. Теперь смену
-- открывает и закрывает менеджер, Z-отчёт замораживается в shifts.report.
--
-- Долг за закрытым столом раньше был тупиком — только числом в сверке. Теперь
-- по каждому долгу принимается решение: взыскали (каким способом) или
-- списали на заведение (почему). Решения без денег — «это банкет, нормально»
-- по долго открытому столу — лежат в decision_notes.

create table if not exists debt_settlements (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id) on delete cascade,
  table_session_id uuid not null references table_sessions(id) on delete cascade,
  kind             text not null check (kind in ('collected', 'written_off')),
  amount           numeric(12, 2) not null check (amount >= 0),
  method           text,
  reason           text,
  by_staff_id      uuid references staff(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists debt_settlements_session_idx on debt_settlements(table_session_id);

create table if not exists decision_notes (
  venue_id    uuid not null references venues(id) on delete cascade,
  key         text not null,
  text        text not null,
  by_staff_id uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (venue_id, key)
);
