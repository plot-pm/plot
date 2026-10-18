#!/usr/bin/env bash
# Plot helper: push a disposable branch at the default branch, and say what
# actually happened to it.
# Usage: plot-push-main.sh <branch> <default-branch>
#        plot-push-main.sh --classify <exit-code> <<<"<stderr text>"
# Output: one status line on stdout, prefixed `push:`, plus any remote message
#         lines indented beneath it. Exit 0 if the commit landed on the default
#         branch (clean, bypassed, or unknown), 1 if the push was rejected and a
#         retry may clear it, 3 or 4 if the Writer App refused before pushing
#         (no retry will clear it — see `plot-push-writer-app.mjs`), 6 if another
#         default-branch writer held the lock for the whole wait (PLOT_PUSH_LOCK_WAIT,
#         120 s) — nothing was pushed, and retrying the same write once it frees is right.
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
# default branch and the caller should carry on. `rejected` exits 1, where the
# caller must retry: re-fetch the default branch, re-cut the disposable branch
# from it, and push again. `refused` exits 3 or 4, where no retry can help —
# the caller should stop, not loop. Making `bypassed` non-zero would turn a
# SUCCESSFUL approval into an apparent failure at three call sites. `locked`
# exits 6 and is not `rejected`: the base is still current, so the caller waits
# and repeats the push rather than re-cutting the branch.
#
# This script pushes and classifies once; retrying and re-applying the write
# onto a freshly re-cut branch is the caller's loop. Skills interpret; scripts
# collect and report (Principle 3).
set -uo pipefail

# The five outcomes. Read from a captured stderr rather than from the exit code
# alone, because the exit code cannot distinguish the middle two:
#
#   refused   — exit 3 or 4. The Writer App push refused before it ever
#               attempted a push (repo unresolvable, token exchange failed, or
#               a malformed/unreadable key) — retrying the identical push
#               cannot succeed, unlike `rejected` below.
#   rejected  — any other non-zero exit. Protection refused the push, or the
#               ref moved — a condition a retry against a fresh base can clear.
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

  case "$code" in 3 | 4) printf 'refused'; return ;; 0) ;; *) printf 'rejected'; return ;; esac

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

branch="${1:?plot-push-main: need a branch to push}"; default="${2:?plot-push-main: need the default branch}"

git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-push-main: not a git repository" >&2; exit 1; }

# ONE DEFAULT-BRANCH WRITER AT A TIME (#1349). Every caller runs this script, so the
# lock lives here; `plot-push-lock.mjs` holds the rule and its measurement. A waiter
# past the bound exits 6 having pushed nothing.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; node "$here/plot-push-lock.mjs" take "$$" "push $branch" || exit $?; trap 'node "$here/plot-push-lock.mjs" release "$$"' EXIT

# stderr is captured rather than passed through, because it carries the ONLY
# signal that separates a bypass from a clean push. A call site ending in
# `2>/dev/null` — as several of Plot's pushes do — discards exactly the line
# that answers the question.
#
# A GitHub origin asks `plot-push-writer-app.mjs`, which pushes as the Writer
# App, refuses by name (exit 4) where the key is malformed or unreadable, and
# answers 5 with its one-line notice where no `Writer app` key is declared.
# Exit 5 and every other origin take the plain push as the ambient identity.
origin_url=$(git config --get remote.origin.url 2>/dev/null || true); code=5
case "$origin_url" in *github.com*) err=$(node "$here/plot-push-writer-app.mjs" "$branch" "$default" 2>&1 >/dev/null); code=$?; [ "$code" = 5 ] && printf '%s\n' "$err" >&2 ;; esac
[ "$code" = 5 ] && { err=$(git push origin "$branch:$default" 2>&1 >/dev/null); code=$?; }

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
  rejected | refused)
    # `refused` exits with the Writer App's own code (3 or 4), not a flat 1: a
    # caller reading this script's exit code — `ladder.ts`'s `commitAndPush` —
    # tells a refusal, which no retry can clear, apart from a retryable
    # rejection.
    echo "push: $status — $branch → $default was refused:" >&2
    printf '%s\n' "$err" | sed 's/^/    /' >&2
    [ "$status" = rejected ] && exit 1 || exit "$code"
    ;;
esac

exit 0
