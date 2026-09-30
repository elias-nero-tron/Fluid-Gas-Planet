#!/usr/bin/env bash
# Stop-Hook: Wurde in app/ etwas geändert, darf die Runde erst enden, wenn Trennprüfung, Build und Bildtest bestehen.
# Quelle: code.claude.com/docs/en/best-practices („Give Claude a way to verify its work“ – Stop hook als festes Tor).
cd "$CLAUDE_PROJECT_DIR" || exit 0
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
[ -z "$(git status --porcelain -- app package.json)" ] && exit 0
if ! out=$(npm run --silent pruefen 2>&1); then
  printf 'Prüfung fehlgeschlagen – erst beheben, dann fertig melden:\n%s\n' "$(tail -30 <<<"$out")" >&2
  exit 2
fi
exit 0
