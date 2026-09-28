-- Ответ официанта на вызов и оценка визита.
--
-- Вызов снимался молча: гость видел «Оля идёт», но не «пицца будет через
-- 3 минуты» — официант знал время готовки, а сказать не мог (живой стол 3).
-- Оценка на экране «Спасибо» никуда не уходила: сервер её не принимал.

alter table calls add column if not exists ack_reply text;
-- Имя принявшего: мастер-токен не сотрудник из базы, и без имени его ответ
-- терялся при перечитывании стола вместе с самим «идёт»
alter table calls add column if not exists ack_name text;

create table if not exists guest_ratings (
  table_session_id uuid not null references table_sessions(id) on delete cascade,
  guest_id         uuid not null references guests(id) on delete cascade,
  rating           text not null check (rating in ('good', 'ok', 'bad')),
  note             text,
  created_at       timestamptz not null default now(),
  primary key (table_session_id, guest_id)
);
