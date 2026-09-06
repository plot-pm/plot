#!/usr/bin/env bash
# Plot helper: the ONE answer to "what is the default branch, and is origin/HEAD
# still pointing at something that exists?"
#
# SOURCED, NOT RUN. `. "$script_dir/plot-default-branch.sh"` defines
# `default_branch` and `repair_origin_head`; the file does nothing else on load.
# The same shape — and the same reason — as `plot-pr-merged.sh` and
# `plot-worker-state.sh`.
#
# WHY IT EXISTS. Twice on 2026-09-04, hours apart, `refs/remotes/origin/HEAD`
# pointed at `origin/plot-corpus-pin`, a branch that does not exist on the
# remote. `plot-dispatch.sh` could not resolve the default branch and refused
# every dispatch:
#
#   plot-dispatch: cannot resolve 'origin/plot-corpus-pin' — refusing to dispatch.
#
# `git remote set-head origin --auto` fixed it both times, in under a second.
#
# THE FAILURE IS INVISIBLE TO EVERY READER, AND THAT IS THE POINT.
# `git symbolic-ref --short refs/remotes/origin/HEAD` on a corrupt symref exits
# **0** and prints `origin/plot-corpus-pin` — a plausible branch name. Ten
# scripts read it that way, and none of them can tell that answer from a good
# one. Only the `rev-parse` downstream fails, in a component that has already
# built `origin/<main>` out of it and can only report that the ref will not
# resolve. So the check belongs where the symref is READ, not where it is used.
#
# IT NAMES WHAT IT REPAIRED. A recurring corruption that is silently fixed is
# one nobody investigates: the line says what the symref pointed at and what it
# now points at, so a second occurrence is visible in a log rather than
# invisible in a working system.
#
# IT DOES NOT REPAIR A SYMREF THAT RESOLVES. Only an unresolvable one is broken.
# A clone whose `origin/HEAD` deliberately names a non-default branch is
# somebody's choice, and `--auto` would silently overrule it.
#
# WHAT LEAVES THE PIN BEHIND IS NOT REPAIRED HERE, and the leave-alone rule is
# what keeps this safe alongside it. `packages/domain/corpus/refs.corpus.test.ts`
# repoints `origin/HEAD` at a `plot-corpus-pin` ref it creates in `beforeAll`
# and restores in `afterAll` — deliberately, so two readings of the estate see
# one world. While that suite runs the pin RESOLVES, so this repairs nothing and
# the suite is unaffected. What was measured on 2026-09-04 is the state after a
# run that never reached its `afterAll`: the symref left behind, the ref it
# names gone. Fixing that belongs to the suite; this repairs the symptom and
# reports it loudly enough that the cause stays findable.

# Whether `refs/remotes/origin/HEAD` names a ref that exists.
#
# Reads the symref itself rather than `default_branch`'s answer, because the
# fallbacks below would mask exactly the state this tests.
#
# Usage: origin_head_resolves [<repo-dir>]
# Returns: 0 when it resolves — including when there is no symref at all, which
#          is a FRESH CLONE rather than a corruption and has nothing to repair.
origin_head_resolves() {
  local dir="${1:-.}" target
  target=$(git -C "$dir" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || return 0
  [ -n "$target" ] || return 0
  git -C "$dir" rev-parse --verify --quiet "${target}^{commit}" >/dev/null 2>&1
}

# Repairs an unresolvable `refs/remotes/origin/HEAD`, and says what it did.
#
# The repair is `git remote set-head origin --auto`, which asks the remote. It
# is cheap — measured under a second — and it is the same command that fixed
# both occurrences by hand.
#
# Usage: repair_origin_head [<repo-dir>]
# Output: one line on stderr naming BOTH refs, when a repair happened.
# Returns: 0 whether or not it repaired, and 0 when the repair itself fails —
#          this is a self-heal on a path that has its own refusal downstream,
#          so it must never become a second way to stop.
repair_origin_head() {
  local dir="${1:-.}" was now
  origin_head_resolves "$dir" && return 0

  was=$(git -C "$dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
  if ! git -C "$dir" remote set-head origin --auto >/dev/null 2>&1; then
    echo "plot: origin/HEAD points at '$was', which does not resolve, and 'git remote set-head origin --auto' failed — the remote could not be asked." >&2
    return 0
  fi
  now=$(git -C "$dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
  echo "plot: repaired origin/HEAD — it pointed at '$was', which does not exist on the remote; it now points at '${now:-<unset>}'." >&2
  return 0
}

# The default branch, repairing an unresolvable `origin/HEAD` on the way.
#
# The fallbacks are the ones the callers already carried, in the same order: the
# symref, then `main`. What is new is that the symref is TESTED before it is
# believed.
#
# IT NEVER FALLS BACK TO THE CHECKOUT'S OWN BRANCH, and that is a refusal rather
# than an omission. `refs-git.ts:138` does exactly that, correctly — it answers
# a question about THIS checkout. A shell caller is asking which branch everyone
# shares, and answering with whatever branch this tree happens to sit on is the
# defect `dispatch.test.mjs` is named for: *"a shared approval is not hidden by
# a parked checkout"*, measured when a concurrent agent's `git checkout` blocked
# two correctly-approved plans in one session. `main` is a guess about the
# repository; the current branch is a guess about the operator's last command.
#
# Usage: default_branch [<repo-dir>]
# Output: the branch name on stdout, without the `origin/` prefix.
default_branch() {
  local dir="${1:-.}" name
  repair_origin_head "$dir"
  name=$(git -C "$dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  [ -n "$name" ] || name="main"
  printf '%s\n' "$name"
}
