#!/bin/bash
set -e

REPO="avirajsharma-ops/Talio"
TAG="v4.3.0"
DIST_DIR="$(dirname "$0")/../dist"
GH_TOKEN=$(cd "$(dirname "$0")/../.." && git remote get-url origin | grep -o 'ghp_[^@]*')

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: Could not extract GitHub token from remote URL"
  exit 1
fi

echo "==> Creating release $TAG..."
RELEASE_JSON=$(curl -s -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"Talio Desktop $TAG\",
    \"body\": \"## Talio Desktop $TAG\\n\\n### What's New\\n- **Seamless Title Bar**: Dynamic theme-adaptive title bar that matches your app header color (light/dark mode)\\n- **Custom Windows Title Bar**: Minimal, themed window controls replacing the default Windows title bar\\n- **Auto-Update System**: Automatic updates from GitHub Releases with progress UI, force-update blocking for critical versions\\n- **Notification Icon Fix**: Talio icon now properly shows in system notifications instead of default Electron icon\\n- **Security**: DevTools disabled in production builds\\n\\n### Downloads\\n- **macOS (Apple Silicon)**: Talio-4.3.0-arm64.dmg\\n- **macOS (Intel)**: Talio-4.3.0-x64.dmg\\n- **Windows**: Talio.Setup.4.3.0.exe\",
    \"draft\": false,
    \"prerelease\": false
  }")

RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
HTML_URL=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('html_url',''))" 2>/dev/null)
UPLOAD_URL=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('upload_url','').split('{')[0])" 2>/dev/null)

if [ -z "$RELEASE_ID" ] || [ "$RELEASE_ID" = "None" ]; then
  echo "ERROR: Failed to create release. Response:"
  echo "$RELEASE_JSON"
  exit 1
fi

echo "==> Release created: $HTML_URL (ID: $RELEASE_ID)"

upload_asset() {
  local file="$1"
  local name=$(basename "$file")
  local content_type="$2"
  echo "    Uploading $name..."
  curl -s -X POST \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: $content_type" \
    "${UPLOAD_URL}?name=${name}" \
    --data-binary "@$file" | python3 -c "import sys,json; d=json.load(sys.stdin); print('      -> ' + d.get('browser_download_url', d.get('message', 'unknown')))" 2>/dev/null
}

echo "==> Uploading assets..."
upload_asset "$DIST_DIR/Talio-4.3.0-arm64.dmg" "application/octet-stream"
upload_asset "$DIST_DIR/Talio-4.3.0-x64.dmg" "application/octet-stream"
upload_asset "$DIST_DIR/Talio.Setup.4.3.0.exe" "application/octet-stream"
upload_asset "$DIST_DIR/latest-mac.yml" "text/yaml"
upload_asset "$DIST_DIR/latest.yml" "text/yaml"
upload_asset "$DIST_DIR/Talio-4.3.0-arm64.dmg.blockmap" "application/octet-stream"
upload_asset "$DIST_DIR/Talio-4.3.0-x64.dmg.blockmap" "application/octet-stream"
upload_asset "$DIST_DIR/Talio.Setup.4.3.0.exe.blockmap" "application/octet-stream"

echo ""
echo "==> DONE! Release URL: $HTML_URL"
