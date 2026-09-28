-- Возвраты переплаты привязаны к СЕССИИ, а не к платежу.
--
-- Переплата рождается не платежом, а отменой блюда после оплаты: гость
-- заплатил за то, чего в итоге не получил. Привязывать возврат к конкретному
-- платежу поэтому неправильно — переплату могли сложить несколько человек.
--
-- Столбцы добавляем к существующей таблице: она уже была заведена в 0001 под
-- фискальные возвраты по 54-ФЗ, и ту схему ломать не надо.

alter table refunds
  add column if not exists table_session_id uuid references table_sessions(id) on delete cascade,
  add column if not exists guest_id uuid references guests(id) on delete set null,
  add column if not exists method text not null default 'sbp',
  add column if not exists by_staff_id uuid references staff(id) on delete set null,
  alter column payment_id drop not null,
  alter column reason set default 'переплата';

create index if not exists refunds_session_idx on refunds(table_session_id);
