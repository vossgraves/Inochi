#!/bin/sh
# Start `vercel login` detached and capture its device-flow URL.
cd "$(dirname "$0")/.." || exit 1
setsid npx -y vercel@latest login > /tmp/vercel-login.log 2>&1 < /dev/null &
echo "vercel login launching"
