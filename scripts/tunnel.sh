#!/bin/sh
# Start a Cloudflare quick tunnel (TLS) in front of the local API.
cd "$(dirname "$0")/.." || exit 1
setsid cloudflared tunnel --url http://localhost:8080 \
    > /tmp/tunnel.log 2>&1 < /dev/null &
echo "tunnel launching"
