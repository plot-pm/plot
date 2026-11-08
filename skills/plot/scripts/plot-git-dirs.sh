#!/usr/bin/env bash
# A checkout's git directories from an exported answer, with no git process —
# sourced, not run, by `plot-worker-state.sh`, `plot-desk-root.sh`,
# `plot-agent-settings.sh` and `plot-host.sh`.
#
# fleetd and the board export `PLOT_REPO_ROOT` and `PLOT_GIT_COMMON_DIR` to the
# scripts they start (`git-dirs.ts`); `plot-worker-state.sh` exports the second
# on sourcing. A script that reads them asks git nothing for an answer that
# does not change while its parent runs. `givenGitDirs` in `git-dirs.ts`
# applies the same check to a node bundle.
#
# shellcheck shell=bash

# The common git dir of a directory from an exported answer — or, with `top`
# as the second argument, the directory's top level, which `--show-toplevel`
# prints. Non-zero and nothing printed when the answer is not this directory's,
# and the caller asks git.
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
