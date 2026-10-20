#!/bin/zsh
# Starts the whole local stack: database, API, web app and (optionally) an HTTPS tunnel.
#   ./start.sh          — local only (http://localhost:5174)
#   ./start.sh --phone  — also an HTTPS address for testing on a phone (camera, Wallet)
#   ./stop.sh           — stops everything
set -e
cd "${0:A:h}"
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
mkdir -p .run

up() { lsof -nP -iTCP:$1 -sTCP:LISTEN -t >/dev/null 2>&1; }
wait_for() { for i in {1..60}; do up $1 && return 0; sleep 1; done; echo "✗ $2 did not start, see .run/$3.log"; exit 1; }

[ -f .env ] || cp .env.example .env
[ -d node_modules ] || pnpm install

if up 5434; then echo "✓ database already running"; else
  nohup pnpm db > .run/db.log 2>&1 &
  wait_for 5434 database db; echo "✓ database"
fi
pnpm --filter api exec dotenv -e ../../.env -- prisma migrate deploy > .run/migrate.log 2>&1 || { echo "✗ migrations failed, see .run/migrate.log"; exit 1; }

if [[ "$1" == "--phone" ]]; then
  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:5174" 2>/dev/null || true
  nohup cloudflared tunnel --no-autoupdate --url http://localhost:5174 > .run/tunnel.log 2>&1 &
  for i in {1..40}; do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' .run/tunnel.log | head -1); [ -n "$URL" ] && break; sleep 1; done
  [ -n "$URL" ] || { echo "✗ tunnel did not start, see .run/tunnel.log"; exit 1; }
  sed -i '' "s|^APP_URL=.*|APP_URL=$URL|" .env
  # the API reads APP_URL on start — restart it so links and Wallet cards use the new address
  pkill -f "tsx watch --env-file=../../.env src/server.ts" 2>/dev/null || true
  pkill -f "peciatka/node_modules/.*tsx.*src/server.ts" 2>/dev/null || true
  sleep 1
else
  sed -i '' "s|^APP_URL=.*|APP_URL=http://localhost:5174|" .env
fi

if up 3001; then echo "✓ API already running"; else
  nohup pnpm --filter api dev > .run/api.log 2>&1 &
  wait_for 3001 API api; echo "✓ API"
fi
if up 5174; then echo "✓ web app already running"; else
  nohup pnpm --filter web dev > .run/web.log 2>&1 &
  wait_for 5174 "web app" web; echo "✓ web app"
fi

echo
echo "Open on this Mac:  http://localhost:5174"
[ -n "$URL" ] && echo "Open on a phone:   $URL"
exit 0
