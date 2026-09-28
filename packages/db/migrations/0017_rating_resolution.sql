-- Замечание гостя можно разобрать: кто, когда и что сделал. Без этого лента
-- замечаний в «Гости и качество» копилась бы вечно, а управляющая не видела,
-- что уже решено («позвонили, извинились, десерт в подарок»).

alter table guest_ratings add column if not exists resolved_at timestamptz;
alter table guest_ratings add column if not exists resolved_by uuid references staff(id) on delete set null;
alter table guest_ratings add column if not exists resolution text;

-- «Гости и качество» ищет посадки по времени и принятые вызовы по посадке
create index if not exists table_sessions_opened_idx on table_sessions(opened_at);
create index if not exists calls_session_idx on calls(table_session_id);
