#!/bin/sh
# Launch Inochi services detached from the invoking shell so they survive
# the tool-call session ending. The API boots first because both processes
# run migrations; concurrent runs can collide on the migrations bookkeeping.
cd "$(dirname "$0")/.." || exit 1
set -a
. ./.env
set +a

pkill -x inochi-api 2>/dev/null
pkill -x inochi-bot 2>/dev/null
sleep 1

setsid ./target/release/inochi-api > /tmp/api.log 2>&1 < /dev/null &

# Wait until the API is serving (migrations settled) before starting the bot.
i=0
while [ "$i" -lt 30 ]; do
    if curl -s -m 2 http://localhost:8080/api/health >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 1
done

setsid ./target/release/inochi-bot > /tmp/bot.log 2>&1 < /dev/null &
echo "launched"
