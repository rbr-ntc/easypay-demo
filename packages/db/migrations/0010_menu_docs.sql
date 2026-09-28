-- Меню из кабинета: черновик, публикация и фото блюд.
--
-- Раньше меню жило в menu.json и менялось только деплоем. Теперь менеджер
-- правит черновик и публикует его; гости и кухня получают новое меню сразу.
-- Документ — jsonb целиком: меню читается одним куском при старте и при
-- публикации, а построчная схема блюд понадобится вместе с интеграцией кассы.
--
-- Фото — в базе, а не в файлах стенда: переживают редеплой и переезд, а
-- размер ограничен на входе (до 400 КБ, клиент сжимает до 4:5).

create table if not exists menu_docs (
  venue_id    uuid not null references venues(id) on delete cascade,
  kind        text not null check (kind in ('draft', 'published')),
  doc         jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id) on delete set null,
  primary key (venue_id, kind)
);

create table if not exists menu_photos (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id) on delete cascade,
  mime        text not null check (mime in ('image/jpeg', 'image/webp', 'image/png')),
  data        bytea not null check (octet_length(data) <= 409600),
  created_at  timestamptz not null default now()
);
create index if not exists menu_photos_venue_idx on menu_photos(venue_id);
