#!/usr/bin/env bash
# The base ref a merge-base gate compares with, and the fetch that brings it in.
# Sourced, not run, by check-sprint-members.sh, check-shell-lines.sh and
# check-decision-count.sh.
#
#   default_ref [<dir>]
#
# Prints the ref refs/remotes/origin/HEAD points at in the repository at <dir>
# (default: the current directory), or refs/remotes/origin/main where
# origin/HEAD is absent.
#
#   fetch_hint <ref>
#
# Prints the fetch that creates <ref> when <ref> is origin/<branch> or
# refs/remotes/origin/<branch>, with an explicit refspec: the short form
# `git fetch origin <branch>` updates refs/remotes/origin/<branch> only where
# remote.origin.fetch maps that branch. Prints nothing for any other ref (a SHA,
# HEAD~1, a local branch, another remote), which has nothing to fetch.

default_ref() {
  local ref
  ref=$(git -C "${1:-.}" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null || true)
  echo "${ref:-refs/remotes/origin/main}"
}

fetch_hint() {
  local ref=$1 branch
  case "$ref" in
    refs/remotes/origin/?*) branch=${ref#refs/remotes/origin/} ;;
    origin/?*) branch=${ref#origin/} ;;
    *) return 0 ;;
  esac
  echo "git fetch --no-tags origin $branch:refs/remotes/origin/$branch"
}

#   absent_ref_reason <ref>
#
# Prints the one refusal wording the three gates use for an absent <ref>: the
# fetch that creates it, or, where nothing can be fetched, what to pass instead.
absent_ref_reason() {
  local hint
  hint=$(fetch_hint "$1")
  if [ -n "$hint" ]; then
    echo "$1 is absent, so there is no base to compare with. Run: $hint"
  else
    echo "$1 is absent, so there is no base to compare with. Pass a remote-tracking ref such as origin/<branch>, or a commit this clone holds."
  fi
}
