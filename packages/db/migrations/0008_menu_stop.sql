-- Стоп-лист в один тап.
--
-- В menu.json у блюда может стоять stop — это значение по умолчанию. Кухня и
-- бар выключают блюда тумблером прямо со своего экрана, и гость тут же видит
-- «закончилось»: переопределение хранится здесь, поверх файла. Хранится и
-- «вернули в меню» (stop = false) — иначе блюдо, остановленное в файле, было
-- бы не вернуть без деплоя.

create table if not exists menu_stop (
  venue_id    uuid not null references venues(id) on delete cascade,
  dish_id     text not null,
  stop        boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id) on delete set null,
  primary key (venue_id, dish_id)
);
