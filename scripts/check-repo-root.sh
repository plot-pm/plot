#!/usr/bin/env bash
# THE REPOSITORY ROOT HOLDS ONLY WHAT PLOT SHIPS. A top-level entry that is not
# on `scripts/repo-root.allowed` is a stray: a scratch file, a diff kept for a
# moment, a tool's output folder. The plugin installs from a tag of this
# repository, so a stray at the root is in every installed copy.
#
# Measured 2026-11-21: `main` tracked 36 root entries and 6 of them were
# scratch. Five files came in with `534b4958c` (2026-08-28), a commit about a
# design spec, and the 60 browser snapshots of `.playwright-mcp/` came in with
# `223b5e73d` (2026-08-23, #372). Nothing in the tree referenced any of them.
# The same defect had occurred once before below the root (a stale copy of one
# skill next to its `SKILL.md`), and no gate followed it.
#
# THE LIST IS WRITTEN, NOT DERIVED. Other gates here derive their set from a
# declaration (`lib-declared-bundles.sh` for bundles). A root has no
# declaration to derive from. A one-purpose file makes each new root entry a
# visible diff that a reviewer reads, and the reason goes in the pull request.
#
# IT CHECKS THE FIRST PATH SEGMENT ONLY. A stray file below `docs/` or
# `packages/` is a different question and stays unguarded.
#
# It reads what git TRACKS, never the working tree, as `check-desk-markers.sh`
# does: an untracked scratch file is not in the diff, and `.gitignore` is the
# answer to one that keeps coming back.
#
# AN ENTRY THAT GIT NO LONGER TRACKS IS A NOTICE, NOT A FAILURE. A removed root
# entry must not block the pull request that removes it. The notice names the
# line to delete.
#
# AN UNREADABLE LIST IS EXIT 2, NOT A PASS. A gate that cannot read its input
# checks nothing, which is worse than the defect it was written for.
#
# Usage: check-repo-root.sh [repo-root] [allow-list]
#   repo-root   default: this repository
#   allow-list  default: repo-root.allowed beside this script. One name per
#               line; blank lines and lines that start with `#` are ignored. A
#               line is a name, never a pattern.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${1:-$(cd "$here/.." && pwd)}"
allow_file="${2:-$here/repo-root.allowed}"

if [ ! -f "$allow_file" ]; then
  echo "::error::$allow_file is missing; the allowed root entries cannot be read."
  exit 2
fi

# One name per line: whitespace trimmed, comment and blank lines dropped.
allowed=$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$allow_file" | grep -v -e '^#' -e '^$' || true)

if [ -z "$allowed" ]; then
  echo "::error::$allow_file names no entry; the gate is now blind."
  exit 2
fi

if ! tracked=$(git -C "$root" ls-files -z | tr '\0' '\n'); then
  echo "::error::git could not list the files tracked at $root; the root cannot be read."
  exit 2
fi

if [ -z "$tracked" ]; then
  echo "::error::no file is tracked at $root; the gate is now blind."
  exit 2
fi

entries=$(printf '%s\n' "$tracked" | cut -d/ -f1 | sort -u)

# Exact, literal membership of $2 in the newline-separated list $1. A name with
# a glob character is matched as written.
listed() {
  case $'\n'"$1"$'\n' in
    *$'\n'"$2"$'\n'*) return 0 ;;
  esac
  return 1
}

unknown=""
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  listed "$allowed" "$entry" || unknown="${unknown}${entry}
"
done <<EOF
$entries
EOF

while IFS= read -r name; do
  [ -n "$name" ] || continue
  listed "$entries" "$name" || echo "::notice::$(basename "$allow_file") names $name, which git no longer tracks at the root. Delete that line."
done <<EOF
$allowed
EOF

if [ -n "$unknown" ]; then
  echo "::error::the repository root holds an entry that is not on the allow-list. The root holds only what Plot ships."
  printf '%s' "$unknown" | sed 's/^/  /'
  echo "Move it below the directory that owns it, or remove it from the branch: git rm -r --cached <entry>, then commit. A new top-level entry is added to scripts/repo-root.allowed in the same pull request, with its reason in the pull request."
  exit 1
fi

echo "repo root: every tracked root entry is on the allow-list ($(printf '%s\n' "$entries" | grep -c .) entries)."
