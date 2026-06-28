#!/usr/bin/env bash
#
# Installer for usage-statusline-claude
# https://github.com/munkgorn/usage-statusline-claude
#
# Copies statusline.sh into ~/.claude/ and wires up the statusLine entry in
# ~/.claude/settings.json. Existing settings are preserved and backed up.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/munkgorn/usage-statusline-claude/main/install.sh | bash
#
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/munkgorn/usage-statusline-claude/main"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TARGET="$CLAUDE_DIR/statusline.sh"
SETTINGS="$CLAUDE_DIR/settings.json"

info()  { printf '\033[36m==>\033[0m %s\n' "$1"; }
ok()    { printf '\033[32m ✓\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m !\033[0m %s\n' "$1"; }
die()   { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v jq   >/dev/null 2>&1 || die "jq is required. Install it (brew install jq / apt install jq) and re-run."
command -v curl >/dev/null 2>&1 || die "curl is required."

mkdir -p "$CLAUDE_DIR"

# --- 1. Install the script -------------------------------------------------
# Prefer a local copy (when run from a clone); fall back to downloading.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/statusline.sh" ]; then
    info "Installing statusline.sh from local checkout"
    cp "$SCRIPT_DIR/statusline.sh" "$TARGET"
else
    info "Downloading statusline.sh"
    curl -fsSL "$REPO_RAW/statusline.sh" -o "$TARGET"
fi
chmod +x "$TARGET"
ok "Installed $TARGET"

# --- 2. Wire up settings.json ----------------------------------------------
STATUSLINE_JSON='{"type":"command","command":"bash ~/.claude/statusline.sh","refreshInterval":1}'

if [ -f "$SETTINGS" ]; then
    jq empty "$SETTINGS" 2>/dev/null || die "$SETTINGS is not valid JSON. Fix it and re-run, or add the statusLine block manually."
    backup="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
    cp "$SETTINGS" "$backup"
    tmp="$(mktemp)"
    jq --argjson sl "$STATUSLINE_JSON" '.statusLine = $sl' "$SETTINGS" > "$tmp"
    mv "$tmp" "$SETTINGS"
    ok "Updated $SETTINGS (backup: $backup)"
else
    jq -n --argjson sl "$STATUSLINE_JSON" '{statusLine: $sl}' > "$SETTINGS"
    ok "Created $SETTINGS"
fi

echo
ok "Done! Restart Claude Code (or start a new session) to see the status line."
