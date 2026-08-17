#!/usr/bin/env bash
# Plot helper: fleet pulse — deterministic extractor for wave/claim state.
# Usage: plot-fleet-scan.sh [--no-fetch] [--offline] [--next] [<slug>]
#   --no-fetch  skip `git fetch`
#   --offline   same (no network) — used for cheap, ambient pulses
#   --list-eligible  print EVERY claimable branch, one per line (exit 1 if none).
#               For callers that need the count rather than one item — a dry
#               run changes nothing, so its answer cannot go stale.
#   --loose     a prior wave counts as satisfied when its branches carry PUSHED
#               work, not only merged work. Buys throughput, pays in rebase
#               risk — the plan requires a stated reason for using it. Default
#               is strict (merged only).
#   --log-pulse append one pulse line to each reported plan's ## Notes, clean
#               pulses included — without a record of quiet pulses an idle fleet
#               and a dead fleet look identical. The ONLY thing this script ever
#               writes, and it is a log, not state.
#   --next      print ONE claimable branch name and exit 0; print nothing and
#               exit 1 when there is none. Used by /plot-implement to pick work
#               without re-deriving eligibility. "Nothing to start" is a normal
#               state — the exit code, not stderr, is what says so.
#   <slug>      limit the report to one plan (default: all active plans)
# Output: per-plan wave report on stdout, terminated by a machine-countable
#         summary line:
#             summary: plans=1 waves=3 branches=5 claimed=1 eligible=2 blocked=1 deferred=1 merge_detect=pr-merge main=main
#         merge_detect names how merged-and-deleted branches were detected:
#         pr-merge (exhaustive), truncated (capped walk), none (no conforming
#         merge commits — a squash/rebase repo, where `open` says nothing about
#         merging).
#         Consumers that only need counts (the /plot-fleet pulse log, the
#         board) read that one line and never re-count the body.
#         --json additionally carries, per PLAN, `phase` — the plan's own
#         lifecycle state, verbatim from plot-plan-meta.sh, and the half of a
#         row's phase git cannot answer. Which column a row reads is composed
#         from it AND the branch state one layer up; this script decides nothing.
#         The plan set also includes plans delivered inside a rolling 24 h
#         window (see "the last day of finished work"), so work does not
#         disappear at the moment it becomes finished.
#         --json additionally carries, per branch, what THIS MACHINE knows and
#         the refs do not: `local_dirty` (a local worktree has uncommitted
#         changes), `local_locked` (a local worktree holds `.git/index.lock` —
#         a write is in progress THIS INSTANT), `local_worktree` (where it is
#         checked out here) and `local_ahead` (commits on the local branch the
#         remote does not have). All four are absent-shaped — false, false, ""
#         and 0 — wherever this machine holds nothing, so a branch living on
#         another machine answers exactly as it did before.
#         --json also carries, per branch, `worker` — whether anything is
#         actually RUNNING on it: running|finished|failed|ended|none|elsewhere,
#         with `worker_pid` and `worker_exit` beside it. A claim says a
#         dispatcher took the branch; this says whether a worker was ever
#         started. `none` means UNKNOWN (no pid was recorded here), never
#         "nobody"; `elsewhere` means this machine has no worktree and so
#         cannot answer at all.
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# STATELESS AND READ-ONLY. This is the whole design (Manifesto Principle 1):
# there is no fleet database. Every fact printed here is re-derived from git
# refs and plan files on each run, so a killed dispatcher, a dead worker, or a
# crashed pulse costs nothing — the next pulse re-derives the truth. Nothing
# here creates a branch, pushes a ref, or starts a worker.
#
# ONE exception to "writes nothing": --log-pulse appends a pulse line to each
# reported plan (see below). That is a LOG, not state — deleting the whole log
# changes no behaviour, because the next run re-derives everything. The flag
# defaults OFF precisely so internal callers (plot-implement, plot-dispatch,
# which invoke --next) can never amend a plan as a side effect of asking what
# to work on; /plot-fleet, the human-facing command, passes it every run.
#
# Wave eligibility (the one rule this script encodes):
#   A wave is ELIGIBLE when every non-deferred branch in every PRIOR wave is
#   merged into the main branch. Prior waves outstanding → BLOCKED. All of a
#   wave's own non-deferred branches merged → COMPLETE.
# Deferred branches never count as outstanding work — that is what the
# `<!-- deferred: -->` annotation is for.
#
# Claim state comes from git, not from the plan file. A branch whose only
# commits beyond main are `plot: claim ...` markers is a CLAIM: a dispatcher
# pushed it to take the work. The marker commit is what makes the claim
# exclusive — a branch merely pointing at main does not diverge from it, so a
# second push would succeed and both sides would think they held it.
# The plan's `<!-- claimed: -->` annotation is a reflection for humans and the
# board; where the two disagree, git wins. The one exception is the reaper in
# plot-reconcile-scan.sh, which reads the annotation to tell a deliberately
# abandoned claim from a dead worker.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

do_fetch=1
next_only=0
list_all=0
loose=0
log_pulse=0
as_json=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch|--offline) do_fetch=0 ;;
    --loose) loose=1 ;;
    --log-pulse) log_pulse=1 ;;
    --next) next_only=1 ;;
    --list-eligible) next_only=1; list_all=1 ;;
    --json) as_json=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
DELIVERED_DIR=$(cfg "Delivered index" "docs/plans/delivered/")
PREFIX_RE=$(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' -)
[ -n "$PREFIX_RE" ] || PREFIX_RE="idea|feature|bug|docs|infra"

MAIN=$(cfg "Main branch")
if [ -z "$MAIN" ]; then
  MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
fi
[ -n "$MAIN" ] || MAIN="main"

[ "$do_fetch" = 1 ] && git fetch -q origin "$MAIN" 2>/dev/null

# --loose promises "the prior wave's PRs are green and ready", which needs the
# git host. An earlier version accepted ANY pushed commit — strictly weaker
# than promised, and dangerous: red CI or a draft PR would open the next wave,
# so it built on a seam that was not merely unlanded but possibly broken.
#
# Readiness must be VERIFIED, never assumed. Without a host CLI, --loose
# degrades to strict and says so: an unverifiable claim of readiness is not
# readiness.
loose_verifiable=0
if [ "$loose" = 1 ]; then
  if [ "$do_fetch" = 1 ] && "$script_dir/plot-host.sh" backend >/dev/null 2>&1 \
     && [ "$("$script_dir/plot-host.sh" backend 2>/dev/null)" != "none" ]; then
    loose_verifiable=1
  fi
fi

# ---------------------------------------------------------------------------
# Merged-and-deleted branches: the evidence that survives the ref
# ---------------------------------------------------------------------------
#
# A branch merged by PR usually has its ref deleted at merge, and nothing local
# survives it — `git reflog show origin/<br>` fails outright and for-each-ref
# finds nothing. What DOES survive is the merge commit on the default branch.
#
# Asking the host for merged PRs (as plot-reconcile-scan.sh does) is not
# available here: this scan is git-only on its default path, which is exactly
# why the board can poll it every 5 s. One board already costs 80 GraphQL
# calls/hour; a metered scan on a 5-second timer would dwarf that.
#
# The candidate set is what is REACHABLE from the default branch, matched by an
# ANCHORED subject:
#
#     ^Merge pull request #<n> from <owner>/<branch>$
#
# The anchoring is the whole mechanism. A name-only grep reads a BACKWARD merge
# — `Merge remote-tracking branch 'origin/main' into <branch>` — as evidence
# that <branch> landed, when it means the opposite: main was pulled INTO the
# branch. That inversion reports unfinished work as finished and opens the next
# wave on an unlanded seam, which is strictly worse than the bug this fixes. A
# backward merge opens with a different sentence, so it cannot match.
#
# TWO STRUCTURAL FILTERS WERE MEASURED AND REMOVED. Do not reintroduce either;
# see docs/plans/2026-08-16-fleet-sees-merged-branches.md for the numbers.
#   * A FIRST-PARENT filter looked convincing at "119 merges → 109 on the
#     chain". Measured against the right baseline — the anchored pattern, not
#     raw merges — it scores 108 to 108: it catches NOTHING extra, because
#     backward merges cannot match the anchored pattern anyway. And it breaks
#     GitFlow: a feature merged into `develop`, where `develop` later merges to
#     the default branch, is not on the first-parent chain and would read
#     `open` while its work is an ancestor.
#   * A SECOND-PARENT counter-check does not discriminate: PR merges and
#     backward merges both have a distinct second-parent tip.
#
# Reachability does not over-report either: a PR merged into a long-lived
# branch that was then abandoned is not reachable from the default branch at
# all. Reachability is itself an ancestry claim, so it cannot see work that
# never arrived.
#
# The walk is bundled — ONE `git log` per run, not one per branch. branch_state
# runs per branch and the board polls every 5 s, so the naive shape is
# O(history × branches) where O(history + branches) is available (measured:
# 197 ms vs 79 ms on a 2000-merge fixture). Same bundling rule
# plot-reconcile-scan.sh applies to PR lists, with local data.
#
# The cap guards against a pathological history rather than buying time — the
# walk is local and nearly free (cap 500: 7.7 ms, no cap: 11.8 ms at 2000
# merges). It is therefore set high, and SATURATION IS REPORTED. A blind cap
# re-creates this very bug: at 300 against 2000 merges an early merge is not
# found and reads `open`, hitting precisely the long-hanging plans most likely
# to suffer it.
#
# PLOT_MERGE_SCAN_LIMIT exists so the test suite can force saturation against a
# small fixture — a cap of 2000 is otherwise unreachable in a test. It is a
# seam, not a knob: nothing in Plot sets it, and lowering it in real use buys
# nothing but the silent misses described above.
MERGE_SCAN_LIMIT=${PLOT_MERGE_SCAN_LIMIT:-2000}
MERGE_SUBJECTS=$(git log "origin/$MAIN" --merges \
  --max-count="$MERGE_SCAN_LIMIT" --pretty=%s </dev/null 2>/dev/null || true)
MERGE_SCAN_TRUNCATED=0
if [ -n "$MERGE_SUBJECTS" ] \
   && [ "$(printf '%s\n' "$MERGE_SUBJECTS" | grep -c .)" -ge "$MERGE_SCAN_LIMIT" ]; then
  MERGE_SCAN_TRUNCATED=1
fi

# merge_detect names the detection source in the footer, the way
# plot-reconcile-scan.sh names pr_source. `open` must stop meaning both "never
# started" and "I could not tell" — that ambiguity is the defect this fix
# exists to remove, and it would otherwise reappear one level up.
#   pr-merge  — conforming merge commits were found and examined exhaustively
#   truncated — the walk hit its cap; a branch merged before that point may
#               still read `open`. Its own value, not folded into pr-merge: a
#               capped walk detected, but not exhaustively.
#   none      — the default branch carries no conforming merge commits at all
#               (a squash/rebase repo), so `open` says nothing about merging.
if printf '%s\n' "$MERGE_SUBJECTS" | grep -qE '^Merge pull request #[0-9]+ from [^/]+/.+$'; then
  MERGE_DETECT=$([ "$MERGE_SCAN_TRUNCATED" = 1 ] && echo truncated || echo pr-merge)
else
  MERGE_DETECT=none
fi

# ---------------------------------------------------------------------------
# Local worktrees: what the refs cannot see
# ---------------------------------------------------------------------------
#
# An agent that has edited files and not committed has written nothing git can
# see, so a branch someone is actively working reads as abandoned — on the one
# machine that could have known better. This scan runs on that machine, and
# `git worktree list --porcelain` names every worktree and its branch.
#
# The signal is strictly ONE-DIRECTIONAL, which is the whole reason it can be
# added without weakening refs-as-truth: it may ADD an answer where this machine
# knows more, never downgrade one. A machine with no worktree for a branch —
# every detached worker, every teammate's laptop, every CI run — reports nothing
# here, and the branch answers from refs exactly as it did before.
#
# TWO EMPTY-MEANS-ONE-THING GUARDS, both cheap:
#   * SKIP `prunable` ENTRIES. A worktree directory can be deleted without `git
#     worktree remove`, and the entry survives. `git status` there exits 128 and
#     prints NOTHING — so a check on emptiness reads "clean" and is right by
#     ACCIDENT. `git worktree list --porcelain` already marks such entries, so
#     running `git status` on a directory known to be gone is asking a question
#     whose answer was printed a line earlier.
#   * READ THE EXIT CODE, not the emptiness. A non-zero status is a failure to
#     observe, and a failure to observe is not evidence of cleanliness.
#
# NO CAP, and the measurement is the reason: 6.6 ms per worktree, so twenty cost
# ~133 ms against a scan that already runs 500–1050 ms. A cap would be stock
# against a problem the numbers rule out, and caps drop results silently unless
# they also report saturation.
#
# A LOCK IS A THIRD ANSWER, not a failure to observe. `.git/index.lock` means
# *an agent is writing HERE, RIGHT NOW* — precisely what the fleet view exists to
# show — and it is the most informative state a worktree can be in. Until #167 it
# was invisible: the branch answered from refs as though this machine had no
# worktree for it, and the row read *claimed, no commits yet* while a commit was
# in flight. The branch that looked least active was the one being written to.
#
# THE LOCK FILE IS OBSERVED DIRECTLY, and that is a correction to the plan rather
# than a shortcut around it. The plan expected the lock to announce itself by
# FAILING `git status`, so that reading the exit code would be enough. Measured
# on 2026-08-17, it does not: `git status --porcelain` exits 0 under a held lock
# in every ordinary condition — clean tree, modified file, staged change,
# untracked file — because it needs the index lock only when it decides to WRITE
# a refreshed index back, which it skips whenever the cached stat info already
# answers. The failure this plan was written from was real and is racy: it
# reproduces when the index is stale enough to force a refresh-and-write, and not
# otherwise. Keying the signal on that exit code would report a lock on some runs
# and not others, for the same worktree in the same state — a flaky signal is
# worse than none, because it teaches the reader to disbelieve the row.
#
# So the question is asked of the filesystem, where the answer is unambiguous:
# the lock file is either there or it is not.
#
# LOCKED AND MISSING STAY APART, which is what the direct check buys. They are
# now answered by two independent observations rather than by one exit code
# carrying two meanings — a vanished directory has no git dir to look in and
# reports nothing at all, exactly as before.
#
# NEVER RETRY, NEVER WAIT. A lock held through a rebase can last seconds and the
# next poll is 4 s away — it will find it unlocked. A scan that blocks on one
# worktree makes the pulse late for every branch on the board, which is a worse
# version of the defect being fixed. Reporting beats blocking.
#
# Read ONCE per run, not once per branch — same rule the merge walk follows, for
# the same reason: branch_state runs per branch and the board polls every 5 s.
# bash 3.2 (macOS) has no associative arrays, so the table is a newline-
# separated string of `branch<TAB>path<TAB>dirty<TAB>locked` rows, looked up with
# awk.
worktree_rows() {
  git worktree list --porcelain </dev/null 2>/dev/null | awk '
    /^worktree /   { path = substr($0, 10); br = ""; prunable = 0; next }
    /^branch /     { br = substr($0, 8); sub(/^refs\/heads\//, "", br); next }
    /^prunable/    { prunable = 1; next }
    /^$/           { if (br != "" && !prunable) print br "\t" path; br = ""; path = ""; prunable = 0; next }
    END            { if (br != "" && !prunable) print br "\t" path }
  '
}

# Whether a worktree is mid-write, asked of the worktree's OWN git dir.
#
# A linked worktree does not keep its index beside the repository's: `.git` there
# is a FILE reading `gitdir: <repo>/.git/worktrees/<name>`, and that is where its
# `index.lock` lives. Testing `$wt/.git/index.lock` would answer for the main
# checkout only and report every linked worktree unlocked — the population this
# whole signal is about, since every dispatched agent works in one.
#
# NO GIT CALL. `git rev-parse --absolute-git-dir` would answer both shapes in one
# line and costs 14 ms — measured, against the 6.6 ms per worktree the sweep
# already accepts, so asking it per worktree would roughly TRIPLE the cost of the
# local signals to learn something the filesystem already states. `.git` is a
# directory in the main checkout and a one-line file in a linked one; reading it
# is a stat and at most a 50-byte read.
#
# ABSENT IS ABSENT, here as everywhere: an unreadable or missing `.git` returns
# "not locked" rather than guessing, and the worktree's other answers are
# unaffected.
worktree_locked() { # $1=worktree path → 0 when a lock is held there
  local gd=$1/.git line
  if [ -f "$gd" ]; then
    # A linked worktree: `.git` is a pointer file. Relative targets are legal, so
    # resolve against the worktree rather than the caller's cwd.
    line=$(cut -d' ' -f2- <"$gd" 2>/dev/null) || return 1
    case "$line" in
      gitdir:*) line=${line#gitdir:} ;;
    esac
    line=${line# }
    [ -n "$line" ] || return 1
    case "$line" in
      /*) gd=$line ;;
      *)  gd=$1/$line ;;
    esac
  elif [ ! -d "$gd" ]; then
    return 1
  fi
  [ -e "$gd/index.lock" ]
}

WORKTREES=""
while IFS=$'\t' read -r wt_branch wt_path; do
  [ -n "$wt_branch" ] || continue
  # Asked BEFORE `git status` and independently of it. The lock is a fact about
  # the repository, not a property of whether the status call happened to
  # succeed — and it is the one fact here that can change between this scan and
  # the next poll four seconds later, so it is read as close to the truth as the
  # filesystem allows.
  if worktree_locked "$wt_path"; then wt_locked=true; else wt_locked=false; fi
  # Exit code, never emptiness: `git status` on a vanished directory prints
  # nothing and fails, and "I could not look" must not read as "clean".
  if wt_status=$(git -C "$wt_path" status --porcelain </dev/null 2>/dev/null); then
    if [ -n "$wt_status" ]; then wt_dirty=true; else wt_dirty=false; fi
  elif [ "$wt_locked" = true ]; then
    # Status could not answer, but the lock says WHY, and that is an answer
    # rather than the absence of one: a write is in progress in this worktree at
    # this instant. Reported with its path, because the directory demonstrably
    # exists — something is writing in it.
    #
    # `dirty` stays FALSE, and that is not a claim of cleanliness. It was not
    # observed, and the two facts travel separately: `local_locked` says a write
    # is happening, `local_dirty` says someone is editing. Folding the lock into
    # dirtiness would answer a second question with the first one's word, which
    # is the one-label-two-states defect this scan keeps removing.
    wt_dirty=false
  else
    # A failure to observe with no lock to explain it: the directory is gone, or
    # unreadable, or not a worktree any more. Not reported at all — neither its
    # dirtiness (unknown) nor its path (it may not be there).
    continue
  fi
  WORKTREES+="$wt_branch	$wt_path	$wt_dirty	$wt_locked"$'\n'
done <<< "$(worktree_rows)"

# The local worktree for a branch as `path<TAB>dirty<TAB>locked`, or empty when
# this machine has none. Absent is ABSENT — never a false, never a path that
# does not exist here.
local_worktree_of() { # $1=branch → "path\tdirty\tlocked" or ""
  printf '%s' "$WORKTREES" | awk -F'\t' -v b="$1" '$1==b {print $2 "\t" $3 "\t" $4; exit}'
}

# ---------------------------------------------------------------------------
# The worker: whether anything is actually running on a claimed branch
# ---------------------------------------------------------------------------
#
# A claim is a push. It says a dispatcher TOOK the branch, and nothing more —
# on 2026-08-17 three rows sat in WORKING with a pulsing dot while nobody was
# working on any of them. The claim was real; the worker was never started.
#
# `worker_state()` in plot-dispatch.sh has distinguished FIVE outcomes since it
# was written — running / finished / failed (exit N) / ended (status unknown) /
# no worker — and measured against the board, `grep -rn "plot-worker.pid"
# packages/board/src` returned NOTHING. The information was already richer than
# the row assumed and reached no screen. This reports it; it invents no new
# liveness check.
#
# SIX VALUES, because the absence of a worktree is a THIRD kind of answer and
# not the second one. The pid lives in the worktree (`$wt/.plot-worker.pid`),
# so a branch claimed and started on ANOTHER machine has no path to look at:
#
#   claim  worktree  pid   worker      the reader's next move
#   ✓      ✓         ✓     running     leave it alone
#                          finished    review it
#                          failed      restart it — its exit code is carried
#                          ended       look in the log; the status was not kept
#   ✓      ✓         —     none        claimed, no KNOWN worker
#   ✓      —         n/a   elsewhere   ask the machine that took it
#
# `none` and `elsewhere` differ because the ACTIONS differ — *look in this
# checkout* versus *ask another machine* — the same split `local_dirty` and
# `local_ahead` make between a worktree question and a ref question.
#
# ABSENT IS NOT FALSE, and `none` is the strongest statement it licenses:
# **UNKNOWN, never "nobody"**. plot-dispatch writes the pid only where it
# started the worker itself, so a hand-started worker leaves none — and
# hand-starting is the normal case for as long as `Worker command` is unset.
# Five agents were started that way in one session; reading a missing pid as
# "nobody is working" would have reported every one of them dead.
#
# A PID OF `0` IS NEVER RUNNING. `kill -0 0` signals the whole process GROUP and
# succeeds, so a naive liveness check reports it alive forever. It is rejected
# here exactly as `worker_state()` rejects it, and the answer travels as a value
# rather than being re-derived on the far side where the trap would be sprung
# again.
#
# READ THE EXIT CODE, NOT THE EMPTINESS: an unreadable `.plot-worker.exit` is
# `ended` (status unknown), never `finished`. Guessing success from an absent
# record is the same mistake in the other direction, and `finished` is the one
# answer that tells a reader to stop looking.
worker_of() { # $1=branch → "state\tpid\texit"
  local br="$1" wt pid code
  wt=$(printf '%s' "$WORKTREES" | awk -F'\t' -v b="$br" '$1==b {print $2; exit}')
  # No worktree here: this machine cannot answer the question at all. Not the
  # same as looking and finding nothing.
  [ -n "$wt" ] || { printf 'elsewhere\t\t'; return; }
  [ -f "$wt/.plot-worker.pid" ] || { printf 'none\t\t'; return; }
  pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  [ -n "$pid" ] || { printf 'none\t\t'; return; }
  case "$pid" in 0|*[!0-9]*) printf 'none\t\t'; return ;; esac
  if kill -0 "$pid" 2>/dev/null; then printf 'running\t%s\t' "$pid"; return; fi
  if [ -f "$wt/.plot-worker.exit" ]; then
    code=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
    case "$code" in
      0)           printf 'finished\t%s\t0' "$pid"; return ;;
      ''|*[!0-9]*) printf 'ended\t%s\t' "$pid"; return ;;
      *)           printf 'failed\t%s\t%s' "$pid" "$code"; return ;;
    esac
  fi
  # No exit file: a worker started before the code was recorded, or one killed
  # outright. Unknown is its own answer.
  printf 'ended\t%s\t' "$pid"
}

# ---------------------------------------------------------------------------
# Unpushed commits: work finished on this machine that nobody else can see
# ---------------------------------------------------------------------------
#
# `local_dirty` reports *someone is editing*, and committing clears it. So the
# moment a worker finishes tidily the signal covering for it disappears, and the
# board reads "claimed, no commits yet" for a branch holding a complete
# implementation. Measured on 2026-08-16 on the very branch that fixed the other
# half: 3 commits ahead, 0 dirty files, no PR.
#
# THIS IS A REF QUESTION, NOT A WORKTREE QUESTION, and getting that wrong was
# this plan's own first draft. Worktrees share ONE ref database, so
# `refs/heads/<br>` answers from here for a branch checked out in a different
# worktree — no `git -C`, no worktree needed. Binding it to the worktree list
# would have been *consistent* with `local_dirty` and wrong: a local branch with
# no worktree — checked out once and moved away from, or fetched from a
# colleague — still holds commits nobody else can see, and the worktree-shaped
# version skips exactly those. Dirtiness belongs to a working directory;
# aheadness belongs to the refs.
#
# AHEAD ONLY. `A..B` counts one direction and that is the right one: the
# question is whether work exists here that nobody else can see. Being *behind*
# is not an invisible state — it is sitting in the remote for anyone to read —
# and reporting it would answer a second question with no action attached.
#
# READ THE EXIT CODE, NOT THE EMPTINESS. A missing upstream exits 128 printing
# NOTHING — bit-identical to the deleted-worktree signature above — so a check
# on emptiness reads "zero ahead" and is right only by accident, for exactly the
# reason empty `git status` output must not read as "clean". A failure to
# observe is not evidence of nothing to see, and 0 is what the caller renders.
#
# ABSENT IS NOT FALSE: a branch with no local ref exits 128 too and answers 0,
# which is precisely the answer that changes nothing for every branch living on
# somebody else's machine.
#
# NO CAP. Measured at 5.2 ms per call from the main repo (20 iterations,
# 0.104 s), against the 6.6 ms per worktree the shipped scan already accepts.
# Twenty branches cost ~104 ms on a scan that runs 500–1050 ms, and the count
# follows the plans rather than the checkout. A cap would be stock against a
# problem the numbers rule out, and caps drop results silently unless they also
# report saturation.
local_ahead_of() { # $1=branch → count of local commits the remote lacks, or 0
  local out
  # Exit code, never emptiness. `|| return`-style shortcuts would swallow the
  # distinction this whole comment exists to preserve.
  if out=$(git rev-list --count \
             "refs/remotes/origin/$1..refs/heads/$1" </dev/null 2>/dev/null); then
    case "$out" in
      ''|*[!0-9]*) printf '0' ;;
      *) printf '%s' "$out" ;;
    esac
  else
    # No local ref, no upstream, or an unreadable ref database. Not observed →
    # not reported.
    printf '0'
  fi
}

# Did this branch land on the default branch? Positive evidence only — absence
# keeps today's answer.
#
# The branch name is INTERPOLATED INTO AN ERE, so every metacharacter it may
# legally contain is escaped first. Git allows `+`, `(`, `)`, `?`, `{`, `}` and
# `.` in ref names, and unescaped each one changes what the pattern means —
# `feature/v.1` would match `feature/vX1`, and `bug/a+b` would fail to match
# its OWN merge subject. Both directions are wrong, and the second is the
# quieter one: a branch that silently never matches simply keeps reading
# `open`, which is this plan's own bug wearing a different hat.
merged_by_subject() { # $1=branch → 0 when a conforming merge names it
  printf '%s\n' "$MERGE_SUBJECTS" \
    | grep -qE "^Merge pull request #[0-9]+ from [^/]+/$(printf '%s' "$1" | sed 's/[][\.*^$+?(){}|\/]/\\&/g')\$"
}

# Is this branch's PR ready to merge — open, not draft? Unknown counts as NO.
pr_ready() {
  local br="$1" js
  js=$("$script_dir/plot-host.sh" pr-state "$br" </dev/null 2>/dev/null) || return 1
  printf '%s' "$js" | grep -q '"state":"OPEN"' || return 1
  printf '%s' "$js" | grep -q '"draft":false'
}

# ---------------------------------------------------------------------------
# Recently delivered plans: the last day of finished work
# ---------------------------------------------------------------------------
#
# The pulse read `active/` only, so a plan left the view the INSTANT it was
# delivered — taking every branch with it. Measured on this repo: five plans
# delivered in one day named eight branches between them, and DONE showed one,
# because delivery and merge are minutes apart and only whichever branch
# happened to sit in the gap survived. A group that is full by accident is
# worse than one that is empty by rule.
#
# A ROLLING 24 HOURS, not the calendar day. Literally "delivered today" is
# easier to explain and wrong at exactly the wrong moment: a plan delivered at
# 23:50 vanishes ten minutes later, mid-session, while the branches it names
# are still on screen. 24 is also the one freshness bound this repo already
# uses (`Claim stale after`), so it is one unit to learn rather than two.
#
# THE WINDOW FILTERS BEFORE THE PARSE. Measured: ~57 ms per plan through
# plot-plan-meta.sh against a scan that already runs 500–1050 ms, so parsing
# fourteen delivered plans to discard thirteen would roughly double the pulse —
# and that cost grows with the archive, which only ever gets larger, while the
# answer stays the size of a day's work. So the cheap signal comes first (the
# delivered symlink's own mtime) and only the candidates it admits are parsed.
#
# The pre-filter may OVER-ADMIT AND PAY A PARSE; it may never exclude. A
# checkout can freshen an old file, so the `Delivered:` record keeps the last
# word — but nothing mtime rules out could have been delivered inside the
# window. On a fresh clone or a CI worktree every file shares one checkout
# timestamp and ALL of them are admitted: correct, merely slower, once. Reaching
# for `git log` per plan to avoid that would spend a git call to save a parse.
DELIVERED_WINDOW_HOURS=$(cfg "Claim stale after" "24")
case "$DELIVERED_WINDOW_HOURS" in (*[!0-9]*|'') DELIVERED_WINDOW_HOURS=24 ;; esac

# Modification time of a path, in epoch seconds, following symlinks — or "" when
# it cannot be read.
#
# BSD (`stat -f %m`) and GNU (`stat -c %Y`) spell this differently, and the
# fallback CANNOT be written as `bsd || gnu`: on GNU coreutils `-f` is a valid
# flag meaning *file system status*, so it SUCCEEDS with a filesystem report
# instead of failing over. That reads as a mtime of zero and quietly excludes
# every delivered plan on Linux, which is exactly what CI caught — the answer
# was wrong in the safe-looking direction (nothing shown) rather than the loud
# one. So the OUTPUT is validated rather than the exit code: whichever form
# yields digits is the one that was understood.
file_mtime() { # $1=path → epoch seconds, or ""
  local m
  for m in "$(stat -f %m "$1" 2>/dev/null)" "$(stat -c %Y "$1" 2>/dev/null)"; do
    case "$m" in
      ''|*[!0-9]*) ;;
      *) printf '%s' "$m"; return 0 ;;
    esac
  done
  return 1
}

# A plan whose delivered symlink was touched inside the window. `find -newermt`
# is not portable to every BSD find in the wild, so the cutoff is computed and
# compared with `stat` — one stat per file, no parse.
delivered_candidates() {
  local cutoff now link mtime
  now=$(date +%s)
  cutoff=$((now - DELIVERED_WINDOW_HOURS * 3600))
  for link in "$DELIVERED_DIR"*.md; do
    [ -e "$link" ] || continue
    # `stat` follows the symlink, which is what we want: the TARGET is the plan,
    # and a plan edited after delivery must still admit. An unreadable time
    # ADMITS rather than excludes — the pre-filter may only over-admit, and the
    # `Delivered:` record has the last word either way.
    mtime=$(file_mtime "$link") || { printf '%s\n' "$link"; continue; }
    [ "$mtime" -ge "$cutoff" ] && printf '%s\n' "$link"
  done
}

# Does this plan's `Delivered:` record fall inside the window? The RECORD
# decides — mtime only chose who got asked.
#
# "No date, no row." A delivered plan with an empty record does not appear at
# all: no date means no membership in any window, the same rule the waiting age
# already follows. Showing it always would create the one row that can never
# age out of DONE, and the missing record is a bookkeeping fault
# plot-reconcile-scan.sh exists to report — a view that quietly compensates
# for it makes the fault harder to see.
#
# A BARE DATE IS ANCHORED AT THE END OF ITS DAY, not at midnight, and this is
# the one detail that makes "rolling, not the calendar day" true rather than
# merely stated. Every `Delivered:` record in this repo is a bare date, which
# names no time — so anchoring at 00:00 measures from up to a day BEFORE the
# delivery, and the window collapses back into exactly the calendar boundary
# the rolling window exists to avoid: a plan delivered at 23:50 would be an
# hour from expiry the moment it was written, and gone ten minutes later
# mid-session while the branches it names are still on screen.
#
# Anchoring at 23:59:59 over-admits by at most the length of the delivery day.
# That is the same direction the mtime pre-filter is allowed to err in, and for
# the same reason: showing a finished plan slightly too long costs a row, while
# dropping one mid-session costs the reader the work they were looking at. A
# record that DOES carry a time is honoured exactly, so the imprecision belongs
# to the record rather than to the rule.
delivered_in_window() { # $1=plan meta JSON → 0 when inside
  printf '%s' "$1" | python3 -c '
import json, re, sys, time
d = json.load(sys.stdin)
raw = (d.get("delivered_raw") or "").strip()
if not raw:
    sys.exit(1)
# The leading date, optionally followed by a time. Everything after is
# provenance for a human. A record whose date does not parse is dropped rather
# than coerced — Date-style leniency would turn a typo into a confident answer.
m = re.match(r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?", raw)
if not m:
    sys.exit(1)
y, mo, dy, hh, mi = m.groups()
timed = hh is not None
try:
    at = time.mktime((int(y), int(mo), int(dy),
                      int(hh) if timed else 23, int(mi) if timed else 59,
                      0 if timed else 59, 0, 0, -1))
except (ValueError, OverflowError):
    sys.exit(1)
window = float(sys.argv[1]) * 3600
# A future record (a mistyped year, a plan delivered "tomorrow") is INSIDE:
# `age <= window` with a negative age. Excluding it would hide a live plan for
# a typo, and the row is visible either way.
sys.exit(0 if (time.time() - at) <= window else 1)
' "$DELIVERED_WINDOW_HOURS" 2>/dev/null
}

# Resolve which plans to report on.
plans=()
if [ -n "$slug" ]; then
  for cand in "$PLAN_DIR"*"$slug".md "$ACTIVE_DIR$slug.md" "$DELIVERED_DIR$slug.md"; do
    [ -e "$cand" ] && { plans+=("$(cd "$(dirname "$cand")" && pwd)/$(basename "$cand")"); break; }
  done
else
  for link in "$ACTIVE_DIR"*.md; do
    [ -e "$link" ] || continue
    plans+=("$link")
  done
  # Delivered candidates are appended, so the active plans keep their position
  # and order — a reader's list does not reshuffle when something is delivered.
  # They are still CANDIDATES here: the record check runs inside the plan loop,
  # where the parse it needs has already happened for free.
  #
  # --next and --list-eligible skip them entirely rather than filter later.
  # Their question is "what may a worker claim", and a delivered plan answers
  # nothing to it: even an `open` branch under one is work somebody decided was
  # not needed. Naming one would send a dispatcher at finished work.
  if [ "$next_only" != 1 ]; then
    while IFS= read -r link; do
      [ -n "$link" ] || continue
      plans+=("$link")
    done <<< "$(delivered_candidates)"
  fi
fi

if [ ${#plans[@]} -eq 0 ]; then
  # --next/--list-eligible must stay silent and exit 1: "nothing to start" is
  # the same answer whether the plans are all claimed or there are no plans at
  # all. Exiting 0 here would hand a caller an EMPTY branch name as if it were
  # valid work.
  [ "$next_only" = 1 ] && exit 1
  echo "No active plans found in ${ACTIVE_DIR}."
  echo "summary: plans=0 waves=0 branches=0 claimed=0 eligible=0 blocked=0 deferred=0 main=$MAIN"
  exit 0
fi

# A branch is merged when its remote ref is an ancestor of origin/<main>, or —
# once the ref is gone — when the default branch carries a conforming PR-merge
# commit naming it (see "the evidence that survives the ref" above). An absent
# ref with no such commit means the work has not been taken yet.
#
# Every git call here redirects stdin from /dev/null: this function runs inside
# `while read ... <<< "$states"` loops, and a child process inheriting that
# here-string would swallow the loop's remaining lines.
# Count commits beyond main that are NOT claim markers. A claim marker must be
# BOTH titled `plot: claim ...` AND empty (its tree equals its parent's) — the
# subject alone is not evidence. A human commit titled "plot: claim handling
# refactor" carrying real files would otherwise read as an empty claim, and
# with a deferred: annotation the reaper would offer to DELETE real work.
real_commits_beyond_main() { # $1=branch → count
  local br="$1" c n=0 subj
  for c in $(git rev-list "origin/$MAIN..origin/$br" </dev/null 2>/dev/null); do
    subj=$(git log -1 --format=%s "$c" </dev/null 2>/dev/null)
    # A claim marker is titled `plot: claim ...` AND empty. Both, or it counts
    # as real work.
    case "$subj" in
      "plot: claim "*)
        if [ "$(git rev-parse "$c^{tree}" </dev/null 2>/dev/null)" \
             = "$(git rev-parse "$c^^{tree}" </dev/null 2>/dev/null)" ]; then
          continue
        fi ;;
    esac
    n=$((n + 1))
  done
  echo "$n"
}

branch_state() {
  local br="$1"
  # THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT.
  #
  # A branch name can be reused: merge `bug/flaky`, delete it, then recreate it
  # for a second attempt — a normal thing when work is reopened. The FIRST
  # attempt's merge subject is still on the default branch, and it is now stale
  # evidence: it describes work that landed, while the branch of that name
  # carries new work that has not.
  #
  # The merge lookup is safe only BY PLACEMENT — it lives in the no-ref arm,
  # and a recreated branch has a ref, so it never reaches the lookup and takes
  # the ancestry path below instead. Moving the lookup to the top reads like a
  # cheap early answer and would silently report in-flight work as `merged`,
  # opening the next wave on it. A test in fleet.test.mjs pins this ordering.
  if ! git show-ref -q --verify "refs/remotes/origin/$br" </dev/null 2>/dev/null; then
    # No ref carries two meanings and this used to answer `open` for both: a
    # branch never started, and a branch merged with its ref deleted at merge.
    # The wave arithmetic reads `open` as OUTSTANDING, so a finished wave never
    # completed and --next named finished work as the next thing to start.
    #
    # `merged` is already the state that settles a wave, so the arithmetic does
    # not change and no new state enters the vocabulary. Where no evidence
    # exists — squash merges, a hand-rewritten subject, a branch genuinely
    # never started — today's `open` stands. The fix may only move a branch
    # from `open` to `merged`, and only on positive evidence.
    merged_by_subject "$br" && { echo "merged"; return; }
    echo "open"; return
  fi
  # A CLAIM is a branch whose only commits beyond main are claim commits —
  # empty markers a dispatcher pushed to take the work. They must be real
  # commits, not a bare pointer at main: two branches pointing at the same
  # commit do not diverge, so the second push would succeed and both sides
  # would think they held the claim (see plot-dispatch.sh, "THE CLAIM").
  ahead=$(git rev-list --count "origin/$MAIN..origin/$br" </dev/null 2>/dev/null || echo 0)
  if [ "$ahead" -gt 0 ]; then
    real=$(real_commits_beyond_main "$br")
    [ "${real:-0}" = "0" ] && { echo "claimed"; return; }
    # Has real work: merged only if that work already landed.
    git merge-base --is-ancestor "origin/$br" "origin/$MAIN" </dev/null 2>/dev/null \
      && { echo "merged"; return; }
    echo "wip"; return
  fi
  # Nothing of its own. NOT a claim: that shape is indistinguishable from
  # merged work, which is exactly why claims carry a commit.
  echo "merged"
}

# Prose is suppressed by BOTH alternate output modes. --json accumulates the
# same derivation into a document instead of printing it; the arithmetic below
# is untouched, which is what keeps the human report byte-identical.
quiet=0
[ "$next_only" = 1 ] && quiet=1
[ "$as_json" = 1 ] && quiet=1
HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null)
json_plans=""

# Emit a JSON string with the six characters JSON forbids escaped. Branch names
# and claim notes are user data: a plan may legitimately carry a quote or a
# backslash, and an unescaped one would produce a document nothing can parse.
json_str() {
  printf '%s' "$1" | LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    -e 's/\t/\\t/g' -e 's/\r/\\r/g' -e 's/\x08/\\b/g' -e 's/\x0c/\\f/g'
}

if [ "$next_only" != 1 ] && [ "$as_json" != 1 ]; then
  banner="plot-fleet pulse — $HEAD_SHORT on origin/$MAIN"
  if [ "$loose" = 1 ]; then
    if [ "$loose_verifiable" = 1 ]; then banner="$banner (loose eligibility)"
    else banner="$banner (--loose cannot verify PR readiness without a git host — using strict)"
    fi
  fi
  echo "$banner"; echo
fi

n_plans=0 n_waves=0 n_branches=0 n_claimed=0 n_eligible=0 n_blocked=0 n_deferred=0
claimable=()
plan_files=()

for plan in "${plans[@]}"; do
  # Per-plan reset. State that survives into the next iteration is how the
  # plan parser once leaked a `## Branches` flag across files — same shape of
  # bug, so the accumulator is cleared where the plan loop begins.
  json_waves=""
  meta=$("$script_dir/plot-plan-meta.sh" "$plan" --prefixes "$PREFIX_RE" 2>/dev/null) || continue
  [ -n "$meta" ] || continue

  # The plan's own phase, carried onto the pulse so a consumer can derive a row
  # phase from the PAIR — plan state AND branch git state. It is reported, never
  # interpreted: this script collects and reports, and which column a row reads
  # is a judgment that belongs one layer up (Manifesto Principle 3).
  plan_phase=$(printf '%s' "$meta" | python3 -c '
import json, sys
print(json.load(sys.stdin).get("phase", ""))
' 2>/dev/null) || plan_phase=""

  # The delivered window's SECOND half: mtime admitted this file, the RECORD
  # decides. Applied only to plans that came in through the delivered index — an
  # ACTIVE plan carrying `Phase: Delivered` is drift, and the view that would
  # reveal it must not be the one that hides it.
  #
  # Two exits, and both matter:
  #   * the record's date has aged out of the window — ordinary expiry;
  #   * there is NO record — "no date, no row". `reconcile-scan-accuracy.md` is
  #     the live example; showing it would create the one row that can never
  #     age out of DONE.
  # Both leave before a single git call is spent on the plan's branches.
  case "$plan" in
    "$DELIVERED_DIR"*)
      delivered_in_window "$meta" || continue ;;
  esac

  n_plans=$((n_plans + 1))
  plan_target=$(readlink "$plan" 2>/dev/null && echo "" || true)
  plan_files+=("$plan")

  # One awk pass over the parsed JSON would need a JSON parser; instead the
  # wave walk below is driven by plot-plan-meta.sh's own output via a tiny
  # python shim (present wherever the board's toolchain is).
  [ "$quiet" = 1 ] || echo "== $(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")") =="

  wave_lines=$(printf '%s' "$meta" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i, w in enumerate(d.get("waves", [])):
    name = w["name"]
    for b in w["branches"]:
        ref = b["branch"]
        # Not every prefixed token in a ## Branches section is implementation
        # work. A cited file path (`docs/note.md`) matches the docs/ branch
        # prefix, and an idea/ branch carries the plan itself — counting either
        # as outstanding would keep a finished wave blocked forever.
        if ref.startswith("idea/") or "." in ref.rsplit("/", 1)[-1]:
            continue
        row = [str(i), ref, str(b["deferred"]).lower(),
               name or "-", b["claimed"] or "-"]
        print("\t".join(x.replace("\t", " ") for x in row))
' 2>/dev/null) || wave_lines=""

  [ -n "$wave_lines" ] || { [ "$quiet" = 1 ] || { echo "  (no branches)"; echo; }; continue; }

  # Pass 1: per-branch git state.
  #
  # Field order matters: tab is an IFS whitespace character, so bash collapses
  # a run of tabs into ONE separator. A branch with no claim note would shift
  # every later field left by one. Everything that must survive `read` is
  # therefore placed BEFORE the optional claim note, which stays last.
  # Emitted fields are never empty ("-" stands in), so no tab run can collapse.
  states=""
  while IFS=$'\t' read -r idx br deferred wname claim; do
    [ -n "$br" ] || continue
    if [ "$deferred" = "true" ]; then st="deferred"; else st=$(branch_state "$br"); fi
    states+="$idx	$br	$st	$deferred	$wname	$claim"$'\n'
  done <<< "$wave_lines"

  # Pass 2: wave verdicts. A wave is complete when none of its non-deferred
  # branches is outstanding; eligible when all PRIOR waves are complete.
  wave_ids=$(printf '%s' "$states" | cut -f1 | sort -un)
  prior_ok=1
  for wid in $wave_ids; do
    wname=$(printf '%s' "$states" | awk -F'\t' -v w="$wid" '$1==w {print $5; exit}')
    [ "$wname" = "-" ] && wname=""
    outstanding=0
    while IFS=$'\t' read -r idx br st deferred nm claim; do
      [ "$idx" = "$wid" ] || continue
      [ "$st" = "deferred" ] && continue
      # strict (default): only a merged branch is settled.
      # loose: pushed work counts too — buys throughput, pays in rebase risk.
      case "$st" in
        merged) ;;
        wip)
          # Loose only counts pushed work as settled when its PR is verifiably
          # ready. Unverifiable → treat as outstanding (i.e. behave as strict).
          if [ "$loose_verifiable" = 1 ] && pr_ready "$br"; then :; else
            outstanding=$((outstanding + 1))
          fi ;;
        *) outstanding=$((outstanding + 1)) ;;
      esac
    done <<< "$states"

    if [ "$outstanding" -eq 0 ]; then verdict="complete"
    elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
    else verdict="blocked"; fi

    [ "$quiet" = 1 ] || echo "  ${wname:-(unnamed)} — $verdict"
    json_branches=""
    while IFS=$'\t' read -r idx br st deferred nm claim; do
      [ "$idx" = "$wid" ] || continue
      [ "$claim" = "-" ] && claim=""
      n_branches=$((n_branches + 1))
      case "$st" in
        deferred) n_deferred=$((n_deferred + 1)); note="deferred" ;;
        claimed)  n_claimed=$((n_claimed + 1));   note="claimed${claim:+ ($claim)}" ;;
        merged)   note="merged" ;;
        wip)      note="in progress" ;;
        *)        note="open" ;;
      esac
      if [ "$verdict" = "eligible" ] && [ "$st" = "open" ]; then
        n_eligible=$((n_eligible + 1))
        claimable+=("$br")
      fi
      [ "$quiet" = 1 ] || echo "      $br — $note"
      if [ "$as_json" = 1 ]; then
        # The INTERNAL state ($st), never the prose label ($note): the board
        # must not parse a string that exists for humans to read.
        json_branches+="${json_branches:+,}{\"branch\":\"$(json_str "$br")\""
        json_branches+=",\"state\":\"$st\",\"deferred\":$deferred"
        json_branches+=",\"claimed\":\"$(json_str "$claim")\""
        # What this machine knows and the refs do not. Absent everywhere else:
        # `local_dirty:false` and `local_worktree:""` are what a branch checked
        # out on somebody else's laptop reports, which is the same answer it
        # gave before this field existed. Only the JSON carries it — the prose
        # report is a human interface and the row it feeds lives in the board.
        wt_row=$(local_worktree_of "$br")
        wt_dirty=$(printf '%s' "$wt_row" | cut -f2)
        wt_here=$(printf '%s' "$wt_row" | cut -f1)
        wt_lock=$(printf '%s' "$wt_row" | cut -f3)
        json_branches+=",\"local_dirty\":${wt_dirty:-false}"
        # A write in progress THIS INSTANT — a separate fact from dirtiness, and
        # false wherever this machine could not observe one, which is the answer
        # every branch elsewhere gives.
        json_branches+=",\"local_locked\":${wt_lock:-false}"
        json_branches+=",\"local_worktree\":\"$(json_str "$wt_here")\""
        # From the REFS, not from the worktree table above — a local branch with
        # no worktree still holds commits nobody can see. 0 wherever this
        # machine has no local ref, which is what every branch elsewhere reports.
        json_branches+=",\"local_ahead\":$(local_ahead_of "$br")"
        # Whether anything is actually RUNNING on the branch — see `worker_of`.
        # The pid and the exit code travel as values rather than as something to
        # re-derive: a pid of 0 has already been rejected here, and re-deriving
        # liveness on the far side would spring that trap again.
        worker_row=$(worker_of "$br")
        json_branches+=",\"worker\":\"$(printf '%s' "$worker_row" | cut -f1)\""
        json_branches+=",\"worker_pid\":\"$(json_str "$(printf '%s' "$worker_row" | cut -f2)")\""
        json_branches+=",\"worker_exit\":\"$(json_str "$(printf '%s' "$worker_row" | cut -f3)")\"}"
      fi
    done <<< "$states"

    if [ "$as_json" = 1 ]; then
      json_waves+="${json_waves:+,}{\"name\":\"$(json_str "$wname")\""
      json_waves+=",\"verdict\":\"$verdict\",\"branches\":[$json_branches]}"
    fi

    n_waves=$((n_waves + 1))
    [ "$verdict" = "complete" ] || prior_ok=0
    [ "$verdict" = "blocked" ] && n_blocked=$((n_blocked + 1))
  done
  if [ "$as_json" = 1 ]; then
    plan_base=$(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")")
    json_plans+="${json_plans:+,}{\"file\":\"$(json_str "$plan_base")\""
    # The plan's own phase, reported verbatim. The board composes it with each
    # branch's git state into a row phase; nothing here decides which column
    # anything reads.
    json_plans+=",\"phase\":\"$(json_str "$plan_phase")\""
    json_plans+=",\"waves\":[$json_waves]}"
  fi
  [ "$quiet" = 1 ] || echo
done

# --next: name ONE branch a worker may claim, or stay silent with exit 1.
# "Nothing to start" is a normal state, not a failure — the exit code is what
# distinguishes it from a name, so callers can branch on it without parsing.
if [ "$next_only" = 1 ]; then
  [ ${#claimable[@]} -gt 0 ] || exit 1
  if [ "$list_all" = 1 ]; then
    printf '%s\n' "${claimable[@]}"
  else
    printf '%s\n' "${claimable[0]}"
  fi
  exit 0
fi

# --log-pulse: append ONE line per plan, clean pulses included. Without a
# record of quiet pulses an idle fleet and a dead fleet are indistinguishable.
# This is a LOG, not state: deleting it changes no behaviour, because the next
# pulse re-derives everything from git.
if [ "$log_pulse" = 1 ]; then
  stamp=$(date -u +%Y-%m-%dT%H:%MZ)
  line="<!-- pulse: $stamp — waves=$n_waves eligible=$n_eligible claimed=$n_claimed blocked=$n_blocked deferred=$n_deferred -->"
  for pf in ${plan_files[@]+"${plan_files[@]}"}; do
    real=$(cd "$(dirname "$pf")" && readlink "$(basename "$pf")" 2>/dev/null || true)
    target=$([ -n "$real" ] && echo "$(dirname "$pf")/$real" || echo "$pf")
    [ -f "$target" ] || continue
    if grep -q '^## Notes' "$target" 2>/dev/null; then
      awk -v ln="$line" '
        /^## Notes/ && !done { print; print ""; print ln; done=1; next }
        { print }
      ' "$target" > "$target.tmp" && mv "$target.tmp" "$target"
    else
      printf '\n## Notes\n\n%s\n' "$line" >> "$target"
    fi
  done
fi

# --json: the same derivation as the prose above, rendered for machines. It is
# an OUTPUT MODE and nothing more — it composes with --offline/--no-fetch/
# --loose rather than implying any of them, so the board's data depends on what
# it asked for, not on how it asked. --next wins over it (handled above): that
# is a different question with a one-line answer.
if [ "$as_json" = 1 ]; then
  printf '{"main":"%s","head":"%s","plans":[%s],' \
    "$(json_str "$MAIN")" "$(json_str "$HEAD_SHORT")" "$json_plans"
  printf '"summary":{"plans":%d,"waves":%d,"branches":%d,"claimed":%d,' \
    "$n_plans" "$n_waves" "$n_branches" "$n_claimed"
  printf '"eligible":%d,"blocked":%d,"deferred":%d,"merge_detect":"%s"}}\n' \
    "$n_eligible" "$n_blocked" "$n_deferred" "$MERGE_DETECT"
  exit 0
fi

# A saturated merge walk is STATED, never silent. A branch merged before the
# cap reads `open`, which is acceptable only while the scan says it stopped
# looking — a silent cap would make the report lie in the one direction this
# check was written to stop.
if [ "$MERGE_SCAN_TRUNCATED" = 1 ]; then
  echo "  note: merge scan hit its limit of $MERGE_SCAN_LIMIT — older merges were not"
  echo "        examined; a branch merged before that point may still read as open."
fi
echo "Pulse complete. This report is derived — nothing was changed."
echo "summary: plans=$n_plans waves=$n_waves branches=$n_branches claimed=$n_claimed eligible=$n_eligible blocked=$n_blocked deferred=$n_deferred merge_detect=$MERGE_DETECT main=$MAIN"
