#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

umask 077
mkdir -p backups
timestamp=$(date -u +%Y-%m-%dT%H%M%SZ)

node_modules/.bin/wrangler d1 export DB --remote \
  --output "backups/edge-comments-$timestamp.sql" --config wrangler.jsonc
