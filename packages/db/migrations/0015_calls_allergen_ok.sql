-- Повторные вызовы копятся в одном: смена №6 — ломатель пятью нажатиями
-- занял всю очередь стола, и экран официанта превратился в стену одинаковых строк.

alter table calls add column if not exists repeats int not null default 1;
alter table calls add column if not exists last_at timestamptz;

-- Аллергены, на которые гость согласился при заказе. Проверка повторяется при
-- отправке: аллергию могли указать уже после того, как блюдо легло в корзину.
alter table order_lines add column if not exists allergen_ok text[] not null default '{}';

-- Приставленный стул: третий гость за двухместным столом не мог сесть со своего
-- телефона, и его блюда записывались на чужую персону (смена №6, З1).
alter table table_sessions add column if not exists extra_seats int not null default 0;
