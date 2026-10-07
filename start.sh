#!/bin/sh
cd "$(dirname "$0")"
URL="http://localhost:${PORT:-8420}"
( sleep 1; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 ) &
exec node server.mjs
