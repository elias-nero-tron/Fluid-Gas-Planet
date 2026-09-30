#!/usr/bin/env bash
# PreToolUse (Bash): Regeln des Urhebers für Git hart durchsetzen.
cmd=$(jq -r '.tool_input.command // empty')
if grep -qiE 'git[^|;&]*commit' <<<"$cmd" && grep -qiE 'Co-Authored-By: *Claude|Claude-Session:' <<<"$cmd"; then
  echo "GESPERRT: keine Co-Authored-By-Claude- oder Claude-Session-Zeilen in Commits (Regel des Urhebers)." >&2; exit 2
fi
if grep -qE 'git[^|;&]*push' <<<"$cmd" && grep -qE '(--force|-f\b|\+)[^|;&]*\bmain\b|\bmain\b[^|;&]*(--force|-f\b)' <<<"$cmd"; then
  echo "GESPERRT: Force-Push auf main nur mit ausdrücklichem Ja des Urhebers." >&2; exit 2
fi
exit 0
