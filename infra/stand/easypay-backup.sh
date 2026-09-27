#!/bin/bash
# Ежедневный бэкап базы EasyPay: сжатый дамп, храним 14 дней.
set -euo pipefail
DIR=/root/backups/daily
mkdir -p "$DIR"
F="$DIR/easypay-$(date +%F).sql.gz"
sudo -u postgres pg_dump easypay | gzip > "$F.tmp" && mv "$F.tmp" "$F"
find "$DIR" -name 'easypay-*.sql.gz' -mtime +14 -delete
