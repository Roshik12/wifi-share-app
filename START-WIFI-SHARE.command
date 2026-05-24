#!/bin/zsh

cd "$(dirname "$0")"

clear
echo "Starting Local WiFi Share..."
echo ""

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
else
  echo "Node.js was not found."
  echo "Install Node.js from https://nodejs.org, then run this file again."
  echo ""
  read "?Press Enter to close..."
  exit 1
fi

echo "Using Node: $NODE_BIN"
echo ""
echo "Keep this window open while using the app."
echo "Open this on this Mac: http://localhost:3000"
echo ""

HOST=0.0.0.0 PORT=3000 "$NODE_BIN" server/standalone-dev-server.js

echo ""
read "?Server stopped. Press Enter to close..."
