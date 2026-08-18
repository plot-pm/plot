# A squashed branch is merged, not open

> Squash-merge a branch and delete it, and the fleet reports it as `open` — the same word it uses for a branch nobody has started. Its wave never completes, so the next wave never becomes eligible.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Delivered:** 2026-08-18, jwloka, PR #216
- **Started:** 2026-08-18, Jan Wloka, `bug/a-squashed-branch-is-merged-not-open`

## Changelog

- `plot-fleet-scan.sh` reports a squash-merged branch as `merged`, not `open`, so its wave completes and the next wave becomes eligible.

## Motivation

Observed 2026-08-18, immediately after squash-merging PR #209 of
`docs/plans/2026-08-18-plot-board-setup.md`:

```
== 2026-08-18-plot-board-setup.md ==
  Scripts — eligible
      feature/plot-board-probe — in progress
      feature/plot-board-verify — open        <- MERGED minutes earlier
  Skill — blocked
```

The wave reads `eligible` rather than `complete`, and `Skill` stays `blocked`.
A wave that can never complete blocks its successor forever: the fan-out
`/plot-dispatch` exists to perform cannot proceed past its first wave under the
repo's own merge convention.

### The second symptom: delivered work advertised as available

Observed on the board 2026-08-18, after `bb-state-vocabulary` was delivered:

```
NOT STARTED (8)
  Endgame   bb-state-vocabulary        1 wave, first eligible
            bug/bb-state-vocabulary    eligible — nobody has taken it
```

Every fact behind that row is settled: the plan reads `Phase: Delivered` with a
`Delivered:` record on `origin/main`, PR #210 is `MERGED`, and the remote branch
is gone. The board still lists the branch under **NOT STARTED** and calls it
*eligible*.

So the defect is not only that a wave fails to complete — it is that finished
work is offered as available. "No ref" defaults to *start this*, which is the
reassuring direction: the system invites work rather than admitting it cannot
tell.

**It stops at the display, and that is worth stating precisely.**
`plot-dispatch` refuses the same plan outright:

```
plot-dispatch: plan '2026-08-18-bb-state-vocabulary' is already delivered —
its work is done.
```

The phase gate catches what the branch state gets wrong, so no agent can be
dispatched onto shipped work. That makes this a display bug rather than a
correctness one — but only because a *second, independent* check happens to
cover it. The branch-state answer is wrong on its own terms, and the wave-
blocking symptom above has no such backstop.

### Why the scan cannot see it

Two facts combine, and each is individually reasonable.

**A branch's state comes from its ref**, and `--delete-branch` removes it. The
script says so at line 558: *"an `open` branch has no ref"* — so a branch
deleted at merge and a branch nobody ever created are indistinguishable. `open`
is the honest reading of *no ref exists*; it is simply not the whole truth.

**`pr-merge` detection walks merge commits, and a squash merge is not one.**
Measured on the merge of #209:

```
$ git log -1 --format="%h parents=%p %s" a263711
a263711 parents=c3b2dda plot: board verification as a trap-guarded script (#209)
```

One parent — an ordinary commit. It names `#209`, not
`feature/plot-board-verify`. So the exhaustive merge-commit walk that gives
`merge_detect=pr-merge` its confidence has nothing to match: there is no merge
commit, and the only identifier present is a PR number the walk is not looking
for.

The data is not missing. The host answers immediately:

```
$ plot-host.sh pr-state feature/plot-board-verify
{"number":209,"state":"MERGED","mergeCommit":"a263711..."}
```

The scan reports `open` while a single call away sits `MERGED`.

### Why this is not the same bug as the flicker

`docs/plans/2026-08-18-the-board-never-shrinks-on-a-success.md` is about the
scan reading the **working tree** instead of the ref it claims to read. This one
is about **merge detection** failing for a merge style the repo uses by default.
They share an ancestor — state inferred from local refs rather than from the
host — and fixing either leaves the other standing.

## Design

### Approach

**Ask the host when the ref is gone.** A branch with no ref is exactly the case
where `pr-state` is both cheap and decisive: there is nothing local left to
read, so the one remaining source is the host, and the answer is a single call
per absent branch — not per branch.

The reply is three-way, and each arm already has a home in the scan's
vocabulary:

| `pr-state` says | Branch reads |
|---|---|
| `MERGED` | `merged` — the wave can complete |
| `OPEN` / `CLOSED` | its existing meaning |
| `NONE`, or the call fails | `open`, exactly as today |

The last row is the load-bearing one. `plot-host.sh` already distinguishes a
lookup miss from a transport failure, and this must not turn an unreachable host
into a fabricated `merged`. When the host cannot answer, the scan says what it
says today.

**Cost.** One host call per branch that has no ref — bounded by the plan's
branch count, and zero for the common case where refs exist. The scan already
makes host calls in `pr-merge` mode, so this adds no new dependency.

### Alternatives considered

**Match the PR number in the squash subject.** GitHub writes `(#209)` and the
plan already records `PR #209` in its Branches section, so the two could be
joined locally with no host call. Cheaper and offline — but it depends on a
commit-subject convention the host controls and a plan annotation a human may
not have written. It would work today and break silently on a repo that
squash-merges with a different subject template.

**Ask the operator to keep branches.** Refuse `--delete-branch`, and refs stay.
This makes the tool dictate the repo's merge convention, which Principle 4
(*conventions projects opt into, not configuration Plot enforces*) rejects.

Both are recorded because if the host call proves too slow at scale, the
subject match is the fallback worth measuring.

### Open Points

- [ ] Should the answer be cached across a scan? A plan whose branches were all
      squash-merged makes one call per branch, every run, forever. The board
      polls this every 5 s.
- [ ] Does the same blindness affect `/plot-deliver`'s landed check? It verifies
      impl PRs are merged, and a deleted branch may present the same way there.
- [ ] `merge_detect` currently reports `pr-merge | truncated | none`. A run that
      resolved some branches via the host is a fourth mode, and the footer
      should probably say so rather than claiming an exhaustive local walk.

## Branches

- `bug/a-squashed-branch-is-merged-not-open` — ask the host for branches with no local ref, map the three-way reply, and leave the unreachable case reading exactly as it does today. Test: a sandbox where a branch is squash-merged and deleted must report `merged` and let its wave complete, and a sandbox with an unreachable host must still report `open`. → #216

## Notes

Found while delivering wave 1 of `2026-08-18-plot-board-setup`, with a second
agent still working wave 1's other branch. The blocked-forever consequence is
not hypothetical: that plan's `Skill` wave was unreachable until this was
understood.
