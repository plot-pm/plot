#!/usr/bin/env bash
# THE SHELL THAT DECIDES MAY SHRINK AND MAY NOT GROW.
#
# `check-shell-lines.sh` measures size, and its header says a rule moved into a
# `node -e` heredoc lowers nothing there. This counts the rows of the script
# table in `skills/plot/scripts/README.md` whose Kind is not `launcher`, at the
# merge base and at HEAD, and fails when HEAD holds more. It reads the README's
# claim and not the scripts: a grep over a script body cannot tell a declared
# duplicate from a forgotten one.
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
# hold in the HEAD tree, and at least one of each required kind is named:
#   launcher  a `.mjs` bundle (see BUNDLE EVIDENCE)
#   readings  a `.mjs` bundle (see BUNDLE EVIDENCE)
#   paired    a `rules/*.ts` file, read as packages/domain/src/rules/<file>, and
#             a `*.corpus.test.ts` file, read as packages/domain/corpus/<file>
# The Purpose cell is never read for evidence.
#
# BUNDLE EVIDENCE. A bundle `board/<name>.mjs` counts when one of two holds in
# HEAD: the built file skills/plot/scripts/board/<name>.mjs exists, or
# `packages/board/build.mjs` declares it and the declaration's entry source
# exists. A PR carries no built bundle (`check-no-bundle-diff.sh`), and main
# builds every declared bundle after the merge, so the declaration is the
# evidence a PR can carry. A declaration is a `const shipped<Name>` path to
# skills/plot/scripts/board/<name>.mjs plus an esbuild call whose `entryPoints`
# path and `outfile` (a `const` bound to dist/<name>.mjs) name the same bundle.
# A `build.mjs` that is absent, or in which no declaration parses, fails the
# gate rather than reading as "nothing declared".
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

BUILD=packages/board/build.mjs
declared=""
declared_read=0

# Prints "board/<name>.mjs<TAB><entry path relative to packages/board/>" per
# bundle that build.mjs at HEAD declares, or fails.
read_declared() {
  local text out
  text=$(git show "HEAD:$BUILD" 2>/dev/null) || fail "$BUILD is absent at HEAD, so no declared bundle can be read as evidence."
  out=$(printf '%s\n' "$text" | awk -v q="'" '
    function quoted(s) { sub("^[^" q "]*" q, "", s); sub(q ".*$", "", s); return s }
    BEGIN {
      shipped_re = "^const shipped[A-Za-z]* = path\\.join\\(here, " q "\\.\\./\\.\\./skills/plot/scripts/board/[^" q "]+\\.mjs" q "\\);"
      dist_re = "^const [A-Za-z]+ = path\\.join\\(here, " q "dist/[^" q "]+\\.mjs" q "\\);"
      entry_re = "^[ \t]+entryPoints: \\[path\\.join\\(here, " q "[^" q "]+" q "\\)\\],?[ \t]*$"
      out_re = "^[ \t]+outfile: [A-Za-z]+,?[ \t]*$"
    }
    $0 ~ shipped_re { p = quoted($0); sub(/^.*\/board\//, "", p); shipped[p] = 1; next }
    $0 ~ dist_re { p = quoted($0); sub(/^dist\//, "", p); dist[$2] = p; next }
    $0 ~ entry_re { entry = quoted($0); next }
    $0 ~ out_re {
      v = $2; sub(/,$/, "", v)
      if (entry != "" && (v in dist)) built[dist[v]] = entry
      entry = ""; next
    }
    END { for (b in built) if (b in shipped) printf "board/%s\t%s\n", b, built[b] }
  ')
  [ -n "$out" ] || fail "$BUILD at HEAD declares no bundle this gate can parse, so the declarations cannot serve as evidence. Fix the parser in this script, not the build."
  printf '%s\n' "$out"
}

# True when board/<name>.mjs is built in HEAD, or declared in build.mjs with an
# entry source that exists in HEAD.
bundle_holds() { # <path as named in Replaced by>
  local b entry
  b=${1#skills/plot/scripts/}
  git cat-file -e "HEAD:skills/plot/scripts/$b" 2>/dev/null && return 0
  if [ "$declared_read" -eq 0 ]; then
    declared=$(read_declared) || exit 1
    declared_read=1
  fi
  entry=$(printf '%s\n' "$declared" | awk -F'\t' -v b="$b" '$1 == b { print $2; exit }')
  [ -n "$entry" ] && git cat-file -e "HEAD:packages/board/$entry" 2>/dev/null
}

# True when the file a <prefix> and the path give exists in HEAD.
file_holds() { # <prefix> <path>
  git cat-file -e "HEAD:$1$2" 2>/dev/null
}

# True when every path matching <regex> in <cell> passes <check>, after <strip>
# is removed from its front, and at least one path matches.
named_paths_hold() { # <cell> <regex> <strip-regex> <check...>
  local cell=$1 regex=$2 strip=$3 found=0 p paths
  shift 3
  paths=$(printf '%s\n' "$cell" | grep -oE "$regex" || true)
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    found=1
    p=$(printf '%s' "$p" | sed -E "s#$strip##")
    "$@" "$p" || return 1
  done <<< "$paths"
  [ "$found" -eq 1 ]
}

has_evidence() { # <kind> <replaced-by>
  case "$1" in
    launcher|readings)
      named_paths_hold "$2" '[A-Za-z0-9._/-]+\.mjs' '^$' bundle_holds ;;
    paired)
      named_paths_hold "$2" '[A-Za-z0-9._/-]*rules/[A-Za-z0-9._/-]+\.ts' '^.*rules/' file_holds packages/domain/src/rules/ &&
        named_paths_hold "$2" '[A-Za-z0-9._/-]*\.corpus\.test\.ts' '^.*/' file_holds packages/domain/corpus/ ;;
    *) return 1 ;;
  esac
}

counted() { awk -F'\t' '$2 != "launcher"' ; }

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
    echo "  launcher and readings need a .mjs bundle built under skills/plot/scripts/ or declared in packages/board/build.mjs with its entry source; paired needs a rules/*.ts file under packages/domain/src/ and a *.corpus.test.ts file under packages/domain/corpus/, both in HEAD." >&2
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
