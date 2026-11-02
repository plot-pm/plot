#!/usr/bin/env bash
# Plot helper: fleet pulse — deterministic extractor for wave/claim state.
# Usage: plot-fleet-scan.sh [--no-fetch] [--offline] [--next] [--slice-names] [<slug>]
#   --slice-names  print every slice a `waits:` name may wait on, one per line,
#               and exit: the estate's non-deferred slices of non-terminal plans,
#               whatever slug is given. No fetch, no host call.
#   --no-fetch  skip `git fetch`
#   --offline   same (no fetch) — used for cheap, ambient pulses.
#               The fetch also PRUNES remote-tracking refs, so skipping it
#               keeps whatever stale refs this checkout holds: a branch merged
#               and deleted upstream may read `wip` rather than `merged`, and
#               its wave may read blocked. That is the honest answer for a scan
#               that asked nothing, and the footer says so rather than leaving
#               it to be discovered.
#               IT DOES NOT SILENCE THE HOST ON THE OFFER PATH. With `--next`
#               or `--list-eligible` the host is asked anyway — see those flags
#               — because naming a branch to claim turns on a fact refs cannot
#               supply. Every other use of the flag asks nothing, as before.
#   --list-eligible  print EVERY claimable branch, one per line (exit 1 if none).
#               For callers that need the count rather than one item — a dry
#               run changes nothing, so its answer cannot go stale.
#               WHEN THERE ARE NONE IT SAYS WHY, ON STDERR: whether every
#               candidate in an eligible wave is taken, or no eligible wave held
#               a startable branch at all. Two silences a reader cannot
#               otherwise tell apart (#994). Stdout stays a bare branch list
#               because `plot-dispatch.sh` pipes it through `sort -u` and
#               dispatches every line, and the exit code stays 1 either way, so
#               no caller's gate moves. An estate with NO plans exits earlier
#               and says nothing — there is no candidate set to describe.
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
#               ASKS THE HOST EVEN UNDER `--offline`, and withholds a branch it
#               could not ask about. A merged branch is not claimable, and once
#               a squash merge has rewritten the commits and `--delete-branch`
#               has removed the ref, the host is the only source that can say
#               so. Measured 2026-09-04: ten refs on this estate carry the tip
#               commit `plot: claim <branch>` dated hours AFTER their own merge,
#               all pushed on this offer.
#   --why-nothing  print WHY `--next` would be silent, and exit 0 either way:
#               `none` when there is no work left for this plan, or `not-yet`
#               followed by the branches whose landing would open a blocked
#               slice. THE SECOND QUESTION A WORKER ASKS. `--next` exits 1 for
#               two different nothings — a blocked next slice and no next slice
#               — and a worker that cannot tell them apart pays a whole
#               dispatch to reach a slice it was standing next to. Exits 0 with
#               `none` when it cannot tell, so silence is never read as wait.
#   --stream    --json, emitted as it resolves rather than as one document at
#               the end. One `{"kind":"plan","plan":{...}}` line per plan the
#               moment that plan is fully derived, then one
#               `{"kind":"reading","reading":{...}}` line carrying the SAME
#               document --json prints. A consumer that has seen plan lines and
#               no reading line holds a PARTIAL answer — the scan takes 18 s on
#               84 branches and a board that renders nothing for that long
#               looks broken. The terminal line is what says the scan finished;
#               a closed pipe does not, because a killed scan closes it too.
#   <slug>      limit the report to one plan (default: all active plans)
# Wave verdicts — the word each wave carries, and what a reader may do with it:
#   complete    every non-deferred branch of the wave has merged
#   eligible    A DISPATCH WOULD TAKE THIS: prior waves landed AND the plan is
#               approved. The word a reader acts on, and the only one that
#               promises the dispatcher agrees.
#   blocked     an earlier wave has not landed — resolves by merging work
#   unapproved  the plan is not approved, so nothing here may be dispatched —
#               resolves by a person approving the plan, not by any merge.
#               Kept apart from `blocked` because the reader's next action
#               differs, and a terminal-phase plan lands here too (it is not
#               approved); the board routes those to DONE by phase before the
#               verdict is read.
# Branch states — the word each BRANCH carries, distinct from the wave verdicts
# above. `open`, `wip`, `merged`, `claimed`, `deferred` and `unknown` are read
# from git and the host. Two more are read from the plan's `waits:` annotation:
#   waiting     the branch names a prerequisite branch that has not merged —
#               including a slice some plan names that nobody has started. A
#               wait with an end: it clears when that branch lands, and the
#               fleet payload carries `waits_on` so a reader sees on WHAT.
#   blocked     the branch names a prerequisite the host has never seen a PR
#               for and no plan names as a slice — a typo. A defect in the plan
#               estate, not progress, which is why it is a separate word: the
#               first resolves by waiting, the second by editing the plan.
#               THE SAME WORD AS THE WAVE VERDICT, IN A DIFFERENT VOCABULARY.
#               A wave is `blocked` by an earlier wave; a branch is `blocked`
#               by a prerequisite nobody declared. The two travel in separate
#               JSON fields (`waves[].verdict` vs `branches[].state`) and are
#               counted separately in the footer — `blocked=` is the wave
#               count it has always been, `prereq_missing=` is the branch one.
# Both apply ONLY where the branch's own state is `open` or `unknown` — a
# branch carrying work, a claim, or a merge has already been started, and
# overriding `merged` would stop its wave settling forever. An unreachable host
# holds the slice at `waiting`; silence is never permission to start, and never
# evidence of a typo either.
# Output: per-plan wave report on stdout, terminated by a machine-countable
#         summary line:
#             summary: plans=1 waves=3 branches=5 claimed=1 claimable=2 eligible=2 blocked=1 deferred=1 waiting=1 prereq_missing=0 merge_detect=pr-merge host=ok main=main
#         `host` is one of ok, partial, throttled, secondary, failed, unasked —
#         `partial` means some of the host's states answered and some did not,
#         so the PR readings below are incomplete rather than absent.
#         `blocked` counts WAVES an earlier wave holds; `waiting` and
#         `prereq_missing` count BRANCHES their `waits:` annotation holds.
#         `claimable` counts BRANCHES a worker may take now, and it is the key
#         the offer paths agree with — `--next` names one of them and
#         `--list-eligible` names all of them. `eligible=` carries the SAME
#         number beside it and is kept for consumers that read it; it was the
#         only name this count had until 2026-09-25, sitting between two wave
#         counts while counting branches, so a wave printed `eligible` in the
#         body while the footer read `eligible=0` and both were right about
#         different questions (#994). A reader wanting the WAVE answer counts
#         the body's verdicts; no footer key reports it.
#         merge_detect names how merged-and-deleted branches were detected:
#         pr-merge (exhaustive), truncated (capped walk), none (no conforming
#         merge commits — a squash/rebase repo, where `open` says nothing about
#         merging).
#         host says whether the git host ANSWERED, and is what says whether
#         merge_detect can be believed: ok (the list arrived — an EMPTY list is
#         ok, the host answered and there are none), throttled (a spent quota;
#         the same question after the reset will be answered), secondary (a
#         burst refusal, which clears in seconds), failed (any other failure),
#         unasked (no host, or --offline — the question was never put, which is
#         not the same as one that went unanswered).
#         Measured 2026-08-30: a merged branch read `open` and was counted
#         among the unfinished under `merge_detect=pr-merge`, which reads as
#         *asked and answered*, while the host had refused every call. Where
#         host is throttled, secondary or failed, a no-ref branch reads `unknown`
#         rather than `open` and is not offered to --next.
#         Consumers that only need counts (the /plot-fleet pulse log, the
#         board) read that one line and never re-count the body.
#         --json additionally carries, per PLAN, `phase` — the plan's own
#         lifecycle state, verbatim from plot-plan-meta.sh, and the half of a
#         row's phase git cannot answer. Which column a row reads is composed
#         from it AND the branch state one layer up; this script decides nothing.
#         The plan set also includes every plan at `Delivered`, until it is
#         `Released` (see "the release scope"), so DONE names what the next
#         release ships.
#         Plans are enumerated from REFS (`git ls-tree`/`git show`), NOT from
#         the working tree — so the list describes committed state and does not
#         change while rebases and worker commits rewrite the checkout
#         underneath a running fleet. `origin/<main>` first, then each prefixed
#         branch's own tree for the plans the default branch does not carry:
#         a plan created with `Impl: same branch` lives only on its work branch
#         until that branch merges, and reading main alone reported its branch as
#         an anonymous row with `plan: ""` while the Board tab showed the same
#         plan as a Draft card (#972). A plan path is taken ONCE — the default
#         branch wins, and among branches the first to carry it — because two
#         branches cut from one point hold the same file and a row per branch
#         would report one plan as several. A consequence worth stating: an
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
#         --json additionally carries `changed_at` (the epoch second of the
#         newest evidence of work — what a CHANGE detector must watch, since it
#         moves only when something happens) and `changed_ago_seconds`: how long since this
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
#         cannot answer at all. `worker_activity` rides beside them ONLY where
#         `worker` is `running`: `working` when the worker's child is burning
#         CPU, `idle` when its clock is frozen, "" everywhere else. A secondary
#         cue, not a sixth state — `running` is honest and coarse, and this says
#         which kind of running it is without the enum growing a member.
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# STATELESS AND READ-ONLY. This is the whole design (Manifesto Principle 1):
# there is no fleet database. Every fact printed here is re-derived from git
# refs and plan files on each run, so a killed dispatcher, a dead worker, or a
# crashed pulse costs nothing — the next pulse re-derives the truth. Nothing
# here creates a branch, pushes a ref, or starts a worker.
#
# TWO exceptions to "writes nothing", and NEITHER IS STATE. The test both pass
# is the same one: delete what they wrote and no behaviour changes, because the
# next run re-derives everything.
#
# 1. --log-pulse appends a pulse line to each reported plan (see below). That is
#    a LOG. The flag defaults OFF precisely so internal callers (plot-implement,
#    plot-dispatch, which invoke --next) can never amend a plan as a side effect
#    of asking what to work on; /plot-fleet, the human-facing command, passes it
#    every run.
#
# 2. `.plot/state/last-pulse.json` — the bridge, written by `write_bridge` on
#    the success path of `--stream` (unless PLOT_SCAN_RECORD=0) and `--log-pulse`
#    (what /plot-pulse passes; not while the fleet's writer holds the bridge). Those are the two callers that produce a pulse
#    for somebody to READ; plain `--json` is a query and records nothing. That
#    is a CACHE WITH AN EXPIRY: `pulse-bridge.ts` discards it after 15 minutes
#    and on a version mismatch, so it can only ever be a shortcut to an answer
#    this script re-derives anyway. It is machine-local and gitignored.
#
#    Added 2026-09-06. The board wrote this file and the scan did not, so a
#    repository with no board had nothing to diff against and every pulse read
#    as the first one — while `DESIGN-process.md` §1 requires the fleet to work
#    with no board at all. The component that PRODUCES a pulse is the one that
#    records it.
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
set -o pipefail
# THE SCAN IS A LAUNCHER. It parses its arguments, fetches and prunes, and hands
# the rest to the domain walk (`board/plot-scan-walk.mjs`), which reads the
# estate, the branches, the desks and the host and prints the answer for the
# mode it is given. No rule lives here. The walk takes the fetch result,
# `origin/<main>` and HEAD as inputs (empty where a ref does not resolve), so the fetch stays in this file. A call with
# no slug and no mode flag prints the wave report.
here=$(dirname "$0"); . "$here/plot-default-branch.sh"
c() { "$here/plot-config.sh" get "$@"; }
printf '%s\n' "$@" | grep -qxE -- '-h|--help' && { sed -n '2,12p' "$0"; exit 0; }
git rev-parse --git-dir >/dev/null || exit 1
MAIN=$(c "Main branch"); MAIN=${MAIN:-$(default_branch)}
# A FAILED FETCH IS A FACT, not a shrug: the scan still runs on the refs it holds
# and carries `fetch_failed` and `fetch_error` into the answer. The fetch PRUNES
# with the explicit heads refspec, because a narrow refspec scopes the prune to
# `origin/$MAIN` alone and a branch merged and deleted upstream would keep its
# stale ref and read `wip`. `--offline`, `--no-fetch` and `--slice-names` skip it.
printf '%s\n' "$@" | grep -qxE -- '--no-fetch|--offline|--slice-names'; skip=$((1 - $?))
[ "$skip" = 1 ] || err=$(git fetch -q --prune origin "$MAIN" "+refs/heads/*:refs/remotes/origin/*" 2>&1) || failed=1
exec node "$here/board/plot-scan-walk.mjs" \
  "$(printf '%s\n' "$@" | awk '{s[$0]=1} END{printf "%d%d%d%d%d%d%d%d", s["--slice-names"], s["--why-nothing"], s["--list-eligible"], s["--next"]||s["--list-eligible"]||s["--why-nothing"], s["--json"]||s["--stream"], s["--log-pulse"], s["--loose"], s["--stream"]}')" \
  "$(printf '%s\n' "$@" | grep -v '^-' | tail -1)" "$MAIN" "$(c "Plan directory" docs/plans/)" "$(c "Active index" docs/plans/active/)" "$(c "Delivered index" docs/plans/delivered/)" \
  "$(c "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' -)" "$((skip == 1 ? 1 : 0))" \
  "$(git rev-parse --short "origin/$MAIN" 2>/dev/null)" "$(git rev-parse --short HEAD 2>/dev/null)" "${failed:-0}" \
  "$([ -z "${failed:-}" ] || printf '%s' "${err:-git fetch failed with no message}" | tr '\n' ' ' | sed 's/  */ /g; s/^ *//; s/ *$//')"
