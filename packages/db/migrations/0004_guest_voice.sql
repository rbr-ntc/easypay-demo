-- Всё, что гость пишет руками, обязано пережить сохранение.
--
-- При переезде состояния в Postgres колонки под эти поля не завели, и они
-- терялись между ответом сервера и следующим чтением: аллергии превращались
-- в пустой список, комментарий «аллергия, критично» — в null, номер чека
-- исчезал вместе с составом. Гость видел подтверждение, кухня не получала
-- ничего. Это опаснее любой ошибки в рублях.

alter table guests
  add column if not exists allergies text[] not null default '{}';

alter table order_lines
  -- Живой текст гостя к блюду: доезжает до повара как есть
  add column if not exists comment text,
  -- Повар закончил, блюдо стоит на раздаче и ждёт официанта
  add column if not exists ready_at timestamptz,
  add column if not exists ready_by uuid references staff (id),
  -- Повар подтвердил, что снял отменённое с плиты
  add column if not exists cancel_ack boolean not null default false;

alter table calls
  -- «У меня аллергия на орехи» — официант идёт подготовленным
  add column if not exists note text;

alter table payments
  -- Чек гостя: номер, состав и способ оплаты
  add column if not exists receipt_no text,
  add column if not exists receipt_lines jsonb not null default '[]'::jsonb,
  add column if not exists method text not null default 'sbp',
  -- Кто из персонала физически взял наличные — для сверки кассы вечером
  add column if not exists taken_by uuid references staff (id);

alter table table_sessions
  -- Стол свободен по факту уборки, а не по истёкшему таймеру
  add column if not exists cleaned_at timestamptz,
  -- Гость просит принять наличные: деньги ждут официанта у стола
  add column if not exists cash_intent jsonb;
