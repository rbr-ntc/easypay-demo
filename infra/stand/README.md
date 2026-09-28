# Стенд: как он устроен

VPS `77.221.141.238`, Ubuntu 24.04. Адрес для людей — **https://77-221-141-238.sslip.io:8443**
(sslip.io сам указывает на IP; своего домена пока нет). Старый `http://77.221.141.238/...`
переадресуется туда же с тем же путём, поэтому старые ссылки и QR не ломаются.

- **Caddy** (`/etc/caddy/Caddyfile`, копия — `Caddyfile` рядом) — HTTPS с сертификатом
  Let's Encrypt и HTTP/2. Порт 443 занят `sing-box`, поэтому HTTPS живёт на 8443, а
  сертификат выпускается через HTTP-01 на порту 80. HTTP/2 снимает браузерный лимит в
  шесть соединений на адрес — живые потоки кабинета больше не упираются в него.
- **Приложение** — systemd-служба `easypay` на `127.0.0.1:8787`
  (`/etc/systemd/system/easypay.service.d/port.conf`), Postgres 16 локально.
- **Бэкапы** — `/usr/local/bin/easypay-backup.sh` (копия — `easypay-backup.sh`), cron
  `/etc/cron.d/easypay-backup` в 01:30 UTC (04:30 МСК), дампы в `/root/backups/daily`,
  хранятся 14 дней. Перед каждой выкладкой `scripts/deploy.sh` снимает отдельный дамп
  (`/root/backups/easypay-before-deploy-*`, 30 дней).
- **Выкладка** — `scripts/deploy.sh` из корня репозитория.

Восстановить базу из дампа — в новую базу рядом, потом переключить службу:

```bash
sudo -u postgres createdb -O easypay easypay_restore
gunzip -c /root/backups/daily/easypay-2026-09-27.sql.gz | sudo -u postgres psql easypay_restore
# проверить данные, затем поменять DATABASE_URL службы на easypay_restore и перезапустить
```

## Секрет столов в QR

`EASYPAY_QR_SECRET` (≥ 32 символов) и `EASYPAY_QR_VERSION` — в `/etc/systemd/system/easypay.service.d/qr.conf`.
С секретом за стол садятся только по QR с подписью: старые ссылки `?t=5` без `&k=` новых гостей не сажают.
Порядок включения: задать секрет → распечатать тенты на `#/qr` (под входом персонала) → расставить.
Сменить все подписи (утёк снимок QR): поднять `EASYPAY_QR_VERSION`, перезапустить службу, перепечатать тенты.
