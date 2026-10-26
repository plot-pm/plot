#!/usr/bin/env bash
# THE SHELL UNDER skills/ MAY SHRINK AND MAY NOT GROW.
#
# Shipped shell grew from 6,904 lines in `skills/plot/scripts/` (`91a89d95b`,
# before 2026-09-01) to 11,896 (`6fdc73b36`, before 2026-09-15), and 76 of the
# 85 commits on `main` that touched shipped shell in the 14 days to 2026-10-03
# made it longer. Nothing counted it. This counts it.
#
# THE COUNT is the commands in the non-comment, non-blank lines of every `.sh`
# file under `skills/` in a git tree. A line counts once per command: `a; b`,
# `a && b`, `a || b` and `x; fi` count two, so joining statements never lowers
# it. A separator inside quotes or after a backslash does not split. A keyword
# that starts a body (`then`, `do`, `else`, `{`) and a case pattern (`a)`) each
# count one more when a command follows on the same line, and `;;` counts one,
# because each of those is a line of its own when written out. Where a line is
# ambiguous (a heredoc body, a quote that spans lines) the count errs high.
# It measures size, not where decisions live: a rule moved into a `node -e`
# heredoc lowers nothing here, and a reviewer reads that, not this script.
# NOT COUNTED: a backslash continuation and a pipeline split over lines.
#
# IT STORES NO NUMBER. A stored baseline drifts, makes two PRs that each shrink
# the shell conflict on one line, and invites a switch that turns it off. The
# "before" is read from git, so room freed by a merged change is gone for the
# next change. There is no override, no allowance literal and no environment
# variable: this script reads none.
#
#   check-shell-lines.sh pr            HEAD against `git merge-base HEAD origin/<default>`
#   check-shell-lines.sh push <before> HEAD against <before>, the CI event's `before` SHA,
#                                      so a push of several commits is one range
#   check-shell-lines.sh --per-file    each file's count, largest first, then scripts/*.sh
#
# A REVERT PASSES, recognised by its tree and not its subject: the change's net
# diff restores every path one commit on the default branch touched, to the blob
# that commit's parent held, and touches nothing else. A subject match would let
# a hand-written "Revert" through and refuse a reworded revert.
#
# A PUSH TO main IS REPORTED, NOT REFUSED. A pushed commit cannot be refused
# after it lands; `push` mode fails the run and names the lines, and the next
# push measures only its own range. A merge-base comparison on `main` compares
# HEAD with itself and always passes, which is why `push` has its own "before".
#
# AN UNREADABLE BASE FAILS, never passes. An empty "before" reads as zero lines
# and would refuse everything; a count compared with nothing is not a pass.
set -euo pipefail

# The one definition of the unit: reads shell on stdin, prints its command count.
read -r -d '' COUNT_AWK <<'AWK' || true
function flush() {
  sub(/^[ \t]+/, "", piece)
  if (piece == "") return
  total++
  if (piece ~ /^(then|do|else|\{)[ \t]+[^ \t]/ || piece ~ /^[^ \t()=$"']*\)[ \t]+[^ \t;]/) total++
  piece = ""
}
/^[ \t]*(#|$)/ { next }
{
  q = ""; piece = ""; n = length($0)
  for (i = 1; i <= n; i++) {
    c = substr($0, i, 1); d = substr($0, i + 1, 1)
    if (c == "\\" && q != "'") { piece = piece c d; i++; continue }
    if (q != "") { if (c == q) q = ""; piece = piece c; continue }
    if (c == "'" || c == "\"") { q = c; piece = piece c; continue }
    if (c == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[ \t]/)) break
    if (c == ";" && d == ";") { flush(); total++; i++; continue }
    if (c == ";" || (c == "&" && d == "&") || (c == "|" && d == "|")) { flush(); if (c != ";") i++; continue }
    piece = piece c
  }
  flush()
}
END { print total + 0 }
AWK

# LC_ALL=C: a byte that is not valid UTF-8 aborts BSD awk mid-file and lowers the count.
count_stdin() { LC_ALL=C awk "$COUNT_AWK"; }

count_rev() {
  local rev=$1 f c total=0
  while IFS= read -r f; do
    c=$(git show "$rev:$f" | count_stdin)
    total=$((total + c))
  done < <(git ls-tree -r --name-only "$rev" -- skills | grep '\.sh$' || true)
  echo "$total"
}

fail() { echo "check-shell-lines: $*" >&2; exit 1; }

default_ref() {
  local ref
  ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null || true)
  echo "${ref:-refs/remotes/origin/main}"
}

# Prints the abbreviated sha of a default-branch commit the range from $1 to HEAD
# exactly reverses, or nothing.
reverted_commit() {
  local base=$1 changed r p ok
  changed=$(git diff --name-only "$base" HEAD)
  [ -n "$changed" ] || return 0
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    [ "$(git diff-tree --no-commit-id --name-only -r "$r" | sort)" = "$(echo "$changed" | sort)" ] || continue
    ok=1
    while IFS= read -r p; do
      [ "$(git rev-parse -q --verify "HEAD:$p" 2>/dev/null || true)" = "$(git rev-parse -q --verify "$r^:$p" 2>/dev/null || true)" ] || { ok=0; break; }
    done <<< "$changed"
    if [ "$ok" = 1 ]; then git rev-parse --short "$r"; return 0; fi
  done < <(git rev-list -n 300 --max-parents=1 "$base" -- $(echo "$changed" | head -1))
}

report() { # <label> <before-rev> <before-desc> <named-in-failure>
  local before after
  before=$(count_rev "$2")
  after=$(count_rev HEAD)
  echo "check-shell-lines: $1: $after lines now, $before at $3"
  if [ "$after" -gt "$before" ]; then
    echo "check-shell-lines: $((after - before)) lines over $3 ($4)." >&2
    echo "  A line counts once per command. Joining statements with ';' or '&&', or folding 'fi' or 'done' onto the line before, is not a payment." >&2
    echo "  The shell under skills/ may shrink and may not grow. Pay for the growth in one of two ways:" >&2
    echo "    - remove at least $((after - before)) lines of shell elsewhere in this same change, or" >&2
    echo "    - write the rule in packages/domain and ask it through a bundle (docs/shell-and-domain.md)." >&2
    return 1
  fi
}

mode=${1:-}
case "$mode" in
  --per-file)
    while IFS= read -r f; do
      c=$(count_stdin < "$f")
      printf '%6d %s\n' "$c" "$f"
    done < <(git ls-files 'skills/*.sh') | sort -rn
    echo "total: $(git ls-files 'skills/*.sh' | xargs cat | count_stdin) lines"
    echo "scripts/*.sh (CI and local tooling, not counted above): $(git ls-files 'scripts/*.sh' | xargs cat | count_stdin) lines"
    ;;
  pr)
    ref=$(default_ref)
    git rev-parse -q --verify "$ref^{commit}" >/dev/null || fail "$ref is absent, so there is no base to compare with. Run: git fetch --no-tags origin main:refs/remotes/origin/main"
    base=$(git merge-base HEAD "$ref") || fail "no merge base between HEAD and $ref"
    [ -n "$base" ] || fail "no merge base between HEAD and $ref"
    if rev=$(reverted_commit "$base") && [ -n "$rev" ]; then
      echo "check-shell-lines: pr: this change reverses $rev exactly, which passes."
      exit 0
    fi
    report pr "$base" "merge base $(git rev-parse --short "$base")" "$ref"
    ;;
  push)
    before=${2:-}
    [ -n "$before" ] || fail "push needs the event's before SHA as its second argument"
    if ! git rev-parse -q --verify "$before^{commit}" >/dev/null; then
      git fetch --no-tags origin "$before" >/dev/null 2>&1 || true
      if ! git rev-parse -q --verify "$before^{commit}" >/dev/null; then
        git rev-parse -q --verify "HEAD^1^{commit}" >/dev/null || fail "before SHA '$before' is not a commit in this clone, and HEAD has no parent to fall back to"
        echo "check-shell-lines: before SHA '$before' is not in this clone; the range starts at HEAD^1 because '$before' is not in the clone."
        before=$(git rev-parse HEAD^1)
      fi
    fi
    report push "$before" "push start $(git rev-parse --short "$before")" "$(git log --format=%h -n 1 HEAD) and the commits since $(git rev-parse --short "$before")"
    ;;
  *) fail "usage: check-shell-lines.sh pr | push <before-sha> | --per-file" ;;
esac
