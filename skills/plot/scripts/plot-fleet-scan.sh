#!/usr/bin/env bash
# Plot helper: fleet pulse — deterministic extractor for wave/claim state.
# Usage: plot-fleet-scan.sh [--no-fetch] [--offline] [--next] [<slug>]
#   --no-fetch  skip `git fetch`
#   --offline   same (no network) — used for cheap, ambient pulses.
#               The fetch also PRUNES remote-tracking refs, so skipping it
#               keeps whatever stale refs this checkout holds: a branch merged
#               and deleted upstream may read `wip` rather than `merged`, and
#               its wave may read blocked. That is the honest answer for a scan
#               that asked nothing, and the footer says so rather than leaving
#               it to be discovered.
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
#   --stream    --json, emitted as it resolves rather than as one document at
#               the end. One `{"kind":"plan","plan":{...}}` line per plan the
#               moment that plan is fully derived, then one
#               `{"kind":"pulse","pulse":{...}}` line carrying the SAME
#               document --json prints. A consumer that has seen plan lines and
#               no pulse line holds a PARTIAL answer — the scan takes 18 s on
#               84 branches and a board that renders nothing for that long
#               looks broken. The terminal line is what says the scan finished;
#               a closed pipe does not, because a killed scan closes it too.
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
#         Plans are enumerated from `origin/<main>` (`git ls-tree`/`git show`),
#         NOT from the working tree — so the list describes one atomic commit
#         and does not change while rebases and worker commits rewrite the
#         checkout underneath a running fleet. A consequence worth stating: an
#         UNCOMMITTED plan is invisible, deliberately — the fleet view shows
#         what is shared, and a plan only this machine has cannot be claimed by
#         any worker. --json carries `plan_source` (ref | worktree), which
#         reads `worktree` only when `origin/<main>` cannot be resolved at all.
#         --json also carries `fetch_failed` and `fetch_error`: a failed fetch
#         means these refs are older than the report implies, and that fact is
#         now reported rather than discarded.
#         --json additionally carries, per branch, what THIS MACHINE knows and
#         the refs do not: `local_dirty` (a local worktree has uncommitted
#         changes), `local_locked` (a local worktree holds `.git/index.lock` —
#         a write is in progress THIS INSTANT), `local_worktree` (where it is
#         checked out here) and `local_ahead` (commits on the local branch the
#         remote does not have). All four are absent-shaped — false, false, ""
#         and 0 — wherever this machine holds nothing, so a branch living on
#         another machine answers exactly as it did before.
#         --json additionally carries `changed_ago_seconds`: how long since this
#         branch last CHANGED, from any source — the newest of its last commit,
#         the newest mtime on the floor (editor leftovers excluded) and the
#         worker log. The other local signals are STATE and cannot separate a
#         branch that finished from one that was abandoned; both read
#         `ahead=0 dirty=false`. This is `null` — never 0 — wherever this
#         machine has no worktree, and branches with none cost nothing to skip.
#         IT IS A MEASUREMENT AND NOT A VERDICT: no threshold, no `stalled`.
#         A worker inside a serial test suite writes nothing for minutes while
#         its child processes work, and this will correctly report it quiet —
#         so "quiet" must not be rendered as "stuck". Worker verdicts belong to
#         `plot-worker-state.sh`; the threshold belongs to the reader.
#         --json additionally carries, per branch, WHICH FILES would collide
#         merging it into the default branch: `conflicts` (paths, from
#         `git merge-tree --write-tree`, which computes entirely in memory),
#         `conflicts_known` (whether the question was asked at all) and
#         `changed_paths` (what the branch touches, capped and reported as
#         evidence). `conflicts_known` is what keeps an empty list from meaning
#         two things — a branch that merges cleanly and one nobody could ask.
#         The SET is reported and never judged: which sets mean what is a
#         decision one layer up.
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

# The shared worker classifier. Sourced by both this script and
# plot-dispatch.sh so a worker has ONE state, not one per reader.
# shellcheck source=plot-worker-state.sh
. "$script_dir/plot-worker-state.sh"
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

do_fetch=1
next_only=0
list_all=0
loose=0
log_pulse=0
as_json=0
stream=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch|--offline) do_fetch=0 ;;
    --loose) loose=1 ;;
    --log-pulse) log_pulse=1 ;;
    --next) next_only=1 ;;
    --list-eligible) next_only=1; list_all=1 ;;
    --json) as_json=1 ;;
    --stream) as_json=1; stream=1 ;;
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

# A FAILED FETCH IS A FACT, not a shrug. The old line was
# `git fetch ... 2>/dev/null` with its status discarded: a GitHub 503, a
# concurrent worker holding the ref lock, an offline laptop — every one of
# them produced a scan indistinguishable from a healthy one, reporting refs
# that were older than the banner claimed. That is the same failure this whole
# plan is about, one layer up: the report was more confident than its evidence.
#
# The scan STILL RUNS on a failed fetch, and that is deliberate. `origin/$MAIN`
# from an hour ago is a real answer about a real commit; refusing to report it
# would trade a slightly stale board for no board at all, exactly when the
# operator is most likely to be watching something go wrong. What changes is
# that the staleness is CARRIED — `fetch_failed` in `--json`, a line in the
# prose report — so a consumer can mark the view instead of trusting it blindly.
#
# --offline/--no-fetch is NOT a failure. The operator asked for local refs and
# got them; there is nothing to report but the fact that no fetch was tried.
#
# THE FETCH PRUNES WHAT IT FETCHES. `git fetch` does not remove
# remote-tracking refs for branches deleted upstream; only `--prune` does. A
# branch merged with --delete-branch therefore leaves `refs/remotes/origin/<br>`
# behind on every machine that ever fetched it, and it survives until somebody
# prunes for unrelated reasons. That leftover is not noise: branch_state()
# picks its arm on the ref's PRESENCE, so a stale ref routes the branch into
# the ancestry path — which a squash merge breaks by construction — and the
# host lookup that would have answered `merged` is never reached. Measured
# 2026-08-18: a wave could not be dispatched at all until an operator happened
# to run `git fetch --prune` by hand.
#
# THE EXPLICIT REFSPEC IS REQUIRED, and this is the part that is easy to get
# wrong: `git fetch --prune origin "$MAIN"` prunes NOTHING outside $MAIN.
# Naming a refspec scopes the prune to that refspec's destination namespace, so
# the narrow fetch this scan makes would prune only `refs/remotes/origin/$MAIN`
# — a no-op for exactly the branches this exists to clear. Restating the
# default heads refspec widens the prune back to the whole mirror while the
# narrow one keeps the intent legible: fetch $MAIN, and while the connection is
# open, make the local mirror match the remote.
#
# NOTHING HERE DEPENDS ON A STALE REF SURVIVING. The case to fear is a branch
# deleted upstream while a local worktree still holds work: `local_ahead_of()`
# reads `refs/remotes/origin/<br>..refs/heads/<br>`, so pruning removes its left
# side. It already answers 0 on a missing ref by exit code rather than by
# emptiness ("not observed → not reported"), which is the same answer it gives
# for every branch living on another machine — so the count degrades to absent,
# never to a wrong number. `local_dirty`, `local_locked` and `local_worktree`
# read the worktree, not the mirror, so uncommitted work stays visible either
# way. Conflict prediction is gated to wip|claimed and a pruned branch is
# neither. The local `refs/heads/<br>` is untouched: --prune removes only
# remote-tracking refs, so no local work is destroyed or hidden by this.
#
# ONE CONNECTION, NOT TWO. The prune rides the fetch already being made — no
# extra round trip on a scan the board polls every five seconds.
FETCH_FAILED=0
FETCH_ERROR=""
if [ "$do_fetch" = 1 ]; then
  if ! FETCH_ERROR=$(git fetch -q --prune origin "$MAIN" \
                       "+refs/heads/*:refs/remotes/origin/*" 2>&1); then
    FETCH_FAILED=1
    # Collapsed to one line: git's multi-line advice is for a human at a
    # terminal, and this string travels through JSON into a board cell.
    FETCH_ERROR=$(printf '%s' "$FETCH_ERROR" | tr '\n' ' ' | sed 's/  */ /g; s/^ *//; s/ *$//')
    [ -n "$FETCH_ERROR" ] || FETCH_ERROR="git fetch failed with no message"
  else
    FETCH_ERROR=""
  fi
fi

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
# Squash merges: the case where no local evidence survives at all
# ---------------------------------------------------------------------------
#
# The merge walk above finds a branch whose PR produced a MERGE COMMIT. A
# squash merge produces none: measured on the merge of PR #209, the commit on
# the default branch has ONE parent and a subject naming `(#209)` — the PR
# number, never the branch. So the exhaustive walk has nothing to match, and a
# branch squash-merged and deleted reads `open`: the same word used for work
# nobody has started. Its wave never completes, and the next wave stays blocked
# forever.
#
# The data is not missing — it is simply not local. `pr-state` answers in one
# call, and a branch with NO REF is exactly where that call is worth making:
# nothing local is left to read, so the host is the only remaining source, and
# the cost follows the count of ABSENT branches rather than all of them.
#
# THE FAILURE DIRECTION IS THE POINT. `plot-host.sh` already separates a lookup
# miss (exit 0, state NONE) from a transport failure (non-zero) — the
# distinction it grew on 2026-08-17, when GitHub returned 503 all afternoon and
# every branch read as having no PR. Both arms land on today's `open` here, and
# ONLY an explicit "MERGED" may move a branch off it. An unreachable host must
# never manufacture a `merged`, because `merged` settles a wave and opens the
# next one on work that may not have landed.
#
# GATED ONCE PER RUN, not per branch, and it honours --offline: that flag
# promises no network, and a scan that promised no network and then called the
# host would be lying in the direction of a slow ambient pulse. Without a
# backend — or offline — the lookup is simply never attempted and every branch
# answers exactly as it did before.
HOST_LOOKUP_OK=0
if [ "$do_fetch" = 1 ] \
   && [ "$("$script_dir/plot-host.sh" backend 2>/dev/null)" != "none" ]; then
  HOST_LOOKUP_OK=1
fi

# ONE ANSWER PER BRANCH PER RUN, cached on disk rather than in a variable.
#
# `branch_state` is called as `$(branch_state "$br")` — a SUBSHELL — so a
# variable it assigned would be discarded the moment the substitution closed,
# and every branch would pay the call again. The board polls this scan every
# 5 s; a plan whose branches were all squash-merged would otherwise spend one
# host call per branch, per poll, forever.
#
# A directory is the cache because it survives the subshell without restructuring
# the caller, and it is created per run and removed on exit, so no answer ever
# outlives the scan that fetched it — a stale `merged` read from a previous run
# is exactly the fabricated verdict the failure direction above forbids.
#
# Cleanup is trapped rather than trailing: the script exits early in several
# places (--next with nothing to start, no active plans), and a temp directory
# left behind on those paths would accumulate one per poll.
HOST_STATE_CACHE=""
if [ "$HOST_LOOKUP_OK" = 1 ]; then
  HOST_STATE_CACHE=$(mktemp -d 2>/dev/null) || HOST_STATE_CACHE=""
  [ -n "$HOST_STATE_CACHE" ] \
    && trap 'rm -rf "$HOST_STATE_CACHE" 2>/dev/null || true' EXIT INT TERM
fi

# The cache key. Shared by the join and by `host_pr_state`, because the two
# must agree on it EXACTLY: a prefill written under one spelling and read under
# another is a cache that silently never hits, which restores the per-branch
# cost this whole change removes — and does it invisibly, since every answer is
# still correct.
#
# The branch name contains slashes and a flat file per branch needs them gone,
# but the mapping must be INJECTIVE. `tr '/' '_'` is not: `feature/a_b` and
# `feature_a/b` are both legal refs and collapse to one key, and a collision
# here serves one branch's verdict to another — which, when the verdict is
# `merged`, settles a wave on a branch nobody looked at. Encoding `_` first
# makes the substitution reversible, so distinct refs stay distinct.
cache_key() { # $1=branch → a filename that is injective in the branch name
  printf '%s' "$1" | sed 's/_/__/g; s|/|_|g'
}

# ---------------------------------------------------------------------------
# ONE LIST, JOINED LOCALLY — not one lookup per branch
# ---------------------------------------------------------------------------
#
# THE MEASUREMENT THAT FORCED THIS (issues #228 and #226, both 2026-08-18):
#
#   bitbucket/ekzweb   14 branches → 39 `bb` calls, scan unfinished at 110 s
#   this repo, GitHub  84 branches × 438 ms      → 34 s observed
#   one pr-list (all)                            → 1107 ms
#
# The board's `run()` helper times out at 30 s (`fleet.ts:260`), so the scan had
# begun exceeding it on GitHub too: the board served a pulse 644 s old while
# reporting `Command failed`, and the reason was invisible to the operator.
#
# The scan needs `branch → state` for a KNOWN SET of branches. That is a JOIN
# over one response, not N lookups — and the ratio worsens with every branch
# added, which is what makes it a shape problem rather than a tuning one.
#
# WHAT THE JOIN MAY NOT DO, and why it is written the way it is:
#
#   * AN EMPTY JOIN IS NOT A FAILED JOIN. `plot-host.sh` separates a lookup
#     miss (exit 0, state NONE) from a transport failure (non-zero) — the
#     distinction it grew on 2026-08-17, when GitHub returned 503 all afternoon
#     and every branch read as having no PR. A join over a response that never
#     arrived is that same trap in a new shape, so the list's EXIT CODE is
#     checked before its payload is read, and a failed list prefills NOTHING.
#     Branches then answer `-` (unanswerable) exactly as they did during an
#     outage before this existed — never a confident "no PR".
#
#   * THE PAGE LIMIT IS NOT OPTIONAL. Measured on this repo 2026-08-18: 221 PRs
#     exist and `pr-list --state all` returns 30 without `--limit`, because that
#     is the host CLI's default. Joining against the newest 30 would silently
#     lose 191 PRs — every older merged branch reading as "no PR", which is the
#     fabricated verdict this scan refuses everywhere else. The limit is asked
#     for explicitly and generously; one call for all 221 measured at 1.8 s.
#
#   * THE VOCABULARY IS THE HOST ADAPTER'S, UNCHANGED. `pr-list` already emits
#     OPEN/MERGED/CLOSED per PR and already folds Bitbucket's DECLINED into
#     CLOSED, the same three-way vocabulary `pr-state` produces. Nothing is
#     translated here.
#
# ONE PR PER BRANCH, and the ordering decides which. A branch can carry several
# PRs over its life — opened, closed, reopened — and `pr-list` returns all of
# them. OPEN outranks MERGED outranks CLOSED, matching the walk `pr-state`
# already performs on Bitbucket, so the join and the per-branch lookup cannot
# disagree about the same branch.
PR_LIST_LIMIT="${PLOT_PR_LIST_LIMIT:-1000}"
prefill_pr_states() {
  [ "$HOST_LOOKUP_OK" = 1 ] || return 0
  [ -n "$HOST_STATE_CACHE" ] || return 0
  local js br st key
  # Exit code first: non-zero is a transport failure and its stdout is not an
  # answer. A failed list leaves the cache EMPTY, so every branch falls through
  # to the unanswerable `-` rather than to a fabricated "no PR".
  js=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" \
         </dev/null 2>/dev/null) || return 0
  # `pr-list` emits one compact JSON object per line. PARSED IN ONE PASS, and
  # that is a correctness-of-cost property rather than a style preference:
  # measured 2026-08-18 on this repo's 221 PRs, a `sed` per field per row —
  # 442 forks — took 46 s, which is WORSE than the 34 s of host calls this
  # change exists to remove. Trading N network round trips for N process forks
  # is not a fix. One `sed` over the whole stream emits `branch<TAB>state`, and
  # the loop below forks nothing at all.
  #
  # The fields are matched in their emitted order (`state` precedes `head`) and
  # anchored to `","head":"` so a PR TITLE containing the word `state` cannot be
  # mistaken for the field — titles are free text and this repo has several
  # that name their own fields.
  #
  # `cache_key`'s substitution is inlined here for the same fork reason. It must
  # stay IDENTICAL to that function; a divergence is a cache that silently never
  # hits.
  #
  # STATE FIRST, BRANCH LAST. A branch name may contain almost anything; the
  # state is a single bare word. Emitting `STATE<TAB>branch` lets the key
  # encoding be one anchored substitution on the tail of the line, with no
  # reconstruction of the separator afterwards.
  # THE ROWS ARRIVE ALREADY RANKED, so this loop needs no memory of what it has
  # seen and forks nothing to find out. `sort` below puts the winning row for
  # each branch first; `last=` skips the rest of that branch's rows with a
  # string compare. Reading the rank back from the file with `$(cat …)` would
  # be a fork PER DUPLICATE ROW, which is what this loop was rewritten to avoid.
  local last=""
  while IFS="	" read -r st br; do
    [ -n "$br" ] && [ -n "$st" ] || continue
    [ "$br" = "$last" ] && continue
    last="$br"
    printf '%s' "$st" > "$HOST_STATE_CACHE/$br" 2>/dev/null || true
  done <<EOF
$(printf '%s\n' "$js" \
  | sed -n 's/.*"state":"\([A-Z]*\)","head":"\([^"]*\)".*/\1	\2/p' \
  | sed 's/_/__/g; s|/|_|g; s|^\([A-Z]*\)_|\1	|' \
  | sed 's/^OPEN	/1	OPEN	/; s/^MERGED	/2	MERGED	/; s/^\([A-Z]\)/3	\1/' \
  | sort -t"$(printf '\t')" -k3,3 -k1,1 | cut -f2,3)
EOF
  # The pipeline above, read left to right:
  #   1. pull `STATE<TAB>branch` out of each JSON line, anchored on the two
  #      fields' emitted adjacency so a free-text TITLE cannot impersonate them;
  #   2. encode the branch into the injective cache key (`cache_key`, inlined);
  #   3. prefix a RANK digit — OPEN 1, MERGED 2, everything else 3;
  #   4. sort by branch, then rank, so each branch's winning row comes first;
  #   5. drop the rank column again.
  # The loop then keeps the first row per branch and skips the rest.
  # THE LIST ARRIVED. Recorded as a fact of its own, because "the cache has no
  # entry for this branch" means two different things and only this flag tells
  # them apart: with the list in hand it is real evidence of no PR, without it
  # the question was never answered. `host_pr_state` reads this to decide
  # between NONE and `-`.
  #
  # The marker shares the cache directory with the per-branch files and CANNOT
  # collide with one: `git check-ref-format` rejects a branch whose name starts
  # with a dot, and the key encoding maps only `_` and `/`, so no branch key can
  # begin with one either. The separation is git's rule, not a lucky prefix.
  printf '1' > "$HOST_STATE_CACHE/.list-arrived" 2>/dev/null || true
}
prefill_pr_states

# The cache stores the STATE WORD, not a yes/no, so a future reader can tell
# "asked, answered CLOSED" from "asked, could not reach the host". `-` is the
# unanswerable marker, and it is cached too: a host that is down stays down for
# the length of a scan, and re-asking once per branch would multiply an outage
# by the branch count.
#
# The host's PR state word for a branch, cached once per branch per run.
#
# SPLIT OUT OF `merged_by_host` so a SECOND question can reuse the SAME cached
# reply. `worker_of` needs to know whether an OPEN PR exists — the fact that
# outranks everything in the worker classification — and `merged` does not
# answer it: a branch under review reads `wip` by ancestry and MERGED by
# neither. Asking the host again would double the per-branch cost this cache
# exists to avoid, on a scan the board polls every 5 s.
#
# Returns the STATE WORD, or `-` when the question could not be answered —
# never a yes/no, so each caller applies its own test and a reader can still
# tell "asked, answered CLOSED" from "asked, could not reach the host".
# THE PER-BRANCH LOOKUP IS NOW OPT-IN, and that is the whole saving.
#
# `--ask` asks the host about this ONE branch when the join cannot answer. Only
# the no-ref arm passes it (PR #216), and that is bounded by ABSENT branches
# rather than by all of them — a branch with no ref may genuinely be missing
# from a repo-wide list if its PR was never opened, so the list's silence about
# it is not evidence.
#
# Without `--ask` an unjoined branch answers from the list alone: NONE when the
# list arrived (real evidence — the repo has no PR for it) and `-` when it did
# not (the question was never answered). Collapsing those two is the 2026-08-17
# failure in a new shape and is what the `.list-arrived` marker prevents.
host_pr_state() { # $1=branch [--ask] → OPEN|MERGED|CLOSED|NONE|-
  [ "$HOST_LOOKUP_OK" = 1 ] || { printf '%s' '-'; return; }
  local br="$1" ask="${2:-}" st js cache=""
  [ -n "$HOST_STATE_CACHE" ] && cache="$HOST_STATE_CACHE/$(cache_key "$br")"
  if [ -n "$cache" ] && [ -f "$cache" ]; then
    printf '%s' "$(cat "$cache" 2>/dev/null)"
    return
  fi
  if [ "$ask" = "--ask" ]; then
    # Exit code first: non-zero is a transport failure and its stdout is not an
    # answer. Only then is the payload read.
    if js=$("$script_dir/plot-host.sh" pr-state "$br" </dev/null 2>/dev/null); then
      st=$(printf '%s' "$js" | sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p')
      [ -n "$st" ] || st='-'
    else
      st='-'
    fi
    # Cached even when it is `-`: a host that is down stays down for the length
    # of a scan, and re-asking once per branch would multiply an outage by the
    # branch count.
    [ -n "$cache" ] && printf '%s' "$st" > "$cache" 2>/dev/null
    printf '%s' "$st"
    return
  fi
  # Not asked, not joined. The list's own arrival decides which silence this is.
  if [ -n "$HOST_STATE_CACHE" ] && [ -f "$HOST_STATE_CACHE/.list-arrived" ]; then
    printf '%s' 'NONE'
  else
    printf '%s' '-'
  fi
}

# ---------------------------------------------------------------------------
# A TERMINAL BRANCH IS ASKED ONCE — the cache that spans pulses
# ---------------------------------------------------------------------------
#
# THE MEASUREMENT, taken on this repo 2026-08-19 after the join (#232) landed:
# 26 of 54 branches are terminal — merged or deferred — and a terminal fact
# cannot change. A merged branch stays merged. The board pulses every 5 s, so
# the scan re-derived those 26 answers at full price, forever.
#
# WHAT THE JOIN LEFT FOR THIS TO FIX. Measured in a sandbox before writing it:
#
#   merged, ref KEPT        3 branches → 1 pr-list    9 → 1 pr-list
#   squash-merged, DELETED  3 branches → 3 pr-state   9 → 9 pr-state
#
# After #232 the ONLY per-branch host cost left is the no-ref `--ask` arm that
# PR #216 put there — and that arm IS the terminal population: a branch whose
# ref is gone and whose merge already landed. So the cache lands exactly there
# and nowhere else. A live branch cannot be cached even by accident, because a
# live branch has a ref and never reaches the call.
#
# THE CACHE IS A DERIVATION, NOT A RECORD. That distinction is the whole design
# and Manifesto Principle 1 rests on it: nothing is remembered that git cannot
# re-establish. GIT IS CONSULTED ON EVERY PASS; only the host round trip is
# skipped. The asymmetry is the point — git is local and cheap, the host is
# remote and metered — and a cache that also skipped git would be a record of
# the past rather than a derivation of the present.
#
# So an entry carries THE EVIDENCE THAT MADE THE BRANCH TERMINAL, and every
# pass asks git whether that evidence still holds:
#
#   branch <TAB> state <TAB> plan-oid <TAB> main-oid
#
#   * THE REF REAPPEARED → not served, and not even reached. A branch name is
#     reusable: merge `bug/flaky`, delete it, push it again for a second
#     attempt. Serving the first attempt's `merged` would settle a wave and
#     open the next one on work that has not landed. Checked live rather than
#     stored, because a ref's absence is the precondition of the call itself.
#   * THE PLAN WAS EDITED → its branches' answers are discarded. A plan is an
#     INPUT to the derivation, not just a list of names: `deferred:`
#     annotations, wave membership and the plan's phase all decide what an
#     answer means. Content-addressed by blob hash, so an edit is caught
#     without trusting a timestamp.
#   * MAIN MOVED → the merge evidence is re-derived. `merged_by_subject` walks
#     main's history, so a new tip is a new question.
#
# IT NEVER TOUCHES DISK AND NEVER OUTLIVES A PROCESS. The scan is spawned fresh
# every pulse, so it cannot hold the map itself; it RECEIVES the cache in the
# environment and REPORTS what it learned on stderr, leaving stdout
# byte-identical. The board — the only long-lived process in the system — holds
# the map in memory and dies with it. A file would be a second source of truth
# about a repo whose only source of truth is git, and a restart must re-derive
# everything.
# Defaulted rather than assumed: `set -u` is on, and an unset variable here
# would abort the scan for every caller that does not know the cache exists —
# which is every caller but the board.
PLOT_TERMINAL_CACHE="${PLOT_TERMINAL_CACHE:-}"
TERMINAL_LEARNED=""
# The tip the merge evidence is derived against, resolved once per run.
TERMINAL_MAIN_OID=$(git rev-parse "refs/remotes/origin/$MAIN" 2>/dev/null || echo "-")
# The plan whose branches are currently being walked, as a blob hash. Set by the
# plan loop; empty until then, and an entry with no plan identity is never
# served — an answer we cannot attribute to a plan revision is not evidence.
TERMINAL_PLAN_OID=""

# Is this branch's cached answer still good? Prints the state word when it is.
#
# THE VALIDATION IS THE FEATURE. Every arm here is a question to git, asked on
# every pass, and any disagreement discards the entry rather than repairing it.
terminal_cached() { # $1=branch → the cached state word, or nothing
  [ -n "$PLOT_TERMINAL_CACHE" ] || return 1
  [ -n "$TERMINAL_PLAN_OID" ] || return 1
  local br="$1" cbr cst cplan cmain
  while IFS="	" read -r cbr cst cplan cmain; do
    [ "$cbr" = "$br" ] || continue
    # The plan revision the answer was derived under, and the tip it was
    # derived against. Either having moved makes it a fact about a repo that no
    # longer exists.
    [ "$cplan" = "$TERMINAL_PLAN_OID" ] || return 1
    [ "$cmain" = "$TERMINAL_MAIN_OID" ] || return 1
    printf '%s' "$cst"
    return 0
  done <<EOF
$PLOT_TERMINAL_CACHE
EOF
  return 1
}

# Record a decided terminal answer for the next pulse to reuse.
#
# ONLY A DECIDED ANSWER IS TERMINAL. `-` means the question could not be
# answered, and caching it would freeze one bad afternoon into every later
# pulse — the 2026-08-17 outage multiplied by the life of the board rather than
# by the branch count. `MERGED` and `CLOSED` are settled; `OPEN` and `NONE` are
# not, because both can still change without anything local moving.
terminal_learn() { # $1=branch $2=state
  case "$2" in MERGED|CLOSED) ;; *) return 0 ;; esac
  [ -n "$TERMINAL_PLAN_OID" ] || return 0
  TERMINAL_LEARNED+="$1	$2	$TERMINAL_PLAN_OID	$TERMINAL_MAIN_OID"$'\n'
  # Reported as it is learned rather than at exit: the scan is killed with
  # SIGKILL on timeout (`fleet.ts`), and a summary written only on a clean exit
  # would teach the board nothing on exactly the slow pulses that need it most.
  printf 'terminal: %s\t%s\t%s\t%s\n' \
    "$1" "$2" "$TERMINAL_PLAN_OID" "$TERMINAL_MAIN_OID" >&2
}

# Does the host say this branch's PR is MERGED? Anything else — OPEN, CLOSED,
# NONE, an unreachable host, a malformed reply — is NOT a yes. Unchanged in
# behaviour; only the lookup underneath it is now shared.
#
# THE ONE CALLER THAT MAY ASK PER BRANCH (PR #216). It is reached only from the
# no-ref arm of `branch_state`, for a branch the repo-wide list may legitimately
# not contain, and its cost is therefore bounded by ABSENT branches rather than
# by all of them. The join answers everything else. Do not add `--ask` to a
# caller that runs for every branch — that is the loop this change removed.
#
# THE ONE PLACE THE TERMINAL CACHE IS CONSULTED, and it is deliberate that
# there is only one. This arm is reached only for a branch with NO REF, so a
# branch that is live — in flight, claimed, or with work on the floor — never
# arrives here and therefore cannot be cached however the cache is filled. The
# invariant is structural rather than a check that could be forgotten.
merged_by_host() { # $1=branch → 0 when the host reports its PR MERGED
  local st
  # Git has already been consulted to get here (no ref) and `terminal_cached`
  # asks it again about the plan and the tip. Only the round trip is skipped.
  if st=$(terminal_cached "$1"); then
    # A SERVED ENTRY RE-REPORTS ITSELF, so what the scan emits is always the
    # WHOLE map the next pulse should hold rather than a delta the board would
    # have to merge. Without this the second pulse serves the entry, reports
    # nothing, and the third starts cold — the cache would work exactly once
    # and the saving would vanish on the pulse after it.
    #
    # It is re-derived, not merely echoed: reaching here means git was asked
    # again this pass and still agrees — no ref, same plan, same tip.
    terminal_learn "$1" "$st"
    [ "$st" = "MERGED" ]
    return
  fi
  st=$(host_pr_state "$1" --ask)
  terminal_learn "$1" "$st"
  [ "$st" = "MERGED" ]
}

# Has this branch's work REACHED REVIEW — an open or merged PR?
#
# The fact that outranks every local signal in the worker classification: work
# under review has left the worker's hands, so leftover edits in its worktree
# are not unfinished work. OPEN and MERGED both count; CLOSED does not, because
# a closed PR is work that was rejected or withdrawn and whatever sits in the
# worktree is back on the floor.
#
# UNANSWERABLE IS NOT A YES, and the direction matters. `-` — offline, no
# backend, a host returning 503 all afternoon — must not manufacture the state
# that tells a reader to stop looking. It falls through to the local signals,
# so a branch with work on the floor reads `stalled`: go and look. That is the
# safe direction for an answer nobody could verify.
reached_review() { # $1=branch → 0 when an open or merged PR exists
  case "$(host_pr_state "$1")" in OPEN|MERGED) return 0 ;; *) return 1 ;; esac
}

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
#
# THE FORM IS DETECTED ONCE, and that is an efficiency fix rather than a
# correctness one — the output validation below still has the last word. Two
# costs made it worth doing here: `for m in "$(bsd)" "$(gnu)"` evaluates BOTH
# command substitutions before the loop body runs, so the second fork happens
# even when the first answered; and on Linux the first fork is the one that
# prints five lines of filesystem report to be thrown away. Measured on this
# machine: ~60 ms per fork under load. Paid once per delivered plan that was
# affordable; `changed_ago_seconds` asks per worktree, and the same waste
# compounds.
#
# `-c` IS PROBED FIRST, deliberately, the same order `plot-board-probe.sh`
# settled on: GNU is the implementation that mis-parses the other's flag, so
# asking it its own question first means the ambiguous form is never reached on
# Linux. Verified on both platforms while writing this — macOS rejects `-c`
# with an empty stdout, alpine's busybox answers `-c` and pollutes stdout for
# `-f`.
# DETECTED LAZILY, INSIDE THE FUNCTION, so `file_mtime` stays SELF-CONTAINED.
# `fleetdelivered.test.mjs` lifts this function out of the script by regex and
# runs it standalone — deliberately, since sourcing the file would execute the
# whole scan — so a form probed at top level would leave the extracted copy with
# an unset variable under `set -u`. That test says so itself: a reshaped
# function is a signal to look, not to skip. It caught this.
_STAT_FMT=""

file_mtime() { # $1=path → epoch seconds, or ""
  local m
  # Probed on first use and remembered. `-c` FIRST, deliberately, the same order
  # `plot-board-probe.sh` settled on: GNU is the implementation that mis-parses
  # the other's flag, so asking it its own question first means the ambiguous
  # form is never reached on Linux. Verified on both platforms while writing
  # this — macOS rejects `-c` with an empty stdout, alpine's busybox answers
  # `-c` and pollutes stdout for `-f`.
  if [ -z "${_STAT_FMT:-}" ]; then
    if [ -n "$(stat -c %Y "$1" 2>/dev/null)" ]; then
      _STAT_FMT="gnu"
    elif [ -n "$(stat -f %m "$1" 2>/dev/null)" ]; then
      _STAT_FMT="bsd"
    else
      _STAT_FMT="none"
    fi
  fi
  case "$_STAT_FMT" in
    gnu) m=$(stat -c %Y "$1" 2>/dev/null) ;;
    bsd) m=$(stat -f %m "$1" 2>/dev/null) ;;
    # No `stat` at all, or one that speaks neither dialect — or a first path
    # that could not be read, which would misprobe. Fall back to trying both and
    # validating the output, which is what this function did before the
    # detection existed. Slower, still correct, and it re-probes next call.
    *)
      _STAT_FMT=""
      for m in "$(stat -c %Y "$1" 2>/dev/null)" "$(stat -f %m "$1" 2>/dev/null)"; do
        case "$m" in
          ''|*[!0-9]*) ;;
          *) printf '%s' "$m"; return 0 ;;
        esac
      done
      return 1 ;;
  esac
  # The OUTPUT is validated, never the exit code — kept from the original for
  # the reason it was written: a form that "succeeds" while answering a
  # different question must not reach the arithmetic that consumes this.
  case "$m" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$m"; return 0 ;;
  esac
}

# The newest mtime among MANY paths, in ONE `stat` call — epoch seconds, or ""
# when none could be read.
#
# ONE FORK FOR THE WHOLE LIST, and the measurement is why this is not a loop
# over `file_mtime`. `stat` takes many paths and prints one line each on both
# dialects (verified on macOS and alpine). Measured here: 50 sequential forks
# cost 3.1 s, one batched call over three paths cost 0.023 s. A worker mid-build
# has hundreds of untracked files, so per-file forking would have made the pulse
# slower than the work it measures — the plan budgeted "one directory stat per
# worktree" and the design it describes implies one per FILE. Batching is what
# makes those two the same number again.
#
# NO `xargs`, NO ARGUMENT-LIMIT DANCE. A path list long enough to exceed
# `ARG_MAX` (~1 MB) is not a case this needs to serve: the answer is the MAXIMUM
# mtime, so a truncated list can only under-report, and a worktree with tens of
# thousands of dirty files has an answer no operator is reading a clock for. The
# list is capped by the caller instead, which reports that it capped.
#
# UNREADABLE PATHS ARE SKIPPED, not zeroed. `stat` prints nothing for a path it
# cannot read (a file deleted between `git status` and here — a live race in a
# worktree being written to), and a zero would be the newest-looking answer's
# opposite: it drags nothing down, but a fabricated 0 elsewhere in this field
# would read as 1970. Non-digit lines are dropped for the same reason.
newest_mtime() { # $@=paths → epoch seconds, or ""
  [ "$#" -gt 0 ] || return 1
  local out
  # Share `file_mtime`'s probe rather than repeating it: one call settles
  # `_STAT_FMT` for the run, and the batched form below can then be chosen
  # without a second detection. Its answer is discarded — only the side effect
  # is wanted, and a path that cannot be read leaves the format unset, which the
  # `*)` arm handles.
  [ -n "${_STAT_FMT:-}" ] || file_mtime "$1" >/dev/null 2>&1
  case "${_STAT_FMT:-}" in
    gnu) out=$(stat -c %Y "$@" 2>/dev/null) ;;
    bsd) out=$(stat -f %m "$@" 2>/dev/null) ;;
    *)   return 1 ;;
  esac
  # `sort -n | tail -1` would fork twice more for a maximum awk already has in
  # hand. The digit test is what keeps a filesystem report — should the
  # detection ever be wrong — out of the arithmetic downstream.
  printf '%s\n' "$out" | awk '
    /^[0-9]+$/ { if ($1 > max) max = $1 }
    END { if (max != "") print max }
  '
}

# THE DIRTY LIST IS CAPPED, AND THE CAP NEEDS NO SATURATION FLAG — the one
# place in this file where that is true, so it is argued rather than assumed.
#
# The rule elsewhere here is that caps drop results silently unless they also
# report saturation, and it holds because those caps report a SET: a truncated
# conflict list reads exactly like a short one, and the reader cannot tell. This
# cap feeds a MAXIMUM. Dropping members of a set you take the max over can only
# move the answer EARLIER — it can never invent recency — so the failure mode is
# "reported quieter than it is", which is the direction that makes a reader look
# rather than the one that reassures them wrongly.
#
# WHICH 500, STATED PLAINLY: the first 500 in git's own order, which is
# alphabetical by path — NOT the 500 newest. Sorting by mtime to pick the newest
# would need every file's mtime first, which is the entire cost the cap exists
# to bound. So on a worktree past the cap the answer is the newest among an
# arbitrary subset, and it is reported as the same number as any other run.
#
# That is acceptable HERE and would not be in a set-shaped field, for the reason
# above: it can only under-report. It is written down because a reader who
# assumes "newest 500" would trust a capped answer more than it deserves.
#
# 500 is far above any hand-edited working set and far below `ARG_MAX` (~1 MB of
# argv). A tree big enough to hit it is a build directory, not a person's work.
CHANGED_DIRTY_CAP=500

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

# ---------------------------------------------------------------------------
# EVERY REMOTE REF, IN ONE CALL — the spawn count IS the cost
# ---------------------------------------------------------------------------
#
# THE MEASUREMENT, 2026-08-20, with a wrapper counting every `git` invocation:
# 459 spawns for one scan of 54 branches, at 56 ms of process launch each —
# roughly 24 s before git does any work. No single operation was slow: `fetch`
# 0 s, `pr-list` 1 s, all 54 ancestry walks 1 s together. The distribution had
# no hotspot (68 rev-list, 68 ls-tree, 67 show, 59 show-ref) because the cost is
# the SPAWNING: 8 per branch, 54 branches.
#
# `git show-ref --verify` was asked once per branch from two places, always the
# same question — does `origin/<branch>` exist. `for-each-ref` answers it for
# every branch at once, so 59 spawns become one.
#
# Spawn cost is itself a property of the ESTATE rather than of this script:
# every git process reads the ref database and worktree list at startup.
# Measured on this repo, 44 worktrees gave 56 ms per spawn and a 105 s scan;
# after removing 33 finished ones, 31 ms and 63 s. Both multipliers are real,
# which is why housekeeping alone did not reach the 30 s budget.
#
# WHY IT MATTERS BEYOND THIS REPO: on Bitbucket one host call was measured at
# ~10 s against GitHub's 461 ms, so a scan that cannot finish here cannot finish
# there at all. The board serves no rows without a completed pulse — a fresh
# process has no previous one to fall back on — so an over-budget scan is an
# EMPTY Agents tab, not a stale one.
#
# The tab-delimited-string-plus-`case` shape matches `WORKTREES` below and is
# kept for the same reason: no associative arrays, so it must work in POSIX sh.
# `%(objectname)` rides along FREE — the same call, one more field. It is what
# lets the commit walk name a SHA range instead of `origin/<branch>..`, which a
# test at fleet.test.mjs:3138 forbids: a per-branch `git log origin/<branch>` is
# how a worker's timestamp would be read from a remote ref, and that cost lands
# on the population that must stay free. The walk here is a subject/emptiness
# question rather than a timestamp read, but the guard is deliberately broad and
# loosening it to fit this change is how a guard rots.
REMOTE_REFS=$(git for-each-ref --format='%(refname:strip=3)%09%(objectname)' \
  "refs/remotes/origin" </dev/null 2>/dev/null)

# Whether `origin/$1` exists, answered from the batch rather than by spawning.
#
# EXIT STATUS ONLY, matching what `show-ref -q --verify` returned, so every
# caller's `if !` reads identically. An empty `REMOTE_REFS` — a repo with no
# remote, or a `for-each-ref` that failed — makes this false for every branch,
# exactly as a failing `show-ref` did.
remote_ref_exists() { # $1=branch → 0 when origin/$1 is present
  case "
$REMOTE_REFS
" in
    *"
$1	"*) return 0 ;;
  esac
  return 1
}

# The tip SHA of `origin/$1`, from the same batch. Empty when absent.
remote_ref_oid() { # $1=branch → oid, or ""
  printf '%s\n' "$REMOTE_REFS" | awk -F'\t' -v b="$1" '$1==b {print $2; exit}'
}

# EVERY LOCAL HEAD, IN ONE CALL — the same batch shape as REMOTE_REFS, for the
# same reason. `local_ahead_of` (below) asks `refs/remotes/origin/<br>..refs/heads/<br>`
# per branch, and on the population that dominates a real scan — branches living
# on somebody else's machine, with no local `refs/heads/<br>` at all — that
# rev-list exits 128 and answers 0. Measured on this repo in --json mode: 64
# `local_ahead_of` calls, 25 of them against branches with no local head,
# spawning a process to re-derive a zero already knowable from this one call.
#
# ONLY the no-local-head case is gated. A local head that HAS NO UPSTREAM
# (committed, never pushed) still spawns the rev-list — it is a real question
# with a real 128-failure answer, pinned by `a MISSING upstream is detected, not
# read as zero`, and gating it here would answer 0 without ever looking, which
# is the exact accident that test exists to forbid.
LOCAL_HEADS=$(git for-each-ref --format='%(refname:strip=2)' \
  "refs/heads" </dev/null 2>/dev/null)

# Whether `refs/heads/$1` exists locally, from the batch. An empty LOCAL_HEADS —
# a bare repo, or a failed for-each-ref — makes this false for every branch, so
# `local_ahead_of` falls back to spawning and its own 128-handling decides. The
# gate can only ever SKIP a spawn it is certain would answer 0; it never invents
# one.
local_head_exists() { # $1=branch → 0 when refs/heads/$1 is present
  case "
$LOCAL_HEADS
" in
    *"
$1
"*) return 0 ;;
  esac
  return 1
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
  #
  # `--untracked-files=no`, and the omission was a measured defect. `local_dirty`
  # means SOMEBODY IS EDITING THIS WORK, and an untracked path is not that: it is
  # most often a tool's leavings. Measured 2026-08-22 on the project directory —
  # the one checkout that is worked in continuously and therefore accumulates
  # them — `git status --porcelain` reported two entries, `.playwright-mcp/` and
  # `.plot/agents/`, while `--untracked-files=no` reported none. The row for the
  # branch checked out there pulsed the activity mark for hours with nothing
  # being written, which is how it was found.
  #
  # The cost is stated rather than hidden: brand-new work is invisible here
  # until it is staged. That is the right trade for a signal whose whole job is
  # *someone is editing*, because the alternative is a checkout that reads dirty
  # forever from a directory nobody will ever commit — a mark that is always on
  # is a mark that says nothing.
  #
  # It also cleans `wt_changed` below, which derives the freshest mtime from
  # these same paths: a tool writing into `.playwright-mcp/` was moving the
  # *last changed* clock of work nobody had touched.
  if wt_status=$(git -C "$wt_path" status --porcelain --untracked-files=no </dev/null 2>/dev/null); then
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
  # The newest mtime of the real work on the floor, computed HERE because this
  # is where the status output already exists — see `changed_ago_of`, the one
  # consumer, for what the number is for.
  #
  # ONE `git status` PER WORKTREE, AND THIS IS WHERE THAT IS ENFORCED. Asking
  # `plot_worker_dirty` for the file list later would run a SECOND status on the
  # same worktree, and `fleet.test.mjs` counts them ("a locked worktree must be
  # asked ONCE") precisely because a scan the board polls every 5 s cannot pay
  # twice for one answer. Measured by that test rather than by a stopwatch: a
  # timing assertion cannot tell a cheap duplicate call from no duplicate at all.
  #
  # A SCALAR IN THE TABLE, never the file list. `WORKTREES` is a tab-separated
  # string (bash 3.2 on macOS has no associative arrays), and status output
  # carries newlines and arbitrary filenames — a list field would corrupt every
  # row after the first path with a tab in it. An integer cannot.
  wt_changed=""
  if [ -n "${wt_status:-}" ]; then
    wt_dirty_paths=$(plot_worker_dirty_filter "$wt_status")
    if [ -n "$wt_dirty_paths" ]; then
      wt_mtime_args=()
      wt_n=0
      while IFS= read -r wt_f; do
        [ -n "$wt_f" ] || continue
        # `git status --porcelain` renders a rename as `old -> new`; the path
        # that EXISTS is the one after the arrow. Left alone, `stat` is handed a
        # path with no file behind it and silently under-reports.
        case "$wt_f" in *' -> '*) wt_f=${wt_f#* -> } ;; esac
        # Quoted when the path holds a character git chooses to escape. The
        # quotes are git's rendering, not part of the name.
        case "$wt_f" in '"'*'"') wt_f=${wt_f#\"}; wt_f=${wt_f%\"} ;; esac
        wt_mtime_args+=("$wt_path/$wt_f")
        wt_n=$((wt_n + 1))
        [ "$wt_n" -ge "$CHANGED_DIRTY_CAP" ] && break
      done <<< "$wt_dirty_paths"
      [ "${#wt_mtime_args[@]}" -gt 0 ] && wt_changed=$(newest_mtime "${wt_mtime_args[@]}")
    fi
  fi
  WORKTREES+="$wt_branch	$wt_path	$wt_dirty	$wt_locked	$wt_changed"$'\n'
done <<< "$(worktree_rows)"

# The local worktree for a branch as `path<TAB>dirty<TAB>locked`, or empty when
# this machine has none. Absent is ABSENT — never a false, never a path that
# does not exist here.
#
# THREE FIELDS, not the table's five: the newest-dirty-mtime column beside them
# is `changed_ago_of`'s input and no caller of this function has ever wanted it.
# Widening the return would land a timestamp in whatever slot the callers'
# `cut -f` happens to reach next.
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
# THE CLASSIFICATION ITSELF NOW LIVES IN plot-worker-state.sh, sourced above and
# shared with plot-dispatch.sh. It used to live here TWICE — this file carried
# its own copy of the pid read, the `kill -0`, and the exit-code mapping. The
# copies agreed on five of six states and had already drifted apart on the
# sixth. What remains here is `elsewhere` plus the tab-separated rendering the
# JSON consumes.
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
  local br="$1" wt
  wt=$(printf '%s' "$WORKTREES" | awk -F'\t' -v b="$br" '$1==b {print $2; exit}')
  # No worktree here: this machine cannot answer the question at all. Not the
  # same as looking and finding nothing. This is the one state the shared
  # classifier does not produce — it is a question about the worktree LIST,
  # asked before there is any worktree to look inside.
  [ -n "$wt" ] || { printf 'elsewhere\t\t'; return; }
  # Everything below the worktree is the shared classifier's answer, already in
  # the tab-separated shape this function returns. plot-dispatch renders the
  # same facts as prose for `--status`.
  #
  # THE PR FACT TRAVELS AS AN ARGUMENT, computed HERE where the host is already
  # being asked and the answer is already cached. The classifier is called once
  # per branch inside this loop and must not fork a `gh` of its own — and it
  # must not break `--offline`, which promises no network. Both are properties
  # of this caller, not of the classification, so the caller supplies the fact
  # exactly as it supplies `elsewhere` above.
  #
  # `$st` IS NOT THIS FACT. It answers a ref/ancestry question — a branch under
  # review reads `wip` — and `merged` there can come from a merge subject with
  # no PR behind it at all. `reached_review` asks the one question that
  # outranks the local signals: has this work left the worker's hands?
  local pr_fact=""
  reached_review "$br" && pr_fact="pr"
  plot_worker_state "$wt" "$pr_fact"
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
  # NO LOCAL HEAD, NO SPAWN. A branch with no `refs/heads/$1` — the common case,
  # every branch on another machine — makes the rev-list below exit 128 and
  # answer 0. That 0 is already known from the LOCAL_HEADS batch, so the process
  # is not spawned to rediscover it. This skips ONLY the absent-head case; a
  # present head with no upstream still falls through and fails 128 as before,
  # because absent-upstream is a different fact the caller's tests pin.
  local_head_exists "$1" || { printf '0'; return; }
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

# ---------------------------------------------------------------------------
# Conflict prediction: which FILES would collide, not merely whether any would
# ---------------------------------------------------------------------------
#
# `plot-merge-queue.sh` has predicted conflicts since it was written, and it
# asks a yes/no question — `would_conflict()` throws the output away and reads
# the exit code. That is the right question for a merge ORDER and the wrong one
# for a stuck branch: on 2026-08-17 two branches (#176, #177) conflicted in
# exactly one file, the board artifact, whose resolution is mechanical, while a
# third needed a person. A yes/no answer cannot tell those apart.
#
# So the SET is reported and nothing here judges it. Which conflict sets mean
# what is a decision one layer up (Principle 3: scripts collect and report).
#
# `merge-tree --write-tree` computes the merge ENTIRELY IN MEMORY — no working
# tree, no index, no checkout, nothing written. Its output is a tree OID on the
# first line, then the conflicted-file info, then a blank line and the
# human-readable messages. Non-zero exit means the merge would conflict.
#
# THE STAGE-TUPLE FORM IS PARSED, NOT `--name-only`. The flag would be tidier
# and arrived in git 2.40; the tuples have been there since 2.38, which is the
# floor `plot-merge-queue.sh` already checks and states its reasons for. Raising
# the floor for a formatting convenience would make this scan refuse to answer
# on a git the rest of Plot supports — and a scan that cannot answer reports an
# EMPTY set, which reads exactly like "merges cleanly". Same shape, one line of
# `awk`, no new requirement.
#
# ABSENT IS NOT CLEAN, and this is the one place that rule is hard to hold: an
# empty list has to mean both "merges cleanly" and "could not look" unless
# something else distinguishes them. `conflicts_known` is that something — see
# `conflicts_of` — and a consumer that reads the list without it will read every
# unanswerable branch as mergeable.
#
# Only branches with real unlanded work are asked about. A merged branch has
# nothing left to merge, an `open` branch has no ref, and a bare claim CHANGES
# no file — every one of them would cost a process spawn to be told the obvious,
# on every scan. See `conflicts_known_of` for why they report `false` rather
# than a convenient `true`.
# CAN THE QUESTION BE PUT AT ALL? Two prerequisites, both checked ONCE per run
# rather than per branch, and both collapsing to the same honest answer when
# they fail: nothing was observed, so nothing is claimed.
#
#   1. A default branch to merge INTO. Without `origin/$MAIN` there is no
#      target, and a prediction against nothing is not a prediction.
#   2. A git that answers this question. Before 2.38 `merge-tree` EXISTS with
#      entirely different semantics — a three-way file diff — so it does not
#      fail cleanly: it succeeds while answering something else, and every
#      branch would silently read as conflict-free. plot-merge-queue.sh refuses
#      outright on that git; refusing is not an option here (the scan answers
#      many other questions), so the capability is reported as unknown instead.
CONFLICT_MAIN_OK=0
git show-ref -q --verify "refs/remotes/origin/$MAIN" </dev/null 2>/dev/null \
  && CONFLICT_MAIN_OK=1

MERGE_TREE_OK=0
if [ "$CONFLICT_MAIN_OK" = 1 ]; then
  git_ver=$(git --version 2>/dev/null | sed -n 's/^git version \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')
  gv_major=${git_ver%% *}; gv_minor=${git_ver##* }
  if [ -n "$git_ver" ] && { [ "$gv_major" -gt 2 ] \
     || { [ "$gv_major" -eq 2 ] && [ "$gv_minor" -ge 38 ]; }; }; then
    MERGE_TREE_OK=1
  fi
fi

# The files that would collide merging this branch into the default branch, one
# per line — or nothing. Two ways of printing nothing, and they are NOT the same
# statement, which is why `conflicts_known` travels beside the list:
#
#   merges cleanly    → known, empty
#   cannot be asked   → unknown, empty
#
# Sorted and deduplicated: one path appears once per conflicting stage (base,
# ours, theirs), and a set reported three times over is a set nobody can count.
conflicts_of() { # $1=branch → conflicting paths, one per line (may be empty)
  [ "$MERGE_TREE_OK" = 1 ] || return 0
  # Exit 0 means a clean merge and there is nothing to print. Anything the
  # command could not do lands here too, which is exactly why the caller must
  # consult `conflicts_known_of` rather than the emptiness of this output.
  #
  # Each info line is `<mode> <oid> <stage>\t<path>`, and the PATH IS EVERYTHING
  # AFTER THE TAB. Splitting on whitespace and taking the last field would work
  # on every path in this repo and mangle `docs/my notes.md` into `notes.md` —
  # a wrong filename, silently, in exactly the report that decides whether a
  # conflict set is "exactly the artifact".
  git merge-tree --write-tree "origin/$MAIN" "origin/$1" </dev/null 2>/dev/null \
    | awk -F'\t' 'NR == 1 { next }        # the merged tree OID
                  /^$/ { exit }           # the blank line ends the file info
                  NF > 1 { print $2 }' \
    | sort -u
}

# Whether this branch's conflict set was OBSERVED. False is not "clean" — it is
# "not looked at", and the two must never render alike.
conflicts_known_of() { # $1=branch $2=state → true|false
  [ "$MERGE_TREE_OK" = 1 ] || { printf 'false'; return; }
  # Only branches with real unlanded work are asked about — the same candidate
  # rule plot-merge-queue.sh applies, and for the same reason. A merged branch
  # has nothing left to merge, an `open` branch has no ref, and a bare claim is
  # an EMPTY commit: predicting its merge would spend a process to be told the
  # obvious, on every claimed branch, every five seconds.
  #
  # `false` for all of them is the honest answer rather than a convenient one:
  # nobody asked, so nothing is known. Reporting `true` about a question never
  # put is the absent-is-clean mistake pointing the other way — it would license
  # a consumer to read "no conflicts" off a branch nothing was computed for.
  case "$2" in
    wip|claimed) ;;
    *) printf 'false'; return ;;
  esac
  remote_ref_exists "$1" || { printf 'false'; return; }
  # CHANGES of its own, not merely commits of its own. A claim IS a commit —
  # the empty `plot: claim <branch>` push, which is what makes claiming
  # exclusive — so a commit count is non-zero for every claimed branch and would
  # let this gate through unchanged. What distinguishes a claim from work is
  # that it touches no file.
  #
  # The answer for a claim would be "clean" every time, so the cost is a process
  # spawn per claimed branch per five-second scan to be told the obvious. `false`
  # is also the more honest report: nobody asked, so nothing is known — and
  # `true` about a question never put would license a consumer to read "merges
  # cleanly" off a branch carrying nothing to merge.
  [ -n "$(git diff --name-only "origin/$MAIN...origin/$1" </dev/null 2>/dev/null \
    | head -n 1)" ] || { printf 'false'; return; }
  printf 'true'
}

# The files this branch changes relative to the default branch, one per line.
#
# EVIDENCE, never a verdict. It is one of the three lines a CI failure is
# reported with — *this branch changes only .md* — and it exists so a reader can
# weigh a failing step against what the branch actually touched. Nothing here
# maps steps to paths: that mapping is a table nobody maintains, and it goes
# silently wrong the first time a workflow is restructured.
#
# CAPPED, and the cap is REPORTED rather than silently applied — the rule this
# scan already follows for its merge walk. A branch touching two hundred files
# tells the reader nothing they can hold in their head, and shipping two hundred
# strings per row through a 5 s poll is a cost with no matching benefit.
CHANGED_PATHS_LIMIT=${PLOT_CHANGED_PATHS_LIMIT:-40}
changed_paths_of() { # $1=branch → changed paths, one per line (may be empty)
  git diff --name-only "origin/$MAIN...origin/$1" </dev/null 2>/dev/null \
    | head -n "$CHANGED_PATHS_LIMIT"
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


# ---------------------------------------------------------------------------
# When did this branch last CHANGE? — a measurement, and never a verdict
# ---------------------------------------------------------------------------
#
# `local_ahead` and `local_dirty` are STATE, not CHANGE, and that is the whole
# gap this fills. Measured 2026-08-18 across four concurrent workers: the branch
# that had just opened the session's hardest PR read `ahead=0 dirty=False`,
# bit-identical to a branch claimed a minute earlier and abandoned. Commits were
# pushed, so `ahead` was 0; the tree was tidy, so `dirty` was false. Two opposite
# situations, one row.
#
# Runtime cannot separate them either, and that is the measurement this plan was
# written from: of four workers, the LONGEST-RUNNING was the most productive
# (55 min, 4 commits, PR opened) while a 27-minute one had written nothing for
# six. An operator watching the clock would have restarted exactly the wrong one.
#
# THE MAXIMUM OF THREE SOURCES, because work leaves evidence in three places and
# any one alone is silent for long stretches:
#
#   the newest commit          — silent for the whole span BETWEEN commits,
#                                which is precisely the window where a worker is
#                                either deep in a test suite or dead
#   the newest dirty mtime     — silent for a worker that commits tidily and
#                                leaves nothing on the floor
#   the worker log's mtime     — the only one that moves while a build runs
#
# A maximum, never a sum or an average: each source is evidence that work
# happened, and the most RECENT evidence is the answer. A source that cannot be
# read contributes nothing rather than a zero — a fabricated 0 here reads as
# 1970, which is the oldest possible answer and would report every branch as
# maximally quiet the moment one input went missing.
#
# ==> THIS FUNCTION DRAWS NO CONCLUSION, AND THAT IS DELIBERATE. <==
#
# There is no threshold here, no `stalled`, no "probably stuck". "Stuck" depends
# on what the branch is DOING: fifteen minutes of silence is alarming during an
# edit and unremarkable during `test:board`, which takes about that long by
# itself. The threshold belongs to the reader; the measurement belongs here
# (Principle 3 — scripts collect and report).
#
# A FACT MEASURED AFTER THE PLAN WAS WRITTEN, and the reason the paragraph above
# is a warning rather than a preference: a worker deep in a SERIAL test run
# writes no file for minutes at a time while its CHILD PROCESSES do the work.
# This function will report that worker as quiet, and the number will be honest
# — nothing was written. A consumer that renders "quiet for 8 minutes" as
# "stuck" will restart a healthy worker mid-suite and redo everything it had
# done, which is the exact failure the plan measured and costs more than the
# ambiguity it was replacing. The number says how long since a file moved. It
# does not say whether anything is wrong.
#
# ABSENT IS ABSENT — the rule every local signal in this file follows. A branch
# with no worktree on this machine reports nothing at all, exactly as `worker`
# reports `elsewhere` and for the same reason: this machine cannot see it. The
# JSON carries `null`, never 0. A zero would be a fabricated measurement rather
# than a missing one, and it would be the WORST fabrication available here — it
# reads as "changed this instant", the single most reassuring answer, for the
# population nobody can observe.
#
# BRANCHES WITH NO LOCAL WORKTREE COST NOTHING. The worktree lookup is a string
# match against a table already read once per run, and it returns before any
# fork. That is load-bearing rather than incidental: the plan's cost argument
# assumes the fleet's remote branches are skipped entirely, and a `git log`
# spent to learn "elsewhere" would be paid on every branch on every teammate's
# machine, on every poll.
#
# THE PUSHED BRANCH IS DELIBERATELY NOT COVERED — the plan's open point, decided
# here. `git log -1 origin/<branch>` would catch a worker on ANOTHER machine
# moving a ref, and it is declined on two grounds. The cost lands exactly on the
# population that must stay free: a branch with no local worktree is the one
# whose remote ref would be the ONLY source, so the call cannot be skipped for
# precisely the branches the paragraph above skips. And the field would stop
# meaning one thing — every other `local_*` signal answers *what THIS machine
# can see*, and a remote ref is what the REFS say, which the scan already
# reports as `state` and `claimed`. Deferred, not rejected: if the fleet ever
# spans machines in practice, the right shape is a SEPARATE field with its own
# absent value, not a second meaning bolted onto this one.
#

changed_ago_of() { # $1=branch → seconds since the newest evidence of work, or ""
  local br="$1" row wt now newest="" t paths=()
  row=$(printf '%s' "$WORKTREES" | awk -F'\t' -v b="$br" '$1==b {print $2 "\t" $5; exit}')
  # No worktree here: this machine cannot answer, and says so by answering
  # nothing. Before any fork — see the cost note above.
  [ -n "$row" ] || return 1
  wt=$(printf '%s' "$row" | cut -f1)
  [ -n "$wt" ] && [ -d "$wt" ] || return 1

  # 1. The newest commit. A REF QUESTION answered from this repository, the same
  #    distinction `local_ahead_of` draws: worktrees share one ref database, so
  #    `refs/heads/<br>` answers without a `git -C`. `%ct` is the COMMITTER date,
  #    not `%at` the author date — a rebase or an amend rewrites the committer
  #    date and leaves the author date at the original writing, and it is the
  #    rewrite that is the evidence of work here.
  t=$(git log -1 --format=%ct "refs/heads/$br" </dev/null 2>/dev/null)
  case "$t" in ''|*[!0-9]*) ;; *) newest=$t ;; esac

  # 2. The newest mtime of the real work on the floor — READ FROM THE TABLE,
  #    not recomputed. The worktree sweep already ran `git status` once per
  #    worktree and reduced its output to this one number there, applying
  #    `plot_worker_dirty_filter` so the exclusions match `worker_dirty_paths`
  #    exactly: a `.tmp1` that reset this clock while being excluded from that
  #    list would be one file answering two questions two ways.
  #
  #    Asking `plot_worker_dirty` here instead would run a SECOND `git status`
  #    per worktree, which `fleet.test.mjs` counts and rejects — the board polls
  #    this scan every 5 s.
  t=$(printf '%s' "$row" | cut -f2)
  case "$t" in
    ''|*[!0-9]*) ;;
    *) if [ -z "$newest" ] || [ "$t" -gt "$newest" ]; then newest=$t; fi ;;
  esac

  # 3. The worker's log — the only source that keeps moving while a build runs.
  #    Present only where plot-dispatch started the worker itself; absent for
  #    every hand-started one, which is the normal case for as long as `Worker
  #    command` is unset. Absent contributes nothing.
  #
  #    NOT COVERED BY THE TABLE'S NUMBER, deliberately: the sweep's figure comes
  #    from `plot_worker_dirty_filter`, which EXCLUDES Plot's own records
  #    because they are not work on the floor. This asks when anything last
  #    MOVED, and the log is the one file still moving during a build. Two
  #    questions, two right answers about one file — so it is added here.
  #
  #    THE PATH IS ASKED FOR, NEVER SPELLED HERE. What Plot's own records are
  #    called is `plot-worker-state.sh`'s knowledge, and a read-only scan that
  #    names `.plot-worker.` has started classifying workers again — the
  #    duplication removed on 2026-08-18 after the two copies had drifted.
  #    `workerstate.test.mjs` enforces exactly that, and caught this line.
  local log
  if log=$(plot_worker_log "$wt"); then
    t=$(file_mtime "$log")
    case "$t" in
      ''|*[!0-9]*) ;;
      *) if [ -z "$newest" ] || [ "$t" -gt "$newest" ]; then newest=$t; fi ;;
    esac
  fi

  # Every source silent: a worktree with no commit, nothing on the floor and no
  # log. Nothing was OBSERVED, so nothing is claimed — the same answer the
  # absent worktree gives, for the same reason.
  [ -n "$newest" ] || return 1

  now=$(date +%s)
  # Clamped at zero rather than allowed negative. A commit timestamp can sit in
  # the future — a skewed clock, or a rebase carrying a committer date from a
  # machine ahead of this one — and a negative age is not a thing a reader can
  # act on. Zero says "changed just now", which is the honest reading of
  # evidence dated later than the question.
  if [ "$newest" -gt "$now" ]; then printf '0'; else printf '%s' "$((now - newest))"; fi
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

# ---------------------------------------------------------------------------
# Plan enumeration: from the REF, not from the tree
# ---------------------------------------------------------------------------
#
# THE SCAN NAMED A REF AND READ A DIRECTORY. Every fact below is derived from
# `origin/$MAIN` and the banner says so, but the plan list was a filesystem
# glob over `$ACTIVE_DIR` — and `git fetch` updates refs that a glob cannot
# see. Measured in a two-clone sandbox, 2026-08-18:
#
#     origin/main active plans (the REF): 3
#     working tree active plans:          2
#     scan --json reports:                2 plans
#
# The fetch SUCCEEDED. `origin/main` genuinely carried the third plan, pushed
# by a second agent minutes earlier. The scan reported two and exited 0, so
# nothing anywhere could tell that answer from a correct one. The board's plan
# list was only ever as current as the operator's last `git pull`.
#
# It is worse during the fleet run the board exists to watch: rebases,
# checkouts and worker commits rewrite the working tree continuously, so the
# glob can return a different set on each 5 s poll while exiting 0 every time.
# That is the flicker `bug/a-smaller-pulse-is-not-silently-better` guards
# against; this is the cause it guards against the symptom of.
#
# Reading the ref makes the scan describe ONE ATOMIC COMMIT. Two polls of the
# same ref return the same plans no matter what is happening on disk, which is
# what makes the count stable and the banner true.
#
# WORKTREE OBSERVATION STAYS LOCAL, and the split is the whole design:
# `local_dirty`, `local_worktree` and the `.git/index.lock` check describe
# THIS MACHINE on purpose — they are the one place the scan knows more than
# the refs do, and moving them to the ref would delete the signal rather than
# fix it. Plan enumeration comes from the ref; worktree observation is local.
#
# UNCOMMITTED PLANS BECOME INVISIBLE, and that is the intended behaviour rather
# than an accepted cost. The plan's Open Points flagged it: `/plot-idea` writes
# a plan file before committing it. Three reasons it is right:
#   * The fleet view answers "what may a worker CLAIM". Workers are detached
#     agents in other worktrees and on other machines, and not one of them can
#     claim a plan that exists only in the operator's editor buffer. Showing it
#     advertises work nobody can take.
#   * The window is seconds wide. `/plot-idea` commits and pushes in the same
#     flow (see skills/plot-idea/SKILL.md), so an uncommitted plan is a state
#     inside one skill run, not a state anyone opens a board to watch.
#   * A board that mixes shared state with one machine's scratch is the bug
#     this file keeps fixing. `local_dirty` exists precisely so local facts
#     travel LABELLED as local; an unlabelled local plan row is the thing that
#     makes an operator trust a view that only they can see.
#
# The rule is: committed is shared, and the fleet view shows what is shared.
#
# WHEN THE REF CANNOT BE READ the scan falls back to the working tree and says
# so. A fresh clone with no remote, a repo whose origin is unreachable and
# whose refs were never fetched — for these `origin/$MAIN` names nothing, and
# an empty plan list would be a confident lie in the one case where the
# operator has no way to check it. Falling back is honest; falling back
# SILENTLY would recreate this bug, so `plan_source` travels in --json.
PLAN_SOURCE="ref"
git rev-parse --verify --quiet "origin/$MAIN^{commit}" >/dev/null 2>&1 || PLAN_SOURCE="worktree"

# Paths in the ref, listed for one directory. Returns the blob paths as they
# are spelled in the tree, so `$ACTIVE_DIR` prefixes survive into the loop that
# pattern-matches on `$DELIVERED_DIR` below.
#
# `-z` and a NUL-delimited read: a path is user data, and a plan filename
# containing a newline would otherwise split into two nonexistent plans.
ref_ls() { # $1=dir → newline-separated paths under it in origin/$MAIN
  git ls-tree -z --name-only "origin/$MAIN" -- "$1" </dev/null 2>/dev/null \
    | tr '\0' '\n' | grep '\.md$' || true
}

# The content of a ref path, materialized where plot-plan-meta.sh can parse it.
#
# THE PARSER TAKES FILES, not stdin: it is an awk pass keyed on FILENAME and it
# checks `[ -f "$1" ]`. Rather than reshape the format contract from here — the
# one script allowed to know what a plan looks like — the blob is written to a
# temp file. The parser is unchanged, so the contract tests still describe it.
#
# SYMLINKS ARE RESOLVED IN REF-SPACE, and this is the subtlety the whole block
# turns on. `$ACTIVE_DIR` holds symlinks into `$PLAN_DIR`, and in a git tree a
# symlink is a mode-120000 blob whose CONTENT IS THE TARGET PATH. `readlink`
# would answer from the working tree — the exact thing being moved away from —
# so the link is followed with a second `git show` against the same ref. One
# hop only: plot's indexes are links to files, never chains, and a bounded walk
# beats a loop detector for a shape that cannot nest.
# CREATED ONCE, EAGERLY, and that is a correction rather than a style choice:
# `ref_plan_file` is called as `$(ref_plan_file ...)`, which runs it in a
# SUBSHELL. A lazy `[ -z "$REF_TMP" ] && REF_TMP=$(mktemp -d)` inside it
# assigns in the child and the parent never sees it — so every call made a
# fresh directory, the parent's variable stayed empty, and the EXIT trap
# cleaned nothing. Measured while writing this: three plans, three temp dirs,
# none removed. The lifetime is owned out here, where the trap can see it.
REF_TMP=""
if [ "$PLAN_SOURCE" = "ref" ]; then
  REF_TMP=$(mktemp -d "${TMPDIR:-/tmp}/plot-fleet-ref.XXXXXX") || REF_TMP=""
  # The scan is read-only and short-lived, and the board polls it every 5 s —
  # a directory that outlives the run would accumulate one per poll.
  [ -n "$REF_TMP" ] && trap 'rm -rf "$REF_TMP"' EXIT INT TERM
  # No temp dir means no way to hand the parser a file, so the ref path cannot
  # work. Falling back to the checkout is the honest answer, and it announces
  # itself through `plan_source` exactly like an unreadable ref.
  [ -n "$REF_TMP" ] || PLAN_SOURCE="worktree"
fi

# EVERY PLAN PATH'S MODE, IN ONE CALL — see `REMOTE_REFS` for the measurement.
#
# `ref_plan_file` asked `git ls-tree` once per plan for a single field: the file
# MODE, which is how a symlink (120000) is told from a regular file. Profiled
# 2026-08-20 that was 69 spawns of the scan's 459, and unlike `show-ref` these
# are not cheap — reading a tree out of a packfile is real work.
#
# `ls-tree -r` over the plan directories answers for every path at once: 134
# entries in 512 ms here, against 69 separate spawns at 31-56 ms of launch
# overhead EACH before any work happens.
#
# Scoped to the two directories plot keeps plans in rather than the whole tree,
# because that is all `ref_plan_file` is ever asked about, and an unbounded
# `ls-tree -r` on a large repo would trade one cost for another.
PLAN_MODES=$(git ls-tree -r "origin/$MAIN" \
  -- "$PLAN_DIR" "$ACTIVE_DIR" </dev/null 2>/dev/null)

# The mode of $1 in the ref, from the batch. Empty when the path is not there,
# which is what a failed per-path `ls-tree` also produced.
ref_mode_of() { # $1=path → mode digits, or ""
  printf '%s\n' "$PLAN_MODES" | awk -v p="$1" '
    { path = $0; sub(/^[^\t]*\t/, "", path) }
    path == p { print $1; exit }'
}

# EVERY PLAN BLOB, WRITTEN IN ONE PROCESS.
#
# `ref_plan_file` handed the parser a temp file per plan, fetched with its own
# `git show`. MEASURED 2026-08-20: one such `show` cost 407-621 ms — variable
# because several worktrees were hitting one object store — and there were 68 of
# them: ~31 s for a single call site, against a 30 s budget. `cat-file --batch`
# read NINETEEN blobs in 559 ms, so reading EVERY plan costs about what reading
# one did.
#
# THE FRAMING IS BY BYTE COUNT, NOT BY PATTERN, and that is the whole reason
# this is perl rather than awk. `--batch` emits `<oid> blob <size>` then exactly
# `<size>` bytes then a newline; a plan containing a line shaped like
# `deadbeef blob 42` would desynchronise any split that looks for the header
# instead of counting. Two earlier attempts here did exactly that — one wrote
# nothing at all, silently, and every plan fell through to the per-plan `show`
# with the spawn count unchanged. The count is read from the header and honoured.
#
# Only REGULAR files are written. A symlink's blob is its target path rather than
# a plan, and resolving it needs the link followed first — `ref_plan_file` still
# does that, then finds the resolved target already here.
#
# Failure is silent BY DESIGN: an unwritten file misses the cache in
# `ref_plan_file` and takes the per-plan `git show` exactly as before. This is a
# cache, so it may only save work, never change an answer.
if [ -n "$REF_TMP" ] && [ -n "$PLAN_MODES" ] && command -v perl >/dev/null 2>&1; then
  printf '%s\n' "$PLAN_MODES" | awk -F'\t' '
    $0 ~ /^100644 / { name = $2; sub(/.*\//, "", name)
                      split($1, h, " "); print h[3] "\t" name }' \
    > "$REF_TMP/.manifest" 2>/dev/null
  if [ -s "$REF_TMP/.manifest" ]; then
    awk -F'\t' '{print $1}' "$REF_TMP/.manifest" \
      | git cat-file --batch </dev/stdin 2>/dev/null \
      | perl -e '
          my (%name, $dir); $dir = $ARGV[0];
          open(my $m, "<", "$dir/.manifest") or exit 0;
          while (<$m>) { chomp; my ($o, $n) = split(/\t/); $name{$o} = $n if $n }
          close $m; binmode STDIN;
          while (my $hdr = <STDIN>) {
            chomp $hdr;
            my ($oid, $type, $size) = split(/ /, $hdr);
            last unless defined $size && $size =~ /^[0-9]+$/;
            my ($buf, $nl); read(STDIN, $buf, $size); read(STDIN, $nl, 1);
            next unless $type eq "blob" && $name{$oid};
            open(my $fh, ">", "$dir/$name{$oid}") or next;
            binmode $fh; print $fh $buf; close $fh;
          }' "$REF_TMP" 2>/dev/null
  fi
fi

ref_plan_file() { # $1=path in ref → temp file path, or "" when unreadable
  local p="$1" mode target content out
  mode=$(ref_mode_of "$p")
  # A path the batch does not carry may still exist — the batch is scoped to the
  # plan directories, and a symlink can point outside them. Asked directly only
  # then, so the fallback costs one spawn for a case that does not arise here
  # rather than one per plan for the case that always does.
  [ -n "$mode" ] || mode=$(git ls-tree "origin/$MAIN" -- "$p" </dev/null 2>/dev/null | awk '{print $1; exit}')
  if [ "$mode" = "120000" ]; then
    target=$(git show "origin/$MAIN:$p" </dev/null 2>/dev/null) || return 1
    [ -n "$target" ] || return 1
    case "$target" in
      /*)
        # AN ABSOLUTE TARGET IS NOT A PATH IN THE TREE. `ln -s "$(pwd)/…"`
        # stores `/home/runner/work/…` in the blob, and a repository has no
        # such directory — prefixing it with the link's dirname produces a path
        # that resolves to nothing, which is how this first showed up: three
        # board suites went from 104 passing to 93, every failure a plan that
        # had silently vanished from the pulse.
        #
        # Only the BASENAME can be trusted, and only inside `$PLAN_DIR`. That
        # is not a guess about where the plan is: an absolute link is
        # machine-specific by construction, so its directory half describes a
        # filesystem this scan may not be running on, while plot keeps every
        # plan in one directory by config. Resolving there is the only reading
        # that can be right on another machine.
        p="$PLAN_DIR$(basename "$target")" ;;
      *)
        # Resolved against the LINK's directory, the same way the filesystem
        # would resolve a relative link.
        p=$(printf '%s' "$(dirname "$p")/$target" | sed 's#/\./#/#g')
        # Collapse `a/b/../c` → `a/c` so the result is a path the tree can name.
        while printf '%s' "$p" | grep -q '[^/][^/]*/\.\./'; do
          p=$(printf '%s' "$p" | sed 's#[^/][^/]*/\.\./##')
        done ;;
    esac
  fi
  # ALREADY MATERIALISED? The batch below wrote every plan blob in the plan
  # directory into `$REF_TMP` in ONE process. A hit here costs no git at all.
  #
  # THE MEASUREMENT that made this the change worth making, 2026-08-20: one
  # `git show` of a plan blob cost 407-621 ms — variable because four worktrees
  # were hitting one object store — while `cat-file --batch` read NINETEEN
  # blobs in 559 ms, in a single process. Reading every plan therefore costs
  # about what reading one did, and 68 `show` spawns were ~31 s of the scan on
  # their own: over the whole 30 s budget for that one call site.
  if [ -n "$REF_TMP" ] && [ -f "$REF_TMP/$(basename "$p")" ]; then
    printf '%s' "$REF_TMP/$(basename "$p")"
    return 0
  fi
  content=$(git show "origin/$MAIN:$p" </dev/null 2>/dev/null) || return 1
  [ -n "$content" ] || return 1
  [ -n "$REF_TMP" ] || return 1
  # Named after the RESOLVED path so the basename the report prints is the
  # plan's own filename, matching what the worktree enumeration produced.
  out="$REF_TMP/$(basename "$p")"
  printf '%s\n' "$content" > "$out" 2>/dev/null || return 1
  printf '%s' "$out"
}

# Resolve which plans to report on.
#
# TWO PARALLEL ARRAYS, because a plan now has two paths that must not be
# confused. `plans` keeps the path AS THE REF SPELLS IT — that is the plan's
# identity, and it is what the reader sees. `plan_reads` holds the file to
# PARSE, which in ref mode is a temp file holding the blob. In worktree mode
# the two are equal, so every consumer below reads the same way in both modes.
plans=()
plan_reads=()
# The declared phase of each plan, filled during enumeration and indexed
# alongside `plans`. It is read where the delivered window used to test the
# path prefix — see "the group is the phase" below.
plan_phases=()

# Add one plan by its ref path, materializing the blob. A path that cannot be
# read is SKIPPED rather than guessed at — a dangling index entry is a
# bookkeeping fault plot-reconcile-scan.sh reports, and inventing a row for it
# here would hide the fault behind a plausible-looking plan.
add_ref_plan() { # $1=path in ref
  local f
  f=$(ref_plan_file "$1") || return 0
  [ -n "$f" ] || return 0
  plans+=("$1")
  plan_reads+=("$f")
}

# ---------------------------------------------------------------------------
# What makes a file a plan
# ---------------------------------------------------------------------------
#
# A `.md` file directly in `$PLAN_DIR` whose PHASE PARSES — `phase` is anything
# other than `NONE`. Nothing else qualifies, and the rule is the parser's own
# answer rather than a second opinion about it: plot-plan-meta.sh is the format
# contract (Manifesto Principle 3), so a scan that grepped for `Phase:` itself
# would be a second implementation of the format, free to disagree with the
# first.
#
# THIS HAD TO BE DECIDED rather than inherited. The old enumeration globbed
# `$ACTIVE_DIR`, and the symlinks there happen to point only at plans — so
# non-plans were excluded BY ACCIDENT, as a side effect of nobody having linked
# them. Measured in this repo 2026-08-19: 64 `.md` files in `$PLAN_DIR`, of
# which 62 are plans and two are notes that carry no `Phase:` field at all
# (`2026-08-18-the-repair-exists-report.md`, `kanban-board-v1-open-questions.md`).
# Enumerating the directory without a rule would report both as phase-less
# plans with no branches — trading a list that is wrongly short for one that is
# wrongly long.
#
# `UNKNOWN` COUNTS AS A PLAN, and that direction is deliberate. `UNKNOWN` means
# the file declared a phase whose value the parser did not recognise — a typo,
# or a phase word this version predates. That is a plan with a bad field, and
# the whole point of this change is that a plan cannot be simultaneously valid
# and invisible; hiding it for a misspelling would rebuild the failure one
# level down, where it is harder to see than a missing symlink was. `NONE` is
# the different case: no field at all, so nothing claimed to be a plan.
#
# `$PLAN_DIR` IS READ NON-RECURSIVELY, which is what keeps the index
# directories out of the list. `$ACTIVE_DIR` and `$DELIVERED_DIR` live inside
# `$PLAN_DIR` by default, and their symlinks resolve to files already
# enumerated — counting both would double every plan. `git ls-tree` without
# `-r` lists one level, and the worktree glob `"$PLAN_DIR"*.md` does not
# descend either.
is_plan_phase() { # $1=normalized phase → 0 when this file is a plan
  case "$1" in
    ""|NONE) return 1 ;;
    *) return 0 ;;
  esac
}

# The phase a file declares, or "" when it is not a plan. One parse, whose
# result is kept: the plan loop below needs the phase anyway, so enumerating by
# phase costs nothing that was not already going to be spent.
plan_phase_of() { # $1=file to parse → normalized phase on stdout
  "$script_dir/plot-plan-meta.sh" "$1" --prefixes "$PREFIX_RE" 2>/dev/null \
    | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("phase", ""))
except Exception:
    print("")
' 2>/dev/null || printf ''
}

# A terminal phase belongs to the delivered group: the plan is finished, and it
# appears only while its `Delivered:` record is inside the rolling window.
#
# `rejected` and `superseded` are terminal too, and they route here for the
# same reason `/plot-deliver` files them under `$DELIVERED_DIR` (issue #33):
# they are outcomes, not work. A worker may claim nothing under any of the
# four.
is_terminal_phase() { # $1=normalized phase → 0 when finished
  case "$1" in
    delivered|released|rejected|superseded) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -n "$slug" ]; then
  # A NAMED SLUG IS NOT A LIST, so it keeps its own resolution: the caller
  # already said which plan it means, and the phase rule would only be able to
  # refuse the answer. `$ACTIVE_DIR`/`$DELIVERED_DIR` stay in the search path
  # because a slug is the one place their stable, undated names are the
  # QUESTION — `plot-fleet-scan.sh plot-sprint-support` names a symlink, not a
  # dated file, and every caller that passes a slug got it from one.
  if [ "$PLAN_SOURCE" = "ref" ]; then
    # Same precedence as the worktree form: the dated plan file first, then the
    # active index, then delivered. `ref_ls` is filtered rather than globbed
    # because the ref has no shell to expand `*`.
    found=0
    for cand in $(ref_ls "$PLAN_DIR" | grep "$slug\.md$") \
                $(ref_ls "$ACTIVE_DIR" | grep "/$slug\.md$") \
                $(ref_ls "$DELIVERED_DIR" | grep "/$slug\.md$"); do
      add_ref_plan "$cand"
      [ ${#plans[@]} -gt 0 ] && { found=1; break; }
    done
    [ "$found" = 1 ] || true
  else
    for cand in "$PLAN_DIR"*"$slug".md "$ACTIVE_DIR$slug.md" "$DELIVERED_DIR$slug.md"; do
      [ -e "$cand" ] && {
        plans+=("$(cd "$(dirname "$cand")" && pwd)/$(basename "$cand")")
        plan_reads+=("${plans[${#plans[@]}-1]}")
        break
      }
    done
  fi
  # The named plan's phase, recorded the same way the enumerated ones are so
  # the loop below reads one array in both paths.
  [ ${#plans[@]} -gt 0 ] && plan_phases+=("$(plan_phase_of "${plan_reads[0]}")")
else
  # ---------------------------------------------------------------------------
  # THE GROUP IS THE PHASE, not the symlink
  # ---------------------------------------------------------------------------
  #
  # The list came from a glob over `$ACTIVE_DIR` plus one over `$DELIVERED_DIR`,
  # so a plan was visible because a LINK existed and grouped by WHICH directory
  # held the link. Both facts are hand-maintained copies of something the plan
  # already says about itself, and a copy maintained by hand disagrees with its
  # original the moment somebody forgets.
  #
  # Measured 2026-08-18: an agent wrote a plan file directly rather than through
  # `/plot-idea`. It parsed `canonical`, carried `Phase: Approved`, named three
  # branches in two waves and sat on `origin/main` — and every unscoped scan
  # reported 12 plans without it. Two agents were already working its branches.
  # The failure is silent in the direction that matters: the scan does not say
  # "one plan is unindexed", it says nothing at all and its footer count is
  # simply lower than reality. Nothing in the output distinguishes *this plan
  # does not exist* from *this plan is not indexed*, which is why it was
  # misdiagnosed three times as a board defect before anyone looked at the index.
  #
  # So the plan directory is enumerated and each file is grouped by the phase it
  # DECLARES. `$ACTIVE_DIR` keeps working and keeps being written — this change
  # only stops anything DEPENDING on it being right. A stale link is now inert
  # in both directions: an unlinked Approved plan appears, and a link pointing
  # at a delivered plan cannot resurrect it, because neither link is consulted.
  #
  # COST, measured on this repo 2026-08-19 rather than assumed: 64 plans parse
  # in 371 ms, ~5.8 ms each, against a full scan this file's own comments record
  # at 500–1050 ms (18.3 s with the host round trips). The plan's fixture
  # measurement puts the worst realistic case at ~300 ms extra for 1000 plans,
  # a scale no Plot repo has reached, behind the board's 5 s cache.
  #
  # The delivered mtime PRE-FILTER is gone with the directory it read, and it
  # was buying less than it appeared to: it keyed off the `$DELIVERED_DIR`
  # symlink's mtime, and a fresh checkout stamps every symlink at once — 56 of
  # 56 delivered links admitted here, so the parse it was meant to avoid was
  # already being paid in full. `delivered_in_window` (the `Delivered:` record)
  # was always the filter that actually decided, and the pre-filter's own
  # contract was that it may only ever OVER-admit. Removing it takes that
  # contract to its limit — strictly more correct, and on this repo not even
  # more expensive.
  #
  # ORDER IS PRESERVED: active plans first, in enumeration order, with the
  # terminal ones appended. A reader's list must not reshuffle when something is
  # delivered, and it is the same order the two globs produced before.
  #
  # --next and --list-eligible skip the terminal group entirely rather than
  # filter it later. Their question is "what may a worker claim", and a finished
  # plan answers nothing to it: even an `open` branch under one is work somebody
  # decided was not needed. Naming one would send a dispatcher at finished work.
  terminal_plans=()
  terminal_reads=()
  terminal_phases=()

  # One enumeration, two groups. `add_plan_by_phase` parses once and files the
  # result, so no path below asks the format contract the same question twice.
  add_plan_by_phase() { # $1=identity path, $2=file to parse
    local id="$1" src="$2" ph
    ph=$(plan_phase_of "$src")
    is_plan_phase "$ph" || return 0
    if is_terminal_phase "$ph"; then
      [ "$next_only" = 1 ] && return 0
      terminal_plans+=("$id")
      terminal_reads+=("$src")
      terminal_phases+=("$ph")
    else
      plans+=("$id")
      plan_reads+=("$src")
      plan_phases+=("$ph")
    fi
  }

  if [ "$PLAN_SOURCE" = "ref" ]; then
    while IFS= read -r plan_path; do
      [ -n "$plan_path" ] || continue
      # `ref_plan_file` rather than `add_ref_plan`: the phase decides the group,
      # so the blob must be materialized before anything is appended.
      plan_blob=$(ref_plan_file "$plan_path") || continue
      [ -n "$plan_blob" ] || continue
      add_plan_by_phase "$plan_path" "$plan_blob"
    done <<< "$(ref_ls "$PLAN_DIR")"
  else
    for plan_path in "$PLAN_DIR"*.md; do
      [ -e "$plan_path" ] || continue
      add_plan_by_phase "$plan_path" "$plan_path"
    done
  fi

  for i in "${!terminal_plans[@]}"; do
    plans+=("${terminal_plans[$i]}")
    plan_reads+=("${terminal_reads[$i]}")
    plan_phases+=("${terminal_phases[$i]}")
  done
fi

if [ ${#plans[@]} -eq 0 ]; then
  # --next/--list-eligible must stay silent and exit 1: "nothing to start" is
  # the same answer whether the plans are all claimed or there are no plans at
  # all. Exiting 0 here would hand a caller an EMPTY branch name as if it were
  # valid work.
  [ "$next_only" = 1 ] && exit 1
  # Names the directory that was actually READ. It named `$ACTIVE_DIR` while
  # the scan globbed it; pointing a reader at the index would now send them to
  # look for the cause of an empty list in a directory nothing consults.
  echo "No plans found in ${PLAN_DIR}."
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
# ONE `git log` PER BRANCH, NOT THREE SPAWNS PER COMMIT.
#
# THE MEASUREMENT, 2026-08-20: this loop was the largest single spawn source in
# the scan. Per commit it ran `git log -1` for the subject and, for a
# claim-titled one, two `git rev-parse` for the two trees. `rev-parse` was the
# top per-branch call in the profile (14 for a single plan) and it all came from
# here.
#
# `--shortstat` COLLAPSES THE TREE COMPARISON INTO THE SAME WALK. An empty
# commit produces NO stat line, a commit with changes produces one — which is
# exactly `tree == parent tree`, asked once for the whole range instead of twice
# per commit. Verified against a real claim on this repo: the
# `plot: claim feature/...` commit prints no stat line, its sibling prints
# `1 file changed, 111 insertions(+)`.
#
# THE TEST IS UNCHANGED, AND MUST STAY SO: a claim marker is titled
# `plot: claim ...` AND empty. Both, or it counts as real work — a human commit
# titled "plot: claim handling refactor" carrying real files must still count,
# because with a `deferred:` annotation the reaper would otherwise offer to
# DELETE real work. This changes where the two facts come from, never what they
# decide.
#
# A commit whose stat cannot be read counts as REAL, matching the old code's
# behaviour when `rev-parse` failed: an unreadable tree is not evidence of
# emptiness.
# ONE WALK, BOTH COUNTS — `<total> <real>` on stdout.
#
# `branch_state` asked `git rev-list --count "origin/$MAIN..origin/$br"` for the
# TOTAL and then called this for the REAL count, which walks the SAME range with
# `git log`. Two spawns for one question, once per branch: 64 `rev-list` calls
# measured on this repo 2026-08-20, the last per-branch block after #262 batched
# the plan reads.
#
# The walk already visits every commit to classify it, so the total is a counter
# it was throwing away. `ahead-behind` in `for-each-ref` would answer this
# repo-wide in one call and needs git 2.41; 2.39 is what ships with macOS, so
# that is not available here.
#
# BOTH NUMBERS FROM ONE READING keeps them consistent by construction: a total
# and a real count taken from two walks could disagree if a ref moved between
# them, and the caller compares the two.
real_commits_beyond_main() { # $1=branch → "<total> <real>"
  local br="$1" n=0 total=0 line subj pending=0 _rcb_base _rcb_tip
  # NAMED AS SHAS, NOT AS REFS — see `REMOTE_REFS` for why. Both come from the
  # batch already in hand, so this costs no extra process.
  _rcb_base=$(remote_ref_oid "$MAIN")
  _rcb_tip=$(remote_ref_oid "$br")
  [ -n "$_rcb_base" ] && [ -n "$_rcb_tip" ] || { echo "0 0"; return; }
  # Records are `<sha>\t<subject>`, each optionally followed by a blank line and
  # a ` N files changed, ...` line. `pending` holds whether the record just read
  # is claim-titled and still waiting to learn if it was empty.
  while IFS= read -r line; do
    case "$line" in
      '')  continue ;;
      *' file changed,'*|*' files changed,'*)
        # A stat line: the record before it had changes, so it is real work even
        # if it was claim-titled.
        [ "$pending" = 1 ] && { n=$((n + 1)); pending=0; }
        continue ;;
    esac
    # A new record. Anything still pending was claim-titled AND produced no stat
    # line — an empty claim marker, which does not count.
    pending=0
    # EVERY RECORD IS ONE COMMIT, which is what the separate `rev-list --count`
    # was spawned to learn. Counted here, it costs nothing.
    total=$((total + 1))
    subj=${line#*"$(printf '\t')"}
    case "$subj" in
      "plot: claim "*) pending=1 ;;
      *) n=$((n + 1)) ;;
    esac
  done <<EOF
$(git log --format="%H%x09%s" --shortstat "$_rcb_base..$_rcb_tip" </dev/null 2>/dev/null)
EOF
  echo "$total $n"
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
  if ! remote_ref_exists "$br"; then
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
    # No merge commit names it — which is the ordinary case under a squash
    # merge, not an exotic one. The local walk is now out of evidence, so the
    # host is asked. It may only ever move this branch from `open` to `merged`:
    # a miss, a CLOSED PR, or a host that cannot answer all fall through to the
    # `open` below, exactly as before this call existed.
    merged_by_host "$br" && { echo "merged"; return; }
    echo "open"; return
  fi
  # A CLAIM is a branch whose only commits beyond main are claim commits —
  # empty markers a dispatcher pushed to take the work. They must be real
  # commits, not a bare pointer at main: two branches pointing at the same
  # commit do not diverge, so the second push would succeed and both sides
  # would think they held the claim (see plot-dispatch.sh, "THE CLAIM").
  # ONE WALK ANSWERS BOTH. See `real_commits_beyond_main` for the measurement:
  # the separate `rev-list --count` here asked for a number that walk was
  # already computing and discarding, at one extra spawn per branch.
  local _bs_counts
  _bs_counts=$(real_commits_beyond_main "$br")
  ahead=${_bs_counts%% *}
  real=${_bs_counts##* }
  if [ "${ahead:-0}" -gt 0 ]; then
    [ "${real:-0}" = "0" ] && { echo "claimed"; return; }
    # Real work that main does not yet contain: `wip`, and ONLY `wip`.
    #
    # This arm once asked `merge-base --is-ancestor origin/$br origin/$MAIN`
    # here — "has the work already landed?" — and returned `merged` when it did.
    # That question was already answered by the `ahead` count above it and could
    # never fire: `ahead > 0` means `$br` carries at least one commit unreachable
    # from `$MAIN`, and a branch with such a commit CANNOT be an ancestor of
    # `$MAIN`, so `--is-ancestor` was false on every branch that reached it. It
    # was one git spawn per `wip` branch spent to re-derive a fact already in
    # hand — the per-branch tail this plan set out to thin — and its `merged`
    # was dead code that changed no verdict.
    #
    # The landed-work case is not lost; it is answered ONE LEVEL UP. A branch
    # whose commits are all in `$MAIN` counts `ahead = 0` and falls through to
    # the `merged` below, and a merge that deleted the ref never reaches here at
    # all (the no-ref arm returns first). If a future change makes `ahead`
    # something other than "commits `$MAIN` lacks", THIS is the invariant that
    # would break — the ancestry must move back, not be missed.
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
# The ref this scan READ, and the ref the operator is STANDING ON. They are
# different questions, and conflating them is the bug this block exists to
# stop: every fact below is derived from `origin/$MAIN`, but the banner was
# built from local `HEAD`. On `main` right after a fetch the two agree, which
# is exactly why it survived — the common case made it look correct.
#
# When `origin/$MAIN` cannot be resolved (no remote, fresh clone) the ref is
# reported as unknown. It does NOT fall back to `HEAD`: that would reintroduce
# this bug in the one case where nothing can catch it, and a banner that says
# "unknown" gets investigated in seconds where a real-looking SHA gets believed.
READ_REF=$(git rev-parse --short "origin/$MAIN" 2>/dev/null) || READ_REF=""
[ -n "$READ_REF" ] || READ_REF="unknown"
LOCAL_HEAD=$(git rev-parse --short HEAD 2>/dev/null) || LOCAL_HEAD=""
[ -n "$LOCAL_HEAD" ] || LOCAL_HEAD="unknown"
# Kept as an alias for one release: the board reads `head` today (Agents tab),
# and renaming a field out from under a live consumer is a break nobody asked
# for. Removed once the board reads `read_ref`.
HEAD_SHORT="$LOCAL_HEAD"
json_plans=""

# Emit a JSON string with the six characters JSON forbids escaped. Branch names
# and claim notes are user data: a plan may legitimately carry a quote or a
# backslash, and an unescaped one would produce a document nothing can parse.
json_str() {
  printf '%s' "$1" | LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    -e 's/\t/\\t/g' -e 's/\r/\\r/g' -e 's/\x08/\\b/g' -e 's/\x0c/\\f/g'
}

# A newline-separated list as a JSON array of strings — `[]` for nothing.
#
# Each element goes through `json_str`, for the reason `json_str` itself exists:
# a path is user data, and one legitimate quote in a filename would otherwise
# produce a document nothing can parse. Blank lines are dropped, because a
# trailing newline is punctuation rather than an empty path.
json_array() {
  local out="" line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    out+="${out:+,}\"$(json_str "$line")\""
  done <<< "$1"
  printf '[%s]' "$out"
}

if [ "$next_only" != 1 ] && [ "$as_json" != 1 ]; then
  banner="plot-fleet pulse — $READ_REF on origin/$MAIN"
  # The local checkout and the ref this report was derived from disagree. That
  # is worth one clause: the operator is looking at a tree this report does not
  # describe. `behind` is how many commits of `origin/$MAIN` the checkout has
  # not got — empty when the two share no ancestry to count across.
  if [ "$READ_REF" != "unknown" ] && [ "$LOCAL_HEAD" != "$READ_REF" ]; then
    behind=$(git rev-list --count "HEAD..origin/$MAIN" 2>/dev/null) || behind=""
    # POINTS AT THE REPORT, NOT THE TREE. The measured failure was operators
    # believing a stale report, so the clause has to say what this report
    # describes — "your checkout is behind" is advice about the tree, and an
    # operator who reads it still has no reason to doubt the numbers below.
    #
    # The count is included only when git could compute it. `behind` counts
    # commits on origin/$MAIN the checkout lacks; on a diverged feature branch
    # that is true but partial, so the SHA leads and the count trails as a
    # parenthetical rather than being the claim.
    if [ -n "$behind" ] && [ "$behind" != 0 ]; then
      banner="$banner (not your checkout $LOCAL_HEAD, $behind behind)"
    else
      banner="$banner (not your checkout $LOCAL_HEAD)"
    fi
  fi
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

plan_idx=-1
for plan in "${plans[@]}"; do
  # `plan` is the plan's IDENTITY (the path as the ref or the tree spells it);
  # `plan_read` is the file to PARSE. They differ only in ref mode, where the
  # second is a materialized blob — see "Plan enumeration" above.
  plan_idx=$((plan_idx + 1))
  plan_read="${plan_reads[$plan_idx]}"
  # Per-plan reset. State that survives into the next iteration is how the
  # plan parser once leaked a `## Branches` flag across files — same shape of
  # bug, so the accumulator is cleared where the plan loop begins.
  json_waves=""
  meta=$("$script_dir/plot-plan-meta.sh" "$plan_read" --prefixes "$PREFIX_RE" 2>/dev/null) || continue
  [ -n "$meta" ] || continue

  # The plan's own phase, carried onto the pulse so a consumer can derive a row
  # phase from the PAIR — plan state AND branch git state. It is reported, never
  # interpreted: this script collects and reports, and which column a row reads
  # is a judgment that belongs one layer up (Manifesto Principle 3).
  plan_phase=$(printf '%s' "$meta" | python3 -c '
import json, sys
print(json.load(sys.stdin).get("phase", ""))
' 2>/dev/null) || plan_phase=""

  # The delivered window, applied to the plans the PHASE put in the terminal
  # group. Enumeration grouped them; the `Delivered:` RECORD decides which of
  # them still appears.
  #
  # THE TEST IS THE PHASE, not the path. It read `case "$plan" in "$DELIVERED_DIR"*)`
  # — the directory the link sat in — and that made "which group is this plan
  # in" a fact about a symlink while "what phase is it" was a fact about the
  # file. The old comment here noted that an active plan carrying
  # `Phase: Delivered` was drift the window must not hide; under the phase rule
  # that drift cannot be constructed, because there is no second place for the
  # answer to live. One source, so nothing to disagree.
  #
  # Two exits, and both matter:
  #   * the record's date has aged out of the window — ordinary expiry;
  #   * there is NO record — "no date, no row". `reconcile-scan-accuracy.md` is
  #     the live example; showing it would create the one row that can never
  #     age out of DONE.
  # Both leave before a single git call is spent on the plan's branches.
  if is_terminal_phase "$plan_phase"; then
    delivered_in_window "$meta" || continue
  fi

  n_plans=$((n_plans + 1))
  plan_target=$(readlink "$plan" 2>/dev/null && echo "" || true)

  # The plan's DISPLAY NAME: the dated filename, never an index alias.
  #
  # Unscoped enumeration now names `$PLAN_DIR` files directly, so the basename
  # is already the dated name and the `readlink` is a no-op that falls through
  # to `$plan`. It stays because a NAMED SLUG can still resolve to a symlink in
  # `$ACTIVE_DIR`/`$DELIVERED_DIR` (see "a named slug is not a list"), and that
  # path must keep printing the plan's own filename rather than the alias the
  # caller typed.
  #
  # In ref mode the resolution already happened in ref-space and the temp file
  # was named after its result, so its basename IS the answer — `readlink`
  # would ask the working tree, which the ref enumeration stopped doing.
  if [ "$PLAN_SOURCE" = "ref" ]; then
    plan_base=$(basename "$plan_read")
  else
    plan_base=$(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")")
  fi

  # --log-pulse WRITES, so it needs a path in the working tree — a pulse line
  # appended to a materialized blob would be discarded with the temp dir, and a
  # ref is not writable in the first place. Enumeration moved to the ref; the
  # one write this script performs stays where a write can persist and be
  # committed. A plan present in the ref but not on this machine is simply not
  # logged: the alternative is writing a file the operator never checked out.
  if [ "$PLAN_SOURCE" = "ref" ]; then
    [ -e "$PLAN_DIR$plan_base" ] && plan_files+=("$PLAN_DIR$plan_base")
  else
    plan_files+=("$plan")
  fi

  # THE PLAN'S IDENTITY FOR THE TERMINAL CACHE — its CONTENT, hashed, not its
  # name or its mtime. An edited plan yields a different oid and its branches'
  # cached answers stop validating, which is the invalidation the plan requires:
  # a plan is an input to the derivation, so an answer derived under one
  # revision is not evidence about the next.
  #
  # `hash-object` reads a file without touching the object database. It is one
  # fork per PLAN — not per branch — so it does not reintroduce the per-branch
  # cost this whole change removes.
  TERMINAL_PLAN_OID=$(git hash-object "$plan_read" 2>/dev/null || echo "")

  # One awk pass over the parsed JSON would need a JSON parser; instead the
  # wave walk below is driven by plot-plan-meta.sh's own output via a tiny
  # python shim (present wherever the board's toolchain is).
  [ "$quiet" = 1 ] || echo "== $plan_base =="

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
        # THE REASON FOR THE DEFERRAL rides with its flag, and it rides BEFORE
        # the claim note for the reason the field-order note below states: tab
        # is an IFS whitespace character, so a run of tabs collapses to one
        # separator and only the LAST field may be optional. "-" stands in for
        # empty everywhere, so no run can form.
        row = [str(i), ref, str(b["deferred"]).lower(),
               (b.get("deferred_reason") or "-"),
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
  #
  # `why` — the deferral reason — is free prose in a MIDDLE column, which is
  # only safe because of that same rule: it is "-" when absent, never "". The
  # tabs inside it are replaced with spaces by the shim above, for the same
  # reason. It cannot go last; `claim` already is.
  states=""
  while IFS=$'\t' read -r idx br deferred why wname claim; do
    [ -n "$br" ] || continue
    if [ "$deferred" = "true" ]; then st="deferred"; else st=$(branch_state "$br"); fi
    states+="$idx	$br	$st	$deferred	$why	$wname	$claim"$'\n'
  done <<< "$wave_lines"

  # Pass 2: wave verdicts. A wave is complete when none of its non-deferred
  # branches is outstanding; eligible when all PRIOR waves are complete.
  wave_ids=$(printf '%s' "$states" | cut -f1 | sort -un)
  prior_ok=1
  for wid in $wave_ids; do
    wname=$(printf '%s' "$states" | awk -F'\t' -v w="$wid" '$1==w {print $6; exit}')
    [ "$wname" = "-" ] && wname=""
    outstanding=0
    while IFS=$'\t' read -r idx br st deferred why nm claim; do
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
    while IFS=$'\t' read -r idx br st deferred why nm claim; do
      [ "$idx" = "$wid" ] || continue
      [ "$claim" = "-" ] && claim=""
      [ "$why" = "-" ] && why=""
      n_branches=$((n_branches + 1))
      case "$st" in
        # The REASON, where the plan recorded one. A bare `deferred` beside a
        # branch with no commits reads as two unrelated facts when the first is
        # the reason for the second, and the sentence that says so was already
        # written in the plan file.
        deferred) n_deferred=$((n_deferred + 1)); note="deferred${why:+ — $why}" ;;
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
        # WHY it was deferred, straight from the plan's annotation. "" where the
        # branch is not deferred, and "" where it is deferred with nothing
        # recorded — the flag says which of those two a reader is looking at.
        json_branches+=",\"deferred_reason\":\"$(json_str "$why")\""
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
        # WHETHER SOMEBODY HOLDS THIS BRANCH — the derivation `local_worktree`
        # is one input to, not a rename of it. A branch is held when a worktree
        # here has it checked out AND its tip has not merged: the two facts this
        # loop already holds, `wt_here` and `$st`. The AND is the whole point.
        # `local_worktree` alone would also fire on a CLEAN worktree left on a
        # branch whose work has landed — a leftover directory, not a held branch
        # — and lifting that to WORKING is the merged-leftover misread the plan
        # forbids. Excluding `merged` here is what keeps location and holding
        # apart. `held` may only be true where a worktree is present, so it is
        # false on every branch on every other machine, exactly like its
        # neighbours: additive, never a downgrade of the refs answer. It is
        # emitted for consumers to READ instead of re-deriving `!merged`; it is
        # never fed back into the wave arithmetic below, which settles waves on
        # `merged` alone and is untouched by holding.
        if [ -n "$wt_here" ] && [ "$st" != "merged" ]; then
          json_branches+=",\"held\":true"
        else
          json_branches+=",\"held\":false"
        fi
        # From the REFS, not from the worktree table above — a local branch with
        # no worktree still holds commits nobody can see. 0 wherever this
        # machine has no local ref, which is what every branch elsewhere reports.
        json_branches+=",\"local_ahead\":$(local_ahead_of "$br")"
        # WHEN THIS BRANCH LAST CHANGED — the one signal above that is a
        # DERIVATIVE rather than a state. `local_dirty` and `local_ahead` both
        # read identically for a finished branch and an abandoned one; this
        # tells them apart. See `changed_ago_of` for what it measures and, more
        # importantly, for what it deliberately does not conclude.
        #
        # `null`, NOT 0, WHERE THIS MACHINE CANNOT SEE. The other local signals
        # have an absent value that is also a real value — `false` and `0` are
        # what an unobserved branch honestly reports. Seconds have no such
        # value: 0 means "changed this instant", the most reassuring answer on
        # the board, and handing it to every branch on somebody else's machine
        # would be a fabrication pointing the wrong way. `null` is the only
        # shape that cannot be mistaken for a measurement.
        changed_ago=$(changed_ago_of "$br") || changed_ago=""
        json_branches+=",\"changed_ago_seconds\":${changed_ago:-null}"
        # Whether anything is actually RUNNING on the branch — see `worker_of`.
        # The pid and the exit code travel as values rather than as something to
        # re-derive: a pid of 0 has already been rejected here, and re-deriving
        # liveness on the far side would spring that trap again.
        worker_row=$(worker_of "$br")
        json_branches+=",\"worker\":\"$(printf '%s' "$worker_row" | cut -f1)\""
        json_branches+=",\"worker_pid\":\"$(json_str "$(printf '%s' "$worker_row" | cut -f2)")\""
        json_branches+=",\"worker_exit\":\"$(json_str "$(printf '%s' "$worker_row" | cut -f3)")\""
        # WHAT IS ON THE FLOOR, beside the verdict that named it.
        #
        # A COUNT WOULD HAVE BEEN CHEAPER AND IS NOT ENOUGH. `stalled` exists so
        # a person can decide whether to resume a branch, and "3 uncommitted
        # files" does not support that decision — three scratch notes and three
        # half-finished modules read identically. The names make the row
        # actionable without a second command, which is the only reason to
        # report it rather than merely count it.
        #
        # A SIBLING FIELD, NOT A FOURTH COLUMN on the worker row. Every answer
        # from the shared classifier carries exactly three tab-separated fields,
        # and that is load-bearing: POSIX `cut` prints a line UNCHANGED when it
        # holds no delimiter, so a row of a different width would land a
        # filename in the exit-code slot with nothing erroring. One computation
        # (`plot_worker_dirty`), two renderings — the split this whole file
        # keeps.
        #
        # ONLY ON `stalled`, because only there does it answer anything. Beside
        # `finished` the same list is the leftovers a merged branch happens to
        # hold, and printing it would invite exactly the reading `stalled` was
        # added to prevent.
        if [ "$(printf '%s' "$worker_row" | cut -f1)" = "stalled" ]; then
          json_branches+=",\"worker_dirty_paths\":$(json_array "$(plot_worker_dirty "$(local_worktree_of "$br" | cut -f1)")")"
        else
          # Empty rather than omitted: one absent-value shape for every
          # consumer, the rule the local signals above already follow.
          json_branches+=",\"worker_dirty_paths\":[]"
        fi
        # WHICH FILES would collide, and whether the question was asked at all.
        # The two travel together on purpose: an empty list means "merges
        # cleanly" ONLY beside `conflicts_known: true`, and reading the list
        # alone turns every unanswerable branch into a mergeable one.
        #
        # The SET, never a verdict on it. Whether a given set is the one
        # mechanically resolvable case is a decision one layer up — this script
        # collects and reports.
        cf_known=$(conflicts_known_of "$br" "$st")
        json_branches+=",\"conflicts_known\":$cf_known"
        if [ "$cf_known" = "true" ]; then
          json_branches+=",\"conflicts\":$(json_array "$(conflicts_of "$br")")"
          # What the branch touches — one of the three lines a CI failure is
          # reported with. Evidence for a reader, not an input to any rule here.
          json_branches+=",\"changed_paths\":$(json_array "$(changed_paths_of "$br")")"
        else
          # Not looked at, so nothing is claimed. Empty rather than omitted:
          # one absent-value shape for every consumer, the rule the local
          # signals above already follow.
          json_branches+=",\"conflicts\":[],\"changed_paths\":[]"
        fi
        json_branches+="}"
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
    # ONE composition, two destinations — the property that makes --stream and
    # --json say the same thing rather than agreeing by inspection. A second
    # `printf` shaped like this one would be a second implementation of the
    # plan object, and the first field added to one and not the other is a
    # streamed board that quietly renders less than a batch one.
    #
    # `plan_base` was resolved once where the plan was admitted — in ref mode
    # from the ref, in worktree mode by readlink. Recomputing it here would
    # reintroduce a working-tree read on the JSON path only.
    json_plan="{\"file\":\"$(json_str "$plan_base")\""
    # The plan's own phase, reported verbatim. The board composes it with each
    # branch's git state into a row phase; nothing here decides which column
    # anything reads.
    json_plan+=",\"phase\":\"$(json_str "$plan_phase")\""
    json_plan+=",\"waves\":[$json_waves]}"
    json_plans+="${json_plans:+,}$json_plan"
    # THE STREAM'S POINT: this plan is fully derived, so a consumer can render
    # it now rather than when the eighty-fourth branch resolves. Emitted as one
    # line so a reader can split on newlines without parsing incrementally, and
    # tagged so the terminal `pulse` line cannot be mistaken for another plan.
    #
    # Flushed by `printf` on a line of its own: a consumer reading this stream
    # is reading it BECAUSE the whole document takes 18 s, so buffering the
    # lines until exit would give back exactly what the mode exists to remove.
    if [ "$stream" = 1 ]; then
      printf '{"kind":"plan","plan":%s}\n' "$json_plan"
    fi
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
  # --stream wraps the SAME document in one tagged line rather than emitting a
  # second, smaller one. The terminal object is what proves the scan finished:
  # a consumer that has seen `plan` lines and no `pulse` line has a PARTIAL
  # answer and must say so — which is the whole distinction this mode adds, and
  # the reason the end is marked rather than inferred from the pipe closing.
  # A killed scan closes the pipe too.
  [ "$stream" = 1 ] && printf '{"kind":"pulse","pulse":'
  # `read_ref` is the ref this document was derived from; `local_head` is the
  # checkout it was derived ON. A consumer needs both to tell "the board is
  # current" from "the board is current about an old world".
  #
  # `head` repeats `local_head` as an alias for one release. The board reads it
  # today; it goes away once the board reads the pair.
  printf '{"main":"%s","read_ref":"%s","local_head":"%s","head":"%s",' \
    "$(json_str "$MAIN")" "$(json_str "$READ_REF")" "$(json_str "$LOCAL_HEAD")" \
    "$(json_str "$HEAD_SHORT")"
  # Three more facts about the EVIDENCE, not about the fleet — a consumer that
  # renders the numbers below should be able to say how much to trust them.
  # They answer the question `read_ref` raises: that field names the ref, and
  # these say whether reading it succeeded and whether the plans came from it.
  #
  # `fetch_failed` used to be discarded by `2>/dev/null`, so refs an hour old
  # were reported with the confidence of refs a second old. `plan_source` says
  # whether the plan list came from the ref or fell back to this checkout.
  printf '"fetch_failed":%s,"fetch_error":"%s","plan_source":"%s","plans":[%s],' \
    "$([ "$FETCH_FAILED" = 1 ] && echo true || echo false)" \
    "$(json_str "$FETCH_ERROR")" "$(json_str "$PLAN_SOURCE")" "$json_plans"
  printf '"summary":{"plans":%d,"waves":%d,"branches":%d,"claimed":%d,' \
    "$n_plans" "$n_waves" "$n_branches" "$n_claimed"
  printf '"eligible":%d,"blocked":%d,"deferred":%d,"merge_detect":"%s"}}' \
    "$n_eligible" "$n_blocked" "$n_deferred" "$MERGE_DETECT"
  [ "$stream" = 1 ] && printf '}'
  printf '\n'
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
# A STALE PULSE SAYS SO. The fetch used to fail silently, which made a scan of
# hour-old refs read exactly like a scan of current ones — the same
# over-confidence, one layer up, that this plan fixes in the plan list.
if [ "$FETCH_FAILED" = 1 ]; then
  echo "  note: git fetch failed — these refs are as current as your last"
  echo "        successful fetch, not as current as origin/$MAIN."
  echo "        $FETCH_ERROR"
  # A failed fetch also failed to PRUNE, and that has a sharper consequence
  # than staleness alone: an unpruned ref sends branch_state() down the
  # ancestry arm, where a squash merge reads `wip`. Said plainly, because the
  # symptom — a finished wave that will not complete — looks nothing like
  # "your fetch failed".
  echo "        Stale remote-tracking refs were not pruned either, so a branch"
  echo "        merged and deleted upstream may still read wip."
fi
# AN OFFLINE SCAN CANNOT PRUNE, and the answer that costs is not obvious.
# --offline skips the fetch, so refs for branches deleted upstream survive, and
# a surviving ref is what makes a squash-merged branch read `wip` and its wave
# read blocked. Reporting the flag alone would leave the operator to derive
# that; this states the consequence instead. Only under the prose report — the
# machine renderings carry `fetch_failed` and the caller passed --offline
# itself, so neither is being told something it does not know.
if [ "$do_fetch" = 0 ]; then
  echo "  note: --offline skipped the fetch, so stale remote-tracking refs were"
  echo "        not pruned; a branch merged and deleted upstream may read wip"
  echo "        and hold its wave blocked. Re-run without --offline to settle it."
fi
# The fallback announces itself. Silent degradation here would recreate the
# very bug being fixed: a working-tree plan list reported as if it were the ref.
if [ "$PLAN_SOURCE" != "ref" ]; then
  echo "  note: origin/$MAIN could not be read — plans were listed from this"
  echo "        checkout instead, so the list is only as current as your last pull."
fi
echo "Pulse complete. This report is derived — nothing was changed."
echo "summary: plans=$n_plans waves=$n_waves branches=$n_branches claimed=$n_claimed eligible=$n_eligible blocked=$n_blocked deferred=$n_deferred merge_detect=$MERGE_DETECT main=$MAIN"
