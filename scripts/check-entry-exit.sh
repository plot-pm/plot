#!/usr/bin/env bash
# THE GATE THAT KEEPS AN ENTRY BUNDLE FROM CUTTING OFF ITS OWN STDOUT.
#
# `process.exit(code)` abandons whatever is still queued on a pipe. Node does
# not wait for a pending write to drain before the process ends, and past
# about 64 KB — the pipe buffer, on both macOS and Linux — that queue is not
# empty. Measured: `plot-ask.mjs board` lost 89% of its answer; `plot-ask.mjs
# fleet` wrote about 150 KB and only 65,536 bytes arrived through a pipe,
# breaking `jq -e .` on the receiving end.
#
# `packages/domain/src/adapters/entry-exit.ts` exports `endEntry(code)`: an
# empty write to stdout with a callback, then one to stderr with a callback,
# THEN `process.exit(code)` — so the exit waits for both streams to confirm
# that everything already queued has actually left. An EPIPE on either stream
# exits at once; there is no case where it should wait on a reader that is
# already gone.
#
# SO A BARE `process.exit` UNDER `packages/*/src/server/entry/` IS ALWAYS
# WRONG, never a style preference weighed against convenience. There is
# nothing here to allow-list: every one of the 66 sites measured when this
# gate was written had to move, and a 67th would be the same defect under a
# new name.
#
# ZERO ALLOWED SITES, NO RATCHET. Unlike `check-script-names.sh`'s falling
# count, a single `process.exit` here is a complete truncation bug on its own
# — there is no healthy nonzero reading to ratchet down from.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/entry-exit-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# Every entry bundle, in every package — not one named package, so a new
# package under `packages/` inherits the gate for free.
GLOB='packages/*/src/server/entry/*.ts'

# shellcheck disable=SC2086
files=$(ls -1 $GLOB 2>/dev/null | sort)

if [ -z "$files" ]; then
  echo "::error::no entry files matched $GLOB."
  echo
  echo "This gate only means something while it can see the files it checks."
  echo "Finding none means the layout changed and the gate is now blind, which"
  echo "is worse than the defect it was written for. Fix the glob."
  exit 2
fi

count=$(printf '%s\n' "$files" | grep -c .)
echo "entry files checked: $count"

violations=""
checked=0

while IFS= read -r file; do
  [ -n "$file" ] || continue
  checked=$((checked + 1))

  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    line=${hit%%:*}
    body=${hit#*:}

    # A comment ABOUT process.exit is not a call. Strip the shape a line
    # comment or the continuation of a block comment takes once leading
    # whitespace is gone.
    case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
      '//'* | '*'* | '/\*'*) continue ;;
    esac

    violations="${violations}${file}:${line}: $(printf '%s' "$body" | sed 's/^[[:space:]]*//')
"
  done <<EOF
$(grep -nE 'process\.exit\(' "$file" 2>/dev/null)
EOF
done <<EOF
$files
EOF

echo "entry files with no process.exit: $((checked - $(printf '%s\n' "$violations" | grep -c ':' || true)))"

if [ -n "$violations" ]; then
  echo "::error::process.exit under packages/*/src/server/entry/ abandons a pending write."
  echo
  echo "process.exit(code) does not wait for a queued stdout/stderr write to"
  echo "drain. Past about 64 KB the output truncates — measured on this estate"
  echo "at 89% of an answer lost. Route the exit through endEntry instead:"
  echo
  echo "    import { endEntry } from '@plot-pm/domain/adapters/entry-exit';"
  echo "    void endEntry(code);"
  echo
  echo "endEntry writes an empty chunk to stdout and to stderr, each with its"
  echo "own callback, and only then calls process.exit — so the exit waits for"
  echo "both streams to confirm the queue is empty. An EPIPE on either stream"
  echo "still exits at once."
  echo
  echo "There is no allow-list: every site under this tree must route through"
  echo "endEntry, with no exception."
  echo
  echo "Direct process.exit calls:"
  printf '%s' "$violations"
  exit 1
fi

echo "Entry exit: clean."
exit 0
