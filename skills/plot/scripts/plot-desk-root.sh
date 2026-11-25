#!/usr/bin/env bash
# The ONE answer to "where do desks and action records go?" — sourced, not run.
#
# Every script that resolved this privately asks here instead. Nine sites
# computed the rule on 2026-10-01 and two of them already answered `.worktrees`
# while seven answered the checkout's parent, so one of the two populations was
# always writing somewhere the other did not read.
#
# The rule itself is `deskRoot` in the domain, asked through
# `board/plot-desk-root.mjs`, per *A Shell Script Asks The Domain*: every caller
# runs once per operator command, which is the cost rule's permitted case.
#
# NO CALLER KEEPS A FALLBACK DEFAULT. When the bundle cannot answer — no `node`,
# a missing file — the caller stops with the reason. A silent fallback is a
# second default, and two defaults are the defect this removes.
#
#   plot_repo_root            → the MAIN checkout, from anywhere
#   plot_checkout_of_common dir → the main checkout of a physical common git dir
#   plot_desk_root [repo [configured]] → the desk root; exit 3 when unaskable
#   plot_exclude_desk_root [repo] → keep it out of `git status`; never fails
#   plot_given_common_dir dir [top] → the common git dir (or top level) from an
#                             exported answer, with no git process
#
# shellcheck shell=bash

# The common git dir of a directory from an exported answer — or, with `top`
# as the second argument, the directory's top level, which `--show-toplevel`
# prints. Non-zero and nothing printed when the answer is not this directory's,
# and the caller asks git.
#
# fleetd and the board pass `PLOT_REPO_ROOT` and `PLOT_GIT_COMMON_DIR` to the
# scripts they start (`git-dirs.ts`), and `plot-worker-state.sh` exports the
# second on sourcing. `givenGitDirs` in `git-dirs.ts` applies the same check to
# a node bundle.
#
# The candidate is `PLOT_GIT_COMMON_DIR`, else `$PLOT_REPO_ROOT/.git`. It holds
# only when the first `.git` above the directory is that dir itself (the main
# checkout) or a file whose `gitdir:` lies under its `worktrees/` (a desk).
# Every worktree of one repository shares the common dir, so an answer passes
# between desks; another repository's `.git` refuses it. Both answers are
# physical, as git prints them. Every caller runs it in a command
# substitution, so its variables need no `local`.
plot_given_common_dir() { # $1=directory [$2=top] → the physical common dir (or top level), or "" (non-zero)
  c=$(cd -- "${PLOT_GIT_COMMON_DIR:-${PLOT_REPO_ROOT:-/nonexistent}/.git}" 2>/dev/null && pwd -P) && d=$(cd -- "$1" 2>/dev/null && pwd -P) || return 1
  while [ ! -e "$d/.git" ] && [ -n "$d" ]; do d=${d%/*}; done
  [ -d "$d/.git" ] && line="gitdir: $d/.git/worktrees/" || IFS= read -r line < "$d/.git" || return 1
  [ "${line#"gitdir: $c/worktrees/"}" != "$line" ] || return 1
  [ "${2:-}" = top ] && c=$d; printf '%s' "$c"
}

# The main checkout of a physical common git dir.
#
# A common dir named `.git` lies in its checkout, so the answer is its parent
# and no process starts: `plot-worker-state.sh` asks this once per desk probe.
# Any other common dir (a submodule's `<workspace>/.git/modules/app/web`) names
# its checkout in `core.worktree`, relative to the common dir or absolute. With
# no such key, or a key naming no directory, the answer is the parent (#3043).
# Reading `core.worktree` of a `.git` dir would move a checkout that sets the
# key for another reason.
plot_checkout_of_common() { # $1=physical common dir → the main checkout
  local wt
  [ "${1##*/}" != .git ] && wt=$(git --git-dir="$1" config --get core.worktree 2>/dev/null) && (cd -- "$1" && cd -- "$wt" && pwd -P) 2>/dev/null || dirname -- "$1"
}

# The MAIN checkout, from a desk as readily as from the checkout itself.
#
# `--show-toplevel` answers the DESK inside a linked worktree, so with
# `.worktrees` as the default it would resolve `<desk>/.worktrees` and place
# every tree under a root nothing else reads (`plot-reap.sh:440-447`,
# 2026-09-10). Every linked worktree shares one common dir, so
# `plot_checkout_of_common` answers the main checkout from anywhere;
# `--show-toplevel` is the fallback outside that.
#
# An exported answer is taken when it is this checkout's (`plot_given_common_dir`),
# and git is asked otherwise. The answer is PHYSICAL, through `pwd -P`: a desk
# root composed from a logical path (`/tmp` against `/private/tmp` on macOS) is
# a prefix no path `git worktree list` prints starts with.
plot_repo_root() {
  local root
  root=$(plot_given_common_dir "$PWD" || git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && root=$(cd -- "$root" 2>/dev/null && pwd -P) && root=$(plot_checkout_of_common "$root") || root=$(git rev-parse --show-toplevel 2>/dev/null) || root=$(pwd)
  printf '%s\n' "$root"
}

# Resolved ONCE at source time, the way `plot-pr-merged.sh:105` resolves its
# own bundle. Computing it inside a function reads `BASH_SOURCE[0]` at call
# time, which is the caller's file once the function has been exported. It
# starts no program: `plot-worker-state.sh` sources this file in every per-desk
# probe. A bare file name has no directory part, and the cwd holds it.
_plot_desk_root_mjs="$(cd -- "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd || pwd)/board/plot-desk-root.mjs"
_plot_desk_root_config="${_plot_desk_root_mjs%/board/*}/plot-config.sh"

# The desk root for a repository, or exit 3 with the reason on stderr.
#
# A second argument is a value the caller was handed in place of the key — a
# `--worktrees DIR` flag — and goes through the same rule; without one the
# `Worktree root` key is read.
#
# READ THE EXIT CODE. A caller that treats an empty answer as a location would
# compose paths against the filesystem root.
plot_desk_root() {
  local repo="${1:-}" bundle="$_plot_desk_root_mjs" configured answer
  [ -n "$repo" ] || repo=$(plot_repo_root)
  if [ ! -f "$bundle" ]; then
    printf 'plot: cannot resolve the desk root: %s is missing\n' "$bundle" >&2
    return 3
  fi
  if [ "$#" -ge 2 ]; then
    configured="$2"
  else
    # Read from the TARGET repository, never the ambient one: `plot-config.sh`
    # walks up from its cwd, so a caller asking about another checkout would
    # otherwise get this one's key.
    # A read that fails is a refusal, never the absent row: reading it as empty
    # would answer the default for a repository that configured another root.
    configured=$(cd -- "$repo" 2>/dev/null && bash "$_plot_desk_root_config" get "Worktree root" "" 2>/dev/null) || {
      printf 'plot: cannot resolve the desk root: the Worktree root key in %s could not be read\n' "$repo" >&2
      return 3
    }
  fi
  answer=$(node "$bundle" "$repo" "$configured" 2>&1) || {
    printf 'plot: cannot resolve the desk root: %s\n' "$answer" >&2
    return 3
  }
  [ -n "$answer" ] || {
    printf 'plot: the desk root rule answered nothing for %s\n' "$repo" >&2
    return 3
  }
  printf '%s\n' "$answer"
}

# Keep the desk root out of `git status`, when it lies inside the repository.
#
# The line goes into the COMMON git directory's `info/exclude`: git reads that
# file from the common directory only, so a linked worktree's private gitdir is
# the wrong place and a desk writing there would exclude nothing. The write is
# idempotent, and `info/exclude` is never committed.
#
# Called by whoever CREATES the directory. Best-effort and always exit 0: a
# failure leaves untracked files in a listing, which is untidy, while refusing
# to create a desk over it would stop the work.
plot_exclude_desk_root() {
  local repo="${1:-}" bundle="$_plot_desk_root_mjs" line common exclude configured
  [ -n "$repo" ] || repo=$(plot_repo_root)
  [ -f "$bundle" ] || return 0
  configured=$(cd -- "$repo" 2>/dev/null && bash "$_plot_desk_root_config" get "Worktree root" "" 2>/dev/null) || configured=''
  line=$(node "$bundle" --exclude-line "$repo" "$configured" 2>/dev/null) || return 0
  # Empty means the root lies outside the repository, which needs no line.
  [ -n "$line" ] || return 0
  # Already ignored, by a `.gitignore` line /plot-init wrote or by an earlier
  # run. A second rule for a path already ignored is noise in a file people read.
  ( cd -- "$repo" 2>/dev/null && git check-ignore -q ".$line" ) && return 0
  common=$(plot_given_common_dir "$repo" || git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  exclude="$common/info/exclude"
  if [ -f "$exclude" ] && grep -qxF "$line" "$exclude" 2>/dev/null; then return 0; fi
  mkdir -p "$common/info" 2>/dev/null || return 0
  # A file not ending in a newline would otherwise join this line to its last.
  if [ -s "$exclude" ] && [ "$(tail -c 1 "$exclude" 2>/dev/null)" != "" ]; then
    printf '\n%s\n' "$line" >> "$exclude" 2>/dev/null || true
  else
    printf '%s\n' "$line" >> "$exclude" 2>/dev/null || true
  fi
  return 0
}
