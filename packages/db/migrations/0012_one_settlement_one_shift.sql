-- Защита денег от гонок, найденная на ревью кабинета.
--
-- 1. Решение по долгу закрывает весь остаток, поэтому на сессию стола оно
--    одно. Без индекса двойной тап «Взыскано наличными» или два менеджера
--    сразу записывали долг дважды — касса ждала лишние деньги.
-- 2. Открытая смена у точки одна. «select … for update» по пустому результату
--    ничего не блокирует, и два одновременных «Открыть смену» вставляли две.

create unique index if not exists debt_settlements_session_uniq on debt_settlements(table_session_id);

-- Лишние открытые смены (если успели появиться) закрываем, оставляя самую свежую
update shifts s set closed_at = now()
 where s.closed_at is null
   and exists (
     select 1 from shifts n
      where n.venue_id = s.venue_id and n.closed_at is null and n.opened_at > s.opened_at
   );

create unique index if not exists shifts_one_open_uniq on shifts(venue_id) where closed_at is null;
