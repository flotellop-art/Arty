#!/bin/bash
#
# SessionStart hook — Claude Code on the web.
#
# Installs npm dependencies so `tsc --noEmit`, `vite build`, and `vitest`
# work in a fresh remote container. The container is cached after the hook
# completes, so later sessions start with node_modules already warm.
#
# No-op on local machines (only runs when CLAUDE_CODE_REMOTE=true) so it never
# surprises a developer's local Claude Code session with an unexpected install.
#
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Resolve the repo root: prefer the value Claude Code provides, otherwise derive
# it from this script's location (.claude/hooks/ -> repo root).
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

# Install dependencies.
#   - `npm install` (not `npm ci`) reuses the cached container layer across
#     sessions instead of wiping node_modules each time.
#   - `.npmrc` pins `legacy-peer-deps=true`, required because
#     @codetrix-studio/capacitor-google-auth wants Capacitor 6 while the app is
#     on Capacitor 8 (CLAUDE.md BUG 37). npm picks this up automatically.
#
# SessionStart stdout is injected into the session context, so the verbose npm
# log goes to a file and only a concise status line is printed.
LOG="$(mktemp)"
if npm install --no-fund --no-audit >"$LOG" 2>&1; then
  echo "[session-start] npm dependencies installed — node_modules ready."
else
  status=$?
  echo "[session-start] npm install FAILED (exit $status). Last 30 log lines:" >&2
  tail -n 30 "$LOG" >&2
  exit "$status"
fi
