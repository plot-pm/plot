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
# uncounted kinds must carry the proof in its Replaced by cell, or the label
# flip lowers the count without moving a rule. Every path named there must
# exist in the HEAD tree, and at least one of each required kind is named:
#   launcher  a `.mjs` bundle, read as skills/plot/scripts/<bundle>
#   readings  a `.mjs` bundle, read as skills/plot/scripts/<bundle>
#   paired    a `rules/*.ts` file, read as packages/domain/src/rules/<file>, and
#             a `*.corpus.test.ts` file, read as packages/domain/corpus/<file>
# The Purpose cell is never read for evidence.
#
# THE NAME IS THE BACKTICKED TOKEN in the first cell, as `check-helper-table.sh`
# reads it, so `` `x.sh` (sourced) `` names `x.sh`. A table row whose first cell
# holds no backticked `.sh` or `.mjs` name fails. The bundle rows
# (`board/*.mjs`) share the table, have no Kind, and are not counted.
#
# THE TABLE ENDS AT ITS FIRST NON-TABLE LINE. A `.sh` row anywhere else in the
# README fails, so a blank or prose line inside the table cannot hide the rows
# after it.
#
# THE KIND CELL IS READ FROM THE END of the row: Purpose cells hold prose with `|`
# in it, and the last three cells are always Kind, Runs and Replaced by.
#
# ABSENT IS NOT ZERO. A base with no README, no Kind header, or no rows is an
# error to name. A count of 0 at the base would refuse every change.
#
# A PUSH TO main IS REPORTED, NOT REFUSED. A pushed commit cannot be refused
# after it lands; `push` mode fails the run and names the rows, and the next
# push measures only its own range. A merge-base comparison on `main` compares
# HEAD with itself and always passes, which is why `push` has its own "before".
set -euo pipefail

README=skills/plot/scripts/README.md

fail() { echo "check-decision-count: $*" >&2; exit 1; }

default_ref() {
  local ref
  ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null || true)
  echo "${ref:-refs/remotes/origin/main}"
}

# Prints "name<TAB>kind<TAB>replaced-by" per table row, or fails.
rows() {
  local rev=$1 text out status=0 errs
  text=$(git show "$rev:$README" 2>/dev/null) || fail "$README is absent at $rev, so there is nothing to count there."
  out=$(printf '%s\n' "$text" | awk -F'|' '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    function token(cell) {
      if (!match(cell, /`[^`]+`/)) return ""
      return substr(cell, RSTART + 1, RLENGTH - 2)
    }
    /^\| *Script *\|.*\| *Kind *\|/ { intable = 1; seen = 1; next }
    intable && /^\|[- |]+\|?$/ { next }
    intable && /^\|/ {
      name = token($2)
      if (name ~ /\.mjs$/) next
      if (name !~ /\.sh$/) { print "!" NR ": the first cell names no backticked .sh script: " trim($2); next }
      printf "%s\t%s\t%s\n", name, trim($(NF - 3)), trim($(NF - 1))
      next
    }
    intable { intable = 0 }
    /^\|/ && token($2) ~ /\.sh$/ { print "!" NR ": a .sh row outside the Kind table: " token($2) }
    END { if (!seen) exit 3 }
  ') || status=$?
  [ "$status" -eq 0 ] || fail "$README at $rev has no script table with a Kind column."
  errs=$(printf '%s\n' "$out" | sed -n 's/^!/  line /p')
  [ -z "$errs" ] || fail "$README at $rev has rows this gate cannot count:
$errs"
  [ -n "$out" ] || fail "$README at $rev has a Kind header and no rows."
  printf '%s\n' "$out"
}

# True when every path matching <regex> in <cell> exists in HEAD under <prefix>
# after <strip> is removed from its front, and at least one path matches.
named_paths_exist() { # <cell> <regex> <strip-regex> <prefix>
  local found=0 p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    found=1
    p=$(printf '%s' "$p" | sed -E "s#$3##")
    git cat-file -e "HEAD:$4$p" 2>/dev/null || return 1
  done < <(printf '%s\n' "$1" | grep -oE "$2" || true)
  [ "$found" -eq 1 ]
}

has_evidence() { # <kind> <replaced-by>
  case "$1" in
    launcher|readings)
      named_paths_exist "$2" '[A-Za-z0-9._/-]+\.mjs' '^(skills/plot/scripts/)' 'skills/plot/scripts/' ;;
    paired)
      named_paths_exist "$2" '[A-Za-z0-9._/-]*rules/[A-Za-z0-9._/-]+\.ts' '^.*rules/' 'packages/domain/src/rules/' &&
        named_paths_exist "$2" '[A-Za-z0-9._/-]*\.corpus\.test\.ts' '^.*/' 'packages/domain/corpus/' ;;
    *) return 1 ;;
  esac
}

counted() { awk -F'\t' '$2 != "launcher" && $2 != "readings" && $2 != "paired"' ; }

report() { # <label> <before-rev> <before-desc>
  local base head before after bad
  base=$(rows "$2") || exit 1
  head=$(rows HEAD) || exit 1
  before=$(printf '%s\n' "$base" | counted | wc -l | tr -d ' ')
  after=$(printf '%s\n' "$head" | counted | wc -l | tr -d ' ')
  echo "check-decision-count: $1: $after scripts still decide or orchestrate now, $before at $3"
  bad=""
  while IFS=$'\t' read -r name kind rep; do
    has_evidence "$kind" "$rep" || bad+="$name -> $kind"$'\n'
  done < <(awk -F'\t' '
    NR == FNR { was[$1] = $2; next }
    $2 != "launcher" && $2 != "readings" && $2 != "paired" { next }
    ($1 in was) && was[$1] == $2 { next }
    { print }' <(printf '%s\n' "$base") <(printf '%s\n' "$head"))
  bad=${bad%$'\n'}
  if [ -n "$bad" ]; then
    echo "check-decision-count: kind changed without evidence in Replaced by:" >&2
    printf '%s\n' "$bad" | sed 's/^/  /' >&2
    echo "  launcher and readings need a .mjs bundle that exists under skills/plot/scripts/; paired needs a rules/*.ts file under packages/domain/src/ and a *.corpus.test.ts file under packages/domain/corpus/, both in HEAD." >&2
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
