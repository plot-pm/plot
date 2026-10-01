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
#   plot_desk_root [repo [configured]] → the desk root; exit 3 when unaskable
#   plot_exclude_desk_root [repo] → keep it out of `git status`; never fails
#
# shellcheck shell=bash

# The MAIN checkout, from a desk as readily as from the checkout itself.
#
# `--show-toplevel` answers the DESK inside a linked worktree, so with
# `.worktrees` as the default it would resolve `<desk>/.worktrees` and place
# every tree under a root nothing else reads. `plot-reap.sh:440-447` recorded
# that failure on 2026-09-10, when every tree read as unplaceable.
#
# The parent of `--git-common-dir` is the main checkout from anywhere, because
# every linked worktree shares that one directory. It is asked FIRST and
# `--show-toplevel` is the fallback, since the common dir is also correct in a
# non-worktree checkout: there `.git` is a real directory in the root.
#
# PHYSICAL, through `pwd -P`: `git worktree list` and `--show-toplevel` print
# resolved paths, and a desk root composed from a logical one (`/tmp` against
# `/private/tmp` on macOS) is a prefix no worktree path ever starts with.
plot_repo_root() {
  local common root=''
  common=$(git rev-parse --git-common-dir 2>/dev/null) && [ -n "$common" ] && {
    common=$(cd -- "$common" 2>/dev/null && pwd -P) || common=''
    [ -n "$common" ] && root=$(dirname -- "$common")
  }
  [ -n "$root" ] || root=$(git rev-parse --show-toplevel 2>/dev/null) || root=$(pwd)
  printf '%s\n' "$root"
}

# Resolved ONCE at source time, the way `plot-pr-merged.sh:105` resolves its
# own bundle. Computing it inside a function reads `BASH_SOURCE[0]` at call
# time, which is the caller's file once the function has been exported.
_plot_desk_root_dir="${BASH_SOURCE[0]}"
case "$_plot_desk_root_dir" in
  */*) _plot_desk_root_dir="${_plot_desk_root_dir%/*}" ;;
  *)   _plot_desk_root_dir='.' ;;
esac
_plot_desk_root_dir="$(cd -- "$_plot_desk_root_dir" 2>/dev/null && pwd)"
_plot_desk_root_mjs="$_plot_desk_root_dir/board/plot-desk-root.mjs"
_plot_desk_root_config="$_plot_desk_root_dir/plot-config.sh"

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
    configured=$(cd -- "$repo" 2>/dev/null && bash "$_plot_desk_root_config" get "Worktree root" "" 2>/dev/null) || configured=''
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
  common=$(cd -- "$repo" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || return 0
  [ -n "$common" ] || return 0
  case "$common" in /*) ;; *) common="$repo/$common" ;; esac
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
