#!/bin/sh
# Launch Inochi services detached from the invoking shell so they survive
# the tool-call session ending.
cd "$(dirname "$0")/.." || exit 1
set -a
. ./.env
set +a

pkill -x inochi-api 2>/dev/null
pkill -x inochi-bot 2>/dev/null
sleep 1

setsid ./target/release/inochi-api > /tmp/api.log 2>&1 < /dev/null &
setsid ./target/release/inochi-bot > /tmp/bot.log 2>&1 < /dev/null &
echo "launched"
