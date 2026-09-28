-- История оценки гостя: переоценка стирала прежнее замечание («хлеб так и не принесли»),
-- и управляющая видела только последнее слово (смена №7, Г2).
alter table guest_ratings add column if not exists history jsonb not null default '[]';

-- «Я это не ем»: гость отказывается от общего блюда до отправки — не делит его и не
-- платит за него. Аллергику раньше оставалось только согласиться (смена №7, А2).
alter table order_lines add column if not exists opted_out text[] not null default '{}';
