#!/usr/bin/env bash
# Plot helper: push a disposable branch at the default branch, and say what
# actually happened to it.
# Usage: plot-push-main.sh <branch> <default-branch>
#        plot-push-main.sh --classify <exit-code> <<<"<stderr text>"
# Output: one status line on stdout, prefixed `push:`, plus any remote message
#         lines indented beneath it. Exit 0 if the commit landed on the default
#         branch (clean, bypassed, or unknown), 1 if the push was refused.
# Designed for small-model consumption: one status word, no interpretation.
#
# WHY THIS EXISTS. Three commands push straight at the default branch to record
# bookkeeping — /plot-approve, /plot-deliver, and the hub's phase-fix sequence.
# Each documented (or, in two cases, did not document) a branch-protection
# fallback phrased as "if that push is rejected". That condition never occurs on
# a repo whose protection is configured but not enforced for the pushing actor:
# GitHub WAVES THE PUSH THROUGH and prints a notice. So the fallback never fired
# once, and eight approvals landed on this repo's main past a rule requiring a
# pull request, each without the required check ever running.
#
# Nothing was harmed by that — the repo's owner is entitled to bypass its own
# protection, and the plans landed correctly. The defect is that Plot could not
# TELL the two apart: a bypassed push and a clean push look identical to a
# caller that only inspects the exit code.
#
# THE EXIT CODE ANSWERS ONE QUESTION: did the commit land? `clean`, `bypassed`
# and `unknown` all exit 0, because in every one of them the work is on the
# default branch and the caller should carry on. Only `rejected` exits 1, where
# the caller must open a micro-PR instead. Making `bypassed` non-zero would turn
# a SUCCESSFUL approval into an apparent failure at three call sites.
#
# This script pushes and classifies. It does not open the micro-PR: that needs
# the host adapter, a PR title and a merge strategy, and would make this a
# second place that knows what approving means. Skills interpret; scripts
# collect and report (Principle 3).
set -uo pipefail

# The four outcomes. Read from a captured stderr rather than from the exit code
# alone, because the exit code cannot distinguish the middle two:
#
#   rejected  — exit != 0. Protection refused the push, or the ref moved.
#   bypassed  — exit 0, and the remote said it waived its own rules.
#   unknown   — exit 0, and the remote said something we do not recognise.
#   clean     — exit 0, and the remote said nothing.
#
# `unknown` is the one that keeps this honest. "Bypassed rule violations" is
# GitHub's current wording, not a documented API; Bitbucket phrases its
# equivalent differently. If the wording changes, a three-outcome classifier
# would silently file every future bypass under `clean` — a check that goes
# quiet exactly when it stops working, which is the defect this script exists
# to remove. So output we cannot read is its own answer, never a clean bill.
classify() {
  local code="$1" err="$2"

  [ "$code" -ne 0 ] && { printf 'rejected'; return; }

  # Match GitHub's bypass notice. Case-insensitive on the leading word only —
  # deliberately narrow, because a loose pattern would file ordinary remote
  # chatter ("bypass" appears in plenty of hook output) as a protection bypass,
  # and a false alarm here trains people to ignore the real one.
  if printf '%s' "$err" | grep -qi 'bypassed rule violations'; then
    printf 'bypassed'
    return
  fi

  # Any other remote commentary is unrecognised, not absent. `remote:` is git's
  # own prefix for everything the server says, so its presence means the remote
  # spoke and we failed to understand it.
  if printf '%s' "$err" | grep -q '^remote:'; then
    printf 'unknown'
    return
  fi

  printf 'clean'
}

# Classification is exposed as its own entry point because the outcome that
# matters CANNOT be produced in CI: a real bypass needs a protected GitHub
# remote plus an actor entitled to step over it, and the test suite has neither.
# Splitting the decision out makes the untestable path testable — it is the half
# with no I/O in it — and lets the tests feed the real recorded stderr instead of
# a paraphrase that would only test the matcher against itself.
if [ "${1:-}" = "--classify" ]; then
  code="${2:?--classify needs an exit code}"
  err=$(cat)
  classify "$code" "$err"
  echo
  exit 0
fi

branch="${1:?plot-push-main: need a branch to push}"
default="${2:?plot-push-main: need the default branch}"

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "plot-push-main: not a git repository" >&2
  exit 1
}

# stderr is captured rather than passed through, because it carries the ONLY
# signal that separates a bypass from a clean push. A call site ending in
# `2>/dev/null` — as several of Plot's pushes do — discards exactly the line
# that answers the question.
err=$(git push origin "$branch:$default" 2>&1 >/dev/null)
code=$?

status=$(classify "$code" "$err")

# The remote's own words, never a paraphrase. Which rules were stepped over and
# which checks did not run is information only the remote has, and re-wording it
# here would be a second copy that drifts.
remote_lines=$(printf '%s' "$err" | grep '^remote:' | sed 's/^remote: *//' | sed '/^$/d')

case "$status" in
  clean)
    echo "push: clean — $branch → $default"
    ;;
  bypassed)
    # Phrased as a report, not a warning: on a repo that permits this the push
    # is legitimate and there is nothing to undo. What the reader needs is the
    # fact that protection did not apply, so a missing CI run is not a mystery
    # later.
    echo "push: bypassed — $branch → $default landed, but branch protection was waived:"
    printf '%s\n' "$remote_lines" | sed 's/^/    /'
    echo "    The push succeeded and nothing needs undoing."
    ;;
  unknown)
    echo "push: unknown — $branch → $default landed; the remote said something unrecognised:"
    printf '%s\n' "$remote_lines" | sed 's/^/    /'
    ;;
  rejected)
    echo "push: rejected — $branch → $default was refused:" >&2
    printf '%s\n' "$err" | sed 's/^/    /' >&2
    exit 1
    ;;
esac

exit 0
