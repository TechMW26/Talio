#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
RELEASE_NOTES="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: GH_TOKEN=... $0 <version> [release-notes]" >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required." >&2
  exit 1
fi

node "$SCRIPT_DIR/create-release.js" "$VERSION" "$RELEASE_NOTES"
