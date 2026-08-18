#!/usr/bin/env bash
# Plot helper: start the board, fetch its data, stop it.
# Usage: plot-board-verify.sh <artifact path>
# Output: the /api/board payload on stdout. Exit 0 only if it was fetched.
#
# THE TEARDOWN IS WHY THIS IS A SCRIPT. The sequence is short enough to write
# into a skill as prose, and CLAUDE.md's `Gates Over Rules` explains why that
# would be wrong: "always stop the server" is a rule an agent can believe it
# followed. `trap cleanup EXIT` is a gate — the shell reaps the process on
# every exit path, including the assertion failures that prose forgets.
#
# PORT=0 asks the OS for a free port, so a verification run can never collide
# with a board the user already has open on 7777.
set -uo pipefail

artifact="${1:?Usage: plot-board-verify.sh <artifact path>}"
[ -f "$artifact" ] || { echo "plot-board-verify: no artifact at $artifact" >&2; exit 1; }

pid=""
tmpout=""
cleanup() {
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
  [ -n "${tmpout:-}" ] && rm -f "$tmpout"
  return 0
}
trap cleanup EXIT INT TERM

tmpout=$(mktemp)
PORT=0 node "$artifact" > "$tmpout" 2>&1 &
pid=$!

# The server prints its bound URL once listening. Poll for that line rather
# than sleeping a guessed interval: a fixed sleep is either flaky or slow.
port=""
for _ in $(seq 1 100); do
  port=$(grep -oE 'localhost:[0-9]+' "$tmpout" 2>/dev/null | head -1 | cut -d: -f2)
  [ -n "$port" ] && break
  kill -0 "$pid" 2>/dev/null || { echo "plot-board-verify: server exited early" >&2; cat "$tmpout" >&2; exit 1; }
  sleep 0.1
done
[ -n "$port" ] || { echo "plot-board-verify: server never reported a port" >&2; cat "$tmpout" >&2; exit 1; }

body=$(curl -sf --max-time 10 "http://localhost:${port}/api/board") || {
  echo "plot-board-verify: /api/board did not answer on port ${port}" >&2
  exit 1
}
printf '%s\n' "$body"
