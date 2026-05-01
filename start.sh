#!/usr/bin/env bash
set -euo pipefail

# Build frontend (skip if dist is up to date)
NEED_BUILD=0
if [ ! -d frontend/dist ]; then
  NEED_BUILD=1
elif find frontend/src -newer frontend/dist/index.html -name "*.tsx" -o -name "*.ts" -o -name "*.css" 2>/dev/null | grep -q .; then
  NEED_BUILD=1
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  echo "Building frontend..."
  (cd frontend && npm install --silent && npm run build)
  echo "Frontend built."
fi

# Start all services
docker compose up --build -d

echo ""
echo "Running at http://localhost:8000"
echo "Use './stop.sh' to stop, './rebuild-ui.sh' after frontend changes."
