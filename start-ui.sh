#!/usr/bin/env bash
# Start the Renko Strategy Explorer (API + UI) with one command.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

cd "$FRONTEND_DIR"

if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting API (http://localhost:5000) and UI (http://localhost:5173)..."
echo "Open http://localhost:5173 in your browser."
echo "Press Ctrl+C to stop both servers."
echo

npm run start
