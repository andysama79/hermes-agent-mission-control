#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="andysama79"
REPO_NAME="hermes-agent-mission-control"
PLUGIN_ID="agent-mission-control"
REF="${1:-main}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_DIR="$HERMES_HOME/desktop-plugins/$PLUGIN_ID"
PLUGIN_PATH="$PLUGIN_DIR/plugin.js"
PLUGIN_URL="https://raw.githubusercontent.com/$REPO_OWNER/$REPO_NAME/$REF/desktop-plugins/$PLUGIN_ID/plugin.js"

mkdir -p "$PLUGIN_DIR"

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$PLUGIN_URL" -o "$tmp_file"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp_file" "$PLUGIN_URL"
else
  echo "Error: curl or wget is required to install $PLUGIN_ID" >&2
  exit 1
fi

mv "$tmp_file" "$PLUGIN_PATH"
chmod 644 "$PLUGIN_PATH"

cat <<EOF
Installed $PLUGIN_ID to:
  $PLUGIN_PATH

Next steps:
  1. Open Hermes Desktop
  2. Reload desktop plugins (or wait a few seconds for hot reload)
  3. If needed, enable 'Agent Mission Control' in Settings -> Plugins

Source:
  $PLUGIN_URL
EOF
