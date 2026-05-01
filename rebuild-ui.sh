#!/usr/bin/env bash
set -euo pipefail
echo "Rebuilding frontend..."
(cd frontend && npm run build)
echo "Done. Refresh your browser at http://localhost:8000"
