#!/usr/bin/env bash
# THE SHELL THAT DECIDES MAY SHRINK AND MAY NOT GROW.
#
# `check-shell-lines.sh` measures size, and its header says a rule moved into a
# `node -e` heredoc lowers nothing there. This counts the rows of the script
# table in `skills/plot/scripts/README.md` whose Kind is none of `launcher`,
# `readings` or `paired`, at the merge base and at HEAD, and fails when HEAD
# holds more. It reads the README's claim and not the scripts: a grep over a
# script body cannot tell a declared duplicate from a forgotten one.
#
# IT STORES NO NUMBER. The "before" is read from git. There is no override, no
# allowance literal and no environment variable: this script reads none.
#
#   check-decision-count.sh pr            HEAD against `git merge-base HEAD origin/<default>`
#   check-decision-count.sh push <before> HEAD against <before>, the CI event's `before` SHA
#
# THE EVIDENCE RULE. A row whose Kind is new, or changes, to one of the three
# uncounted kinds must carry the proof in the same row, or the label flip lowers
# the count without moving a rule:
#   launcher  a `.mjs` bundle path in Replaced by
#   readings  a `.mjs` bundle path in the row (the bundle that holds the decision)
#   paired    a `rules/*.ts` export and a `*.corpus.test.ts` file in the row
#
# ONLY `.sh` ROWS COUNT. The bundle rows (`board/*.mjs`) share the table and have no Kind.
#
# THE KIND CELL IS READ FROM THE END of the row: Purpose cells hold prose with `|`
# in it, and the last three cells are always Kind, Runs and Replaced by.
#
# ABSENT IS NOT ZERO. A base with no README, no Kind header, or no rows is an
# error to name. A count of 0 at the base would refuse every change.
#
# A PUSH TO main IS REPORTED, NOT REFUSED: a landed commit cannot be refused.
set -euo pipefail

README=skills/plot/scripts/README.md

fail() { echo "check-decision-count: $*" >&2; exit 1; }

default_ref() {
  local ref
  ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null || true)
  echo "${ref:-refs/remotes/origin/main}"
}

# Prints "name<TAB>kind<TAB>replaced-by<TAB>row" per table row, or fails.
rows() {
  local rev=$1 text out
  text=$(git show "$rev:$README" 2>/dev/null) || fail "$README is absent at $rev, so there is nothing to count there."
  out=$(printf '%s\n' "$text" | awk -F'|' '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    /^\| *Script *\|.*\| *Kind *\|/ { intable = 1; seen = 1; next }
    intable && /^\|[- |]+\|?$/ { next }
    intable && /^\|/ {
      name = trim($2)
      if (name !~ /\.sh`?$/) next
      kind = trim($(NF - 3)); rep = trim($(NF - 1)); row = $0
      gsub(/\t/, " ", row)
      printf "%s\t%s\t%s\t%s\n", name, kind, rep, row
      next
    }
    intable { intable = 0 }
    END { if (!seen) exit 3 }
  ') || fail "$README at $rev has no script table with a Kind column."
  [ -n "$out" ] || fail "$README at $rev has a Kind header and no rows."
  printf '%s\n' "$out"
}

counted() { awk -F'\t' '$2 != "launcher" && $2 != "readings" && $2 != "paired"' ; }

report() { # <label> <before-rev> <before-desc>
  local base head before after bad
  base=$(rows "$2") || exit 1
  head=$(rows HEAD) || exit 1
  before=$(printf '%s\n' "$base" | counted | wc -l | tr -d ' ')
  after=$(printf '%s\n' "$head" | counted | wc -l | tr -d ' ')
  echo "check-decision-count: $1: $after scripts still decide or orchestrate now, $before at $3"
  bad=$(awk -F'\t' '
    NR == FNR { was[$1] = $2; next }
    {
      name = $1; kind = $2; rep = $3; row = $4
      if (kind != "launcher" && kind != "readings" && kind != "paired") next
      if ((name in was) && was[name] == kind) next
      ok = 0
      if (kind == "launcher") ok = (rep ~ /\.mjs/)
      else if (kind == "readings") ok = (row ~ /\.mjs/)
      else ok = (row ~ /rules\/[A-Za-z0-9._-]+\.ts/ && row ~ /\.corpus\.test\.ts/)
      if (!ok) print name " -> " kind
    }' <(printf '%s\n' "$base") <(printf '%s\n' "$head"))
  if [ -n "$bad" ]; then
    echo "check-decision-count: kind changed without evidence in the row:" >&2
    printf '%s\n' "$bad" | sed 's/^/  /' >&2
    echo "  launcher needs a .mjs bundle in Replaced by; readings needs the .mjs bundle that holds the decision; paired needs a rules/*.ts export and a *.corpus.test.ts file." >&2
    return 1
  fi
  if [ "$after" -gt "$before" ]; then
    echo "check-decision-count: $((after - before)) more than at $3 ($4)." >&2
    echo "  The shell that decides may shrink and may not grow. Write the rule in packages/domain and ask it through a bundle (docs/shell-and-domain.md)," >&2
    echo "  or convert a row of the same count to launcher, readings or paired with its evidence." >&2
    return 1
  fi
}

mode=${1:-}
case "$mode" in
  pr)
    ref=$(default_ref)
    git rev-parse -q --verify "$ref^{commit}" >/dev/null || fail "$ref is absent, so there is no base to compare with. Run: git fetch --no-tags origin main:refs/remotes/origin/main"
    base=$(git merge-base HEAD "$ref") || fail "no merge base between HEAD and $ref"
    [ -n "$base" ] || fail "no merge base between HEAD and $ref"
    report pr "$base" "merge base $(git rev-parse --short "$base")" "$ref"
    ;;
  push)
    before=${2:-}
    [ -n "$before" ] || fail "push needs the event's before SHA as its second argument"
    git rev-parse -q --verify "$before^{commit}" >/dev/null || fail "before SHA '$before' is not a commit in this clone, so the range has no start"
    report push "$before" "push start $(git rev-parse --short "$before")" "$(git log --format=%h -n 1 HEAD) and the commits since $(git rev-parse --short "$before")"
    ;;
  *) fail "usage: check-decision-count.sh pr | push <before-sha>" ;;
esac
