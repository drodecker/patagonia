#!/bin/sh
set -eu
export MAP_PROVIDER="${MAP_PROVIDER:-mapbox}"
export MAPBOX_TOKEN="${MAPBOX_TOKEN:-}"
export GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-}"

TEMPLATE="/usr/share/nginx/html/config.js.template"
TARGET="/usr/share/nginx/html/config.js"

if [ -f "$TEMPLATE" ]; then
  envsubst '${MAP_PROVIDER} ${MAPBOX_TOKEN} ${GOOGLE_MAPS_API_KEY}' < "$TEMPLATE" > "$TARGET"
  mb=no; gb=no
  [ -n "$MAPBOX_TOKEN" ] && mb=yes
  [ -n "$GOOGLE_MAPS_API_KEY" ] && gb=yes
  echo "Wrote config.js MAP_PROVIDER=${MAP_PROVIDER} mapbox_token_set=${mb} google_key_set=${gb}"
else
  echo "WARN: config.js.template missing" >&2
fi

exec "$@"
