#!/usr/bin/env bash
# The gate that keeps one place opening an HTTPS connection to a git host.
#
# `packages/domain/src/adapters/host/` holds the in-process GitHub and
# Bitbucket clients (`github-api.ts`, `bitbucket-api.ts`). Each reads its credential, charges the shared budget ledger, takes
# a host slot, honours the proxy variables and bounds each request. A second
# caller of the host API does none of that, so this gate refuses one.
#
# It refuses seven patterns in code lines:
#
#   node:https            Node's HTTPS client
#   undici                the library behind Node's fetch
#   api.github.com        the GitHub API host
#   GITHUB_API_URL        the variable that names it
#   api.bitbucket.org     the Bitbucket API host
#   BITBUCKET_API_BASE    the variable that names it
#   fetch(                a global fetch call: no `.` or word character before it
#
# Where it looks: `packages/*/src`, outside `packages/domain/src/adapters/host/`,
# and the shipped `skills/plot/scripts/*.mjs` (not the generated `board/`).
# A comment line is not a request, and is skipped.
#
# Exempt by name, each with the reason:
#
# `packages/board/src/app/` — the board's browser code. Its `fetch(` calls ask
#   the board's own server by a relative path, never a git host.
# `packages/domain/src/ports/trees.ts` — declares `Trees.fetch(path, branch)`,
#   a git fetch, not an HTTP call.
# `skills/plot/scripts/plot-github-app.mjs` — exchanges an App JWT for the
#   installation token that signs `plot/review` statuses, merges and pushes
#   (`Review app`, `Merger app`, `Writer app`). Its callers reach GitHub only
#   through it.
# `skills/plot/scripts/plot-bitbucket-commit-status.mjs` — writes Bitbucket's
#   `plot/review` commit status with the review identity's credentials.
#
# Usage: check-host-https-callers.sh [root]   (default: this repository)
# Exit 0 clean, 1 on a violation, 2 where the root cannot be entered.

set -uo pipefail

cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

PATTERN='node:https|undici|api\.github\.com|GITHUB_API_URL|api\.bitbucket\.org|BITBUCKET_API_BASE|(^|[^.[:alnum:]_])fetch\('

ALLOWED_PREFIXES='packages/domain/src/adapters/host/
packages/board/src/app/'

ALLOWED_FILES='packages/domain/src/ports/trees.ts
skills/plot/scripts/plot-github-app.mjs
skills/plot/scripts/plot-bitbucket-commit-status.mjs'

roots=''
for dir in packages/*/src; do
  [ -d "$dir" ] && roots="$roots $dir"
done
scripts=''
for file in skills/plot/scripts/*.mjs; do
  [ -f "$file" ] && scripts="$scripts $file"
done

violations=''
exempt=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  body=${rest#*:}

  # A comment about a request is not a request.
  case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
    '*'*|'//'*|'/*'*|'#'*) continue ;;
  esac

  skip=0
  while IFS= read -r prefix; do
    [ -n "$prefix" ] || continue
    case "$file" in "$prefix"*) skip=1 ;; esac
  done <<EOF
$ALLOWED_PREFIXES
EOF
  while IFS= read -r allowed; do
    [ -n "$allowed" ] || continue
    [ "$file" = "$allowed" ] && skip=1
  done <<EOF
$ALLOWED_FILES
EOF
  if [ "$skip" = 1 ]; then
    exempt=$((exempt + 1))
    continue
  fi

  violations="${violations}${file}:${line}: ${body}
"
done <<EOF
$( { [ -z "$roots" ] || grep -rEn --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' "$PATTERN" $roots; \
     [ -z "$scripts" ] || grep -EnH "$PATTERN" $scripts; } 2>/dev/null)
EOF

echo "host HTTPS call sites in exempted paths: $exempt"

if [ -n "$violations" ]; then
  echo "::error::a file outside packages/domain/src/adapters/host/ reaches a git host over HTTPS."
  echo
  echo "The in-process clients in packages/domain/src/adapters/host/ (github-api.ts,"
  echo "bitbucket-api.ts) are the one place that open a connection to the host API. Each reads its credential,"
  echo "charges the shared budget ledger, takes a host slot, honours HTTPS_PROXY and"
  echo "NO_PROXY, and bounds each request at 30 s. Ask through it, or through the"
  echo "Host port, instead."
  echo
  echo "A file that asks a different question - not a git host - is exempted by name"
  echo "in scripts/check-host-https-callers.sh, with the reason."
  echo
  echo "Direct host HTTPS calls:"
  printf '%s' "$violations"
  exit 1
fi

echo "Host HTTPS callers: clean."
