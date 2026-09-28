#!/usr/bin/env bash
# Выкладка на стенд одной командой: сборка → тесты → бэкап базы → код →
# недостающие миграции → рестарт → проверка, что стенд отвечает.
#
#   scripts/deploy.sh              — полный цикл
#   SKIP_TESTS=1 scripts/deploy.sh — без тестов (только если их уже гоняли)
#
# Миграции применяются через psql по одной, каждая в своей транзакции, и
# записываются в schema_migrations: node-раннер на стенде падал на протоколе.
set -euo pipefail

HOST="${EASYPAY_HOST:-root@77.221.141.238}"
KEY="${EASYPAY_KEY:-$HOME/.ssh/id_rsa}"
URL="${EASYPAY_URL:-https://77-221-141-238.sslip.io:8443}"

cd "$(dirname "$0")/.."

echo "→ сборка"
npm run build >/dev/null
if [ "${SKIP_TESTS:-}" != "1" ]; then
  echo "→ тесты"
  npm test 2>&1 | grep -E '^# fail [1-9]' && { echo "тесты упали — не выкладываю"; exit 1; } || true
fi

echo "→ архив"
ARCHIVE="$(mktemp -t easypay-deploy).tgz"
COPYFILE_DISABLE=1 tar czf "$ARCHIVE" --no-xattrs --exclude=node_modules \
  apps/api/dist apps/api/package.json apps/web/dist \
  packages/domain/dist packages/domain/package.json packages/config packages/db package.json
scp -q -i "$KEY" "$ARCHIVE" "$HOST":/tmp/easypay-deploy.tgz
rm -f "$ARCHIVE"

echo "→ стенд: бэкап, код, миграции, рестарт"
ssh -i "$KEY" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /root/backups
sudo -u postgres pg_dump easypay | gzip > "/root/backups/easypay-before-deploy-$(date +%F-%H%M).sql.gz"
find /root/backups -maxdepth 1 -name 'easypay-before-deploy-*.sql.gz' -mtime +30 -delete
tar xzf /tmp/easypay-deploy.tgz -C /opt/easypay 2>/dev/null
DB="$(systemctl show easypay -p Environment | tr ' ' '\n' | grep '^DATABASE_URL=' | cut -d= -f2-)"
cd /opt/easypay/packages/db/migrations
for f in $(ls *.sql | sort); do
  if [ -z "$(psql "$DB" -Atc "select 1 from schema_migrations where name = '$f'")" ]; then
    psql "$DB" -q -v ON_ERROR_STOP=1 -1 -f "$f"
    psql "$DB" -q -c "insert into schema_migrations (name) values ('$f')"
    echo "  миграция: $f"
  fi
done
systemctl restart easypay
sleep 3
echo "  служба: $(systemctl is-active easypay)"
REMOTE

curl -fsS -o /dev/null -w "→ стенд отвечает: %{http_code} (HTTP/%{http_version})\n" "$URL/api/settings"
