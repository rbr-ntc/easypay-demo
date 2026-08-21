-- Один открытый стол — одна сессия.
--
-- `select … for update` на пустой выборке ничего не блокирует: когда стол
-- свободен, строки ещё нет, и два гостя, сканирующие один QR одновременно
-- (компания села за стол — это норма, а не экзотика), открывали ДВЕ сессии
-- с `closed_at is null` на один стол. Дальше запрос без `limit 1` возвращал
-- их в произвольном порядке: гость то видел свой заказ, то чужой пустой стол.
-- Обе сессии при этом попадали в смену — гости и выручка удваивались.
--
-- Индекс делает это невозможным на уровне базы, а не договорённости в коде.

-- Схлопываем то, что уже успело раздвоиться: оставляем самую раннюю сессию,
-- поздние дубли закрываем задним числом их же временем открытия.
update table_sessions ts
set closed_at = ts.opened_at
where ts.closed_at is null
  and exists (
    select 1 from table_sessions older
    where older.table_id = ts.table_id
      and older.closed_at is null
      and (older.opened_at, older.id) < (ts.opened_at, ts.id)
  );

create unique index if not exists table_sessions_one_open
  on table_sessions (table_id)
  where closed_at is null;
