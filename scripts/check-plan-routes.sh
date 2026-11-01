#!/usr/bin/env bash
# A PLAN'S ROUTE IS BUILT IN ONE PLACE.
#
# `planRoute` in `packages/domain/src/rules/plan-reference.ts` is the only code
# that spells `/plan/<basename>`, and `planRouteOfDocLink` the only one that
# rewrites a document link to it. A second site that joins `/plan/` to a name
# is a second place to forget the basename split or the encoding. Measured on
# `origin/main` at 251b2abfc: 10 such sites across the board's components,
# `lib/` helpers, `App.tsx` and `server/board.ts`.
#
# The gate reads what the code BUILDS, not what it mentions: a template literal
# that starts `/plan/`, or a quoted `/plan/` joined to another string with `+`.
# A quoted route prefix in a table (`prefix: '/plan/'`) builds nothing and
# passes. Whole-line comments are stripped first, so prose about the route
# does not trip it.
#
# usage: check-plan-routes.sh [repo-root]
set -uo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
allowed="packages/domain/src/rules/plan-reference.ts"
found=""

while IFS= read -r f; do
  rel="${f#"$root"/}"
  [ "$rel" = "$allowed" ] && continue
  hits=$(awk '
    /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
    /`\/plan\// || /["\047]\/plan\/["\047][[:space:]]*\+/ || /\+[[:space:]]*["\047]\/plan\// {
      printf "%d: %s\n", NR, $0
    }' "$f")
  [ -n "$hits" ] && found="$found$(printf '%s\n' "$hits" | sed "s|^|  $rel:|")
"
done < <(grep -rlF --include='*.ts' --include='*.tsx' '/plan/' \
           "$root/packages/board/src" "$root/packages/domain/src" 2>/dev/null | sort)

if [ -n "$found" ]; then
  echo "::error::a '/plan/' href is built outside planRoute."
  echo "Call planRoute(file) or planRouteOfDocLink(href) from @plot-pm/domain instead."
  printf '%s' "$found"
  exit 1
fi

echo "plan routes: only $allowed builds a '/plan/' href."
