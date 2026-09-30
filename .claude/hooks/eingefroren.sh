#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): eingefrorene Stände dürfen nie geändert werden.
# Quelle des Verfahrens: code.claude.com/docs/en/hooks (Exit 2 = blockieren, stderr geht an Claude).
pfad=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
rel=${pfad#"$CLAUDE_PROJECT_DIR"/}
case "$rel" in
  demo/*|v005/*|v005.1/*|src/*)
    echo "GESPERRT: $rel ist eingefroren (Archiv/Vergleich). Änderungen nur in app/, als neues Modul oder neue Version." >&2
    exit 2 ;;
esac
exit 0
