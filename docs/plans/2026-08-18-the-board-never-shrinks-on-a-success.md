# The board never shrinks on a success

> Rows vanish and come back seconds later. A refresh that *succeeds* is trusted unconditionally, and a successful scan can legitimately describe a smaller world than the one before it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The fleet cache no longer accepts a successful-but-smaller pulse without saying so: a refresh that loses plans or branches is reported rather than silently swapped in.
- `plot-fleet-scan.sh` enumerates plans from the ref it claims to read (`origin/<main>`), not from whatever the local working tree happens to contain.

## Motivation

Observed 2026-08-18 by an operator watching a live two-agent dispatch: branch
and plan rows — including WORKING rows for agents that were demonstrably
running — disappear from the Agents tab, then reappear intact a few seconds
later. No error is shown, and the tab never says it is stale.

### The cache trusts success unconditionally

`fleet.ts` protects the cache against failure, and the comment is explicit
about why:

```
684:  // A failed refresh NEVER overwrites a good result. Replacing real state
      // with emptiness because one scan failed is what makes a monitoring view
      // untrustworthy — the tab keeps the last pulse, its age, and this error.
```

The PR map obeys the same rule, for the same stated reason: an empty PR map
"would quietly move every row back to its git-only group, **which looks like
state changing rather than data missing**" — an exact description of the
reported symptom.

But the success path has no equivalent guard:

```
640:  entry.pulse = parsed;
```

Unconditional. The invariant is *failure must not overwrite good data*, and the
unstated assumption underneath it is *any success is authoritative*. That
assumption is false: a scan can exit 0, emit schema-valid JSON, and describe
fewer plans than the scan before it. Nothing in the pipeline treats shrinkage as
suspicious, so the smaller answer is cached, rendered, and then replaced by the
next full one — a flicker.

### Why a successful scan shrinks

Measured in a sandbox with a bare origin and two clones, 2026-08-18:

```
origin/main: 24be275   local HEAD: 1085976
plans in origin/main tree: 3
plans in working tree:     2
scan --json reports:       2 plans
```

A second agent pushed a third plan. The scan's `git fetch` **succeeded** —
`origin/main` genuinely carried three plans — and the scan still reported two,
because it enumerates the **working tree**:

```
121:  PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
270:  set -- "$PLAN_DIR"/[0-9]*.md
```

`PLAN_DIR` is a filesystem path. The fetch at line 134 updates refs that the
plan enumeration never reads, and the banner then labels the result "on
origin/main" (see
`docs/plans/2026-08-18-the-pulse-names-the-ref-it-read.md`).

So the board's plan list is only as current as the operator's last `git pull` —
and during a fleet run, the working tree is being rewritten by rebases,
checkouts, and worker commits underneath the scan. Each of those is a moment
when a glob can return a different set while exiting 0.

The fetch itself is also unguarded:

```
134:  [ "$do_fetch" = 1 ] && git fetch -q origin "$MAIN" 2>/dev/null
```

Errors discarded, no failure signal, execution continues. A blip during a fleet
run — GitHub 503, a concurrent worker holding the ref lock — is indistinguishable
from a healthy fetch.

## Design

### Approach

Two independent fixes. The first stops the flicker; the second removes its
cause.

**1. Shrinkage is a suspicious success.** Compare the incoming pulse against the
cached one before accepting it. A refresh that reports strictly fewer plans (or
fewer branches within the same plans) is not automatically wrong — plans really
do get delivered — but it is the one shape that produces the reported symptom,
so it must not pass silently.

The conservative rule, matching how this codebase already handles ambiguity:
accept the new pulse (it may be correct) **and** carry a flag saying the
previous answer was larger, so the UI can mark the view rather than swapping it
without comment. *Degrade, do not hide* — the rule `pulse-bridge.ts` already
follows for staleness.

Rejecting the smaller pulse outright is the alternative and is worse: a plan
legitimately delivered would keep a dead row forever, and a monitoring view that
cannot shrink is a different kind of lie.

**2. Read the ref, not the tree.** Enumerate plans with `git ls-tree
origin/$MAIN -- $PLAN_DIR` rather than a filesystem glob, and read their content
with `git show`. The scan then describes one atomic commit rather than a
directory being rewritten under it — which is what makes the answer stable
during a fleet run, and what makes the banner true.

This is the larger change and it interacts with the local-state features the
scan grew for good reasons (`local_dirty`, `local_worktree`, the `.git/index.lock`
observation at line 265). Those deliberately describe *this machine* and must
keep doing so. The split is: **plan enumeration** comes from the ref, **worktree
observation** stays local.

Guard the fetch while there: a failed fetch means the refs are older than the
scan claims, and that is a fact the report should carry rather than discard.

### Open Points

- [ ] Does any consumer rely on the scan seeing *uncommitted* plan edits in the
      working tree? `/plot-idea` writes a plan before committing it, and a
      ref-only enumeration would make it invisible until commit. That may be
      correct — an uncommitted plan is not yet shared — but it is a behaviour
      change that needs stating.
- [ ] Should shrinkage detection compare counts, or identities? Counts are cheap
      and catch the reported symptom; identities (which plan vanished) make a
      much better message and cost a set difference.
- [ ] Does the same unconditional-success assumption exist in `entry.ages`,
      `entry.approvedAt`, and `entry.ideaPlans`? Each is assigned in the same
      block and none is compared against its predecessor.

## Branches

### Symptom

- `bug/a-smaller-pulse-is-not-silently-better` — compare incoming against cached, carry the discrepancy to the UI, and render the view as suspect rather than swapping it silently. Tests: a shrinking sequence must not produce an unmarked smaller board.

### Cause

- `bug/the-scan-enumerates-the-ref` — enumerate plans from `origin/$MAIN` via `git ls-tree`/`git show`, keep worktree observation local, and stop discarding the fetch's failure. Tests: the sandbox above — a third plan pushed by another clone must be seen without a local pull, and the count must not depend on the working tree.

## Notes

The two branches are ordered by wave deliberately: the symptom fix is small,
independently valuable, and protects the view even if the cause fix is deferred
or reverted. The cause fix is the real repair and carries the behaviour question
in Open Points.

Related and deliberately separate:
`docs/plans/2026-08-18-the-pulse-names-the-ref-it-read.md` corrects the banner
that made this hard to see; this plan corrects what the scan reads and what the
cache accepts.
