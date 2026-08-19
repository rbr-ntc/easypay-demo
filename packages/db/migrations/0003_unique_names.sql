-- Повторный запуск наполнения не должен плодить организации, точки и сотрудников.
-- Естественные ключи: имя организации, имя точки внутри организации, ext_id сотрудника.
create unique index if not exists organizations_name_uniq on organizations(name);
create unique index if not exists venues_org_name_uniq on venues(org_id, name);
