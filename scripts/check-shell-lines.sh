#!/usr/bin/env bash
# THE SHELL UNDER skills/ MAY SHRINK AND MAY NOT GROW.
#
# Shipped shell grew from 6,904 lines in `skills/plot/scripts/` (`91a89d95b`,
# before 2026-09-01) to 11,896 (`6fdc73b36`, before 2026-09-15), and 76 of the
# 85 commits on `main` that touched shipped shell in the 14 days to 2026-10-03
# made it longer. Nothing counted it. This counts it.
#
# THE COUNT is the non-comment, non-blank lines of every `.sh` file under
# `skills/` in a git tree. Slice 2 of `the-shell-shrinks-into-the-domain` and
# the inventory quote the same definition. It measures size, not where decisions
# live: a rule moved into a `node -e` heredoc lowers nothing here, and a reviewer
# reads that, not this script.
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

count_rev() {
  local rev=$1 f c total=0
  while IFS= read -r f; do
    c=$(git show "$rev:$f" | grep -vcE '^[[:space:]]*(#|$)' || true)
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
    echo "  The shell under skills/ may shrink and may not grow. Pay for the growth in one of two ways:" >&2
    echo "    - remove at least $((after - before)) lines of shell elsewhere in this same change, or" >&2
    echo "    - write the rule in packages/domain and ask it through a bundle (docs/shell-and-domain.md)." >&2
    return 1
  fi
}

mode=${1:-}
case "$mode" in
  --per-file)
    for f in $(git ls-files 'skills/*.sh'); do
      printf '%6d %s\n' "$(grep -vcE '^[[:space:]]*(#|$)' "$f" || true)" "$f"
    done | sort -rn
    echo "total: $(git ls-files 'skills/*.sh' | xargs cat | grep -vcE '^[[:space:]]*(#|$)') lines"
    echo "scripts/*.sh (CI and local tooling, not counted above): $(git ls-files 'scripts/*.sh' | xargs cat | grep -vcE '^[[:space:]]*(#|$)') lines"
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
    git rev-parse -q --verify "$before^{commit}" >/dev/null || fail "before SHA '$before' is not a commit in this clone, so the range has no start"
    report push "$before" "push start $(git rev-parse --short "$before")" "$(git log --format=%h -n 1 HEAD) and the commits since $(git rev-parse --short "$before")"
    ;;
  *) fail "usage: check-shell-lines.sh pr | push <before-sha> | --per-file" ;;
esac
