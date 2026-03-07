#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  echo "Usage: $0 <csv-file>"
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "CSV file not found: $FILE"
  exit 1
fi

cd "$ROOT"

export OPENCODE_DATABASE_URL="postgres://opencode:opencode@182.92.74.187:9124/opencode"

bun run ./src/index.ts db import-users "$FILE"
