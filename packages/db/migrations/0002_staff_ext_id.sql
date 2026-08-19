-- Пока персонал заводится из packages/config, у сотрудника есть «внешний» id из файла
-- (max, olya, chef…). Связываем его со строкой в базе, чтобы журнал, чаевые и авторство
-- действий ссылались на настоящего сотрудника, а не на строку из конфига.
alter table staff add column if not exists ext_id text;
create unique index if not exists staff_ext_id_uniq on staff(org_id, ext_id) where ext_id is not null;
