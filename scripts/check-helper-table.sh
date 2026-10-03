#!/usr/bin/env bash
# THE HELPER TABLE STAYS OUT OF `CLAUDE.md`, AND EVERY SCRIPT KEEPS A ROW.
#
# Every Plot session, fleet worker and subagent loads `CLAUDE.md` on its first
# request. Measured 2026-10-02 on `main` at `abc0f784f`: `## Helper Scripts`
# was 84,352 of 139,389 characters — 61% of the file — and no gate, test,
# skill, CI step or worker prompt parsed a single row of it. The table moved
# verbatim to `skills/plot/scripts/README.md`, which nothing loads by default,
# and `CLAUDE.md` kept the path and the rule.
#
# A MOVE IS NOT A GATE. The table came back in `AGENTS.md` once already as an
# 11-row copy that had drifted — it described `plot-reconcile-scan.sh` as
# having nineteen sections while `CLAUDE.md` said twenty-four. Two records of
# one fact disagreeing is the failure this refuses, in both directions:
#
#   (a) a `## Helper Scripts` heading in `CLAUDE.md` WITH A TABLE UNDER IT
#   (b) a `` | `plot- `` TABLE ROW anywhere in `CLAUDE.md`
#   (c) a shipped script with NO ROW in the README — a ratchet
#
# (a) AND (b) ARE SEPARATE because either alone brings the cost back: rows
# under a heading named something else, or the table restored under this one.
#
# (a) REFUSES THE TABLE, NOT THE WORDS. `CLAUDE.md` keeps a two-line
# `## Helper Scripts` section holding the README's path and the rule — the
# pointer is the thing the move leaves behind, so a gate banning the heading
# outright would refuse the very shape it exists to produce. What it reads is
# whether a TABLE DELIMITER (`|---|`) follows the heading before the next one.
#
# Both read the FILE BODY OUTSIDE FENCED CODE BLOCKS, so a section explaining
# this gate can quote what it refuses in an example.
#
# (c) IS A RATCHET, NOT A ZERO. 31 of the 93 shipped scripts had no row when
# this gate was written, so demanding zero would refuse every branch until
# someone wrote 31 rows. The number may fall and may never rise.
#
# THE MATCHING RULE, stated because the baseline is only meaningful with it: a
# script HAS A ROW when a table row's FIRST CELL is exactly its name — ``|
# `plot-host.sh` | …``, with `board/` prefixed for a bundle. Not "the name
# appears somewhere in the section": a script mentioned only in another row's
# prose would pass, and 29 of these names appear in prose. Measured both ways
# on 2026-10-02 — 26 loose against 31 strict — and the strict count is
# recorded, because it is the one that answers *does this script have a row*.
#
# The population is what git TRACKS (`git ls-files`), as `check-desk-markers.sh`
# reads it, so an untracked scratch script never fails the gate.
#
# Usage: check-helper-table.sh [repo-root]   (default: this repository)
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

claude_md="$root/CLAUDE.md"
readme="$root/skills/plot/scripts/README.md"

# A GATE THAT CANNOT READ ITS INPUTS FAILS LOUDLY. An absent file is not an
# absent violation, and exiting 0 here would report a clean estate nothing
# measured.
for f in "$claude_md" "$readme"; do
  if [ ! -f "$f" ]; then
    echo "::error::check-helper-table.sh cannot read ${f#$root/}. The gate refuses rather than passing on a file it never read."
    exit 1
  fi
done

# --- read CLAUDE.md's body, outside fenced code blocks ----------------------
#
# A fence is ``` or ~~~ at the start of a line. Everything between an opener
# and its closer is an EXAMPLE, including an example of the heading this gate
# bans — which this very repository needs, because a section documenting the
# gate quotes what it refuses.
body_outside_fences() {
  awk '
    /^(```|~~~)/ { fence = !fence; next }
    !fence       { print }
  ' "$1"
}

prose="$(body_outside_fences "$claude_md")"

# A heading is a violation only when a TABLE follows it before the next
# heading. The two-line pointer section is the shape the move produces.
bad_heading="$(printf '%s\n' "$prose" | awk '
  /^#{1,6}[[:space:]]*Helper Scripts[[:space:]]*$/ { inside = 1; line = NR; next }
  /^#{1,6}[[:space:]]/                             { inside = 0; next }
  inside && /^\|[[:space:]]*-{2,}/ { print line ":" $0; inside = 0 }
' || true)"

bad_rows="$(printf '%s\n' "$prose" | grep -n '^|[[:space:]]*`plot-' || true)"

fail=0

if [ -n "$bad_heading" ]; then
  echo "::error::CLAUDE.md carries a Helper Scripts TABLE. It costs every agent's first request and belongs in skills/plot/scripts/README.md; CLAUDE.md keeps the path and the rule."
  printf '%s\n' "$bad_heading" | sed 's/^/  /'
  fail=1
fi

if [ -n "$bad_rows" ]; then
  echo "::error::CLAUDE.md carries helper-table rows. Move them to skills/plot/scripts/README.md; CLAUDE.md keeps the path and the rule."
  printf '%s\n' "$bad_rows" | sed 's/^/  /'
  fail=1
fi

# --- (c) the ratchet: a shipped script with no row --------------------------
#
# BASELINE, measured by this script's own rule at the commit that introduced
# it. Lower it when rows are written; never raise it.
BASELINE="${PLOT_HELPER_ROW_BASELINE:-18}"

rows_tmp="$(mktemp "${TMPDIR:-/tmp}/plot-helper-rows.XXXXXX")"
files_tmp="$(mktemp "${TMPDIR:-/tmp}/plot-helper-files.XXXXXX")"
trap 'rm -f "$rows_tmp" "$files_tmp"' EXIT

# The first cell of every table row, unwrapped from its backticks.
sed -n 's/^|[[:space:]]*`\([^`]*\)`.*/\1/p' "$readme" | sort -u > "$rows_tmp"

# THE SHIPPED POPULATION: top-level `.sh` helpers and the `board/*.mjs`
# bundles. Both are what a skill or a loop invokes by name. Nothing else in
# the directory ships — and every one of the 35 tracked bundles is marked
# `-merge` in `.gitattributes`, so the two sets need no by-name exceptions.
{
  git -C "$root" ls-files 'skills/plot/scripts/*.sh'
  git -C "$root" ls-files 'skills/plot/scripts/board/*.mjs'
} | sed 's|^skills/plot/scripts/||' | sort -u > "$files_tmp"

if [ ! -s "$files_tmp" ]; then
  echo "::error::check-helper-table.sh found no tracked scripts under skills/plot/scripts. That is a gate that cannot read its inputs, not an estate with no scripts."
  exit 1
fi

missing="$(comm -23 "$files_tmp" "$rows_tmp" || true)"
n_missing="$(printf '%s' "$missing" | grep -c . || true)"

if [ "$n_missing" -gt "$BASELINE" ]; then
  echo "::error::$n_missing shipped scripts have no row in skills/plot/scripts/README.md, up from the baseline of $BASELINE. A new script gets a row."
  printf '%s\n' "$missing" | sed 's/^/  /'
  echo "A row's FIRST CELL must be the script's name: | \`plot-thing.sh\` | what it answers |   (board/ prefixed for a bundle)."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "helper table: CLAUDE.md holds no table, and $n_missing of $(grep -c . "$files_tmp") shipped scripts lack a row (baseline $BASELINE)."
