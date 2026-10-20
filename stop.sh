#!/bin/zsh
# Stops everything started by ./start.sh
pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:5174" 2>/dev/null
pkill -f "tsx watch --env-file=../../.env src/server.ts" 2>/dev/null
pkill -f "peciatka/node_modules/.*tsx.*src/server.ts" 2>/dev/null
pkill -f "peciatka/.*vite/bin/vite.js" 2>/dev/null
pkill -INT -f "scripts/dev-db.ts" 2>/dev/null
sleep 2
echo "Stopped."
