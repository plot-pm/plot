#!/usr/bin/env bash
# THE CARD GRAMMAR'S WORDS READ ONLY ITS FACTS.
#
# `packages/board/src/app/lib/card-presentation.ts` turns `CardFacts` into the
# words and rows a card shows. It may import the `CardFacts` types and the
# board's UI helpers, and nothing else: an import of a reading, a rule or a
# wire shape would let the mapping decide a fact the domain should have, and
# the facts would stop being the whole of what a card can say.
#
# Allowed specifiers:
#   @plot-pm/domain/entities/card-facts
#   a relative path that resolves under packages/board/src/app/components/ui/
#   or packages/board/src/app/ui/
#
# Every `from '…'`, side-effect `import '…'`, `import(…)` and `require(…)` is
# read, comments stripped first. A missing file fails rather than passing
# vacuously.
#
# usage: check-card-presentation.sh [repo-root]
set -uo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
rel="packages/board/src/app/lib/card-presentation.ts"
file="$root/$rel"

if [ ! -f "$file" ]; then
  echo "::error::$rel is missing — the card presentation gate has nothing to check."
  exit 1
fi

dir="$(dirname "$rel")"
found=""
lineno=0
# Block comments are blanked line by line, so line numbers survive.
while IFS= read -r line; do
  lineno=$((lineno + 1))
  for spec in $(printf '%s\n' "$line" | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*['\"][^'\"]+['\"]" | sed -E "s/^[^'\"]*['\"]//; s/['\"]$//"); do
    case "$spec" in
      @plot-pm/domain/entities/card-facts) continue ;;
      ./*|../*)
        resolved="$(printf '%s/%s\n' "$dir" "$spec" | awk -F/ '{
          n = 0
          for (i = 1; i <= NF; i++) {
            if ($i == "" || $i == ".") continue
            if ($i == "..") { if (n > 0) n--; continue }
            parts[++n] = $i
          }
          out = parts[1]; for (i = 2; i <= n; i++) out = out "/" parts[i]; print out
        }')"
        case "$resolved" in
          packages/board/src/app/components/ui/*|packages/board/src/app/ui/*) continue ;;
        esac
        ;;
    esac
    found="$found  $rel:$lineno: $spec
"
  done
done < <(awk '
  {
    line = $0
    if (inblock) {
      if (index(line, "*/")) { line = substr(line, index(line, "*/") + 2); inblock = 0 } else { print ""; next }
    }
    while (index(line, "/*")) {
      pre = substr(line, 1, index(line, "/*") - 1)
      rest = substr(line, index(line, "/*") + 2)
      if (index(rest, "*/")) { line = pre substr(rest, index(rest, "*/") + 2) } else { line = pre; inblock = 1 }
    }
    sub(/^[[:space:]]*\/\/.*$/, "", line)
    print line
  }' "$file")

if [ -n "$found" ]; then
  echo "::error::card-presentation.ts imports something other than the CardFacts types and UI helpers."
  echo "The mapping words facts; it must not read anything a fact could be decided from."
  printf '%s' "$found"
  exit 1
fi

echo "card presentation: $rel imports only the CardFacts types and UI helpers."
