# A finished plan delivers itself and clears up behind it

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-27, Jan Wloka, `bug/the-reaper-reads-any-merged-pr`

## Changelog

When a plan's last wave merges, the plan is delivered and its worktrees are
reaped — so finished work leaves the estate instead of accumulating in it.

## Motivation

### The measurement

Reported by the operator on 2026-08-27, for the second time in one day:

```
Last scan failed: timed out after 90000ms — 54 worktrees, 43 branches
```

Asked *"why are the worktrees for done work not cleaned up"*, the estate answered
plainly: **12 of 23 worktrees were reapable and nobody had run the reaper.**
Running it removed all 12.

They were not stuck. They were waiting for a human to type a command, and the
plans they belonged to were waiting for a human to type a different one.

### Delivery is a manual step nothing triggers

`allWavesMerged` (`board.ts:427`) already computes the exact condition: every
non-deferred branch of a plan has merged. `planStatus` already renders it as
`deliverable`. And both deliberately touch nothing — the docstring states it:

> It returns a string and touches nothing — no phase is flipped, no record
> written.

That restraint is right for a *measurement*. What is missing is anything that
acts on it. Four plans were delivered by hand today, each after the same manual
check, and eleven more sit `merged_not_delivered` in the reconcile scan.

### The reaper is one PR away from clearing three more

`plot-reap.sh:66` asks the host for merge state:

```bash
gh pr list --head "$br" --state all --limit 1 --json mergedAt
```

**`--limit 1` reads only the NEWEST PR.** Measured 2026-08-27:

| branch | newest PR | the real merge |
|---|---|---|
| an-unreachable-host-says-so | #473 `mergedAt=null` | **#446 merged** |
| the-scan-sees-a-stale-sprint-tally | #464 `mergedAt=null` | **#463 merged** |
| a-plan-cites-a-jira-key | #476 `mergedAt=null` | **#447 merged** |

Each reads `unlanded work — no merged PR` while its work is on main.

**And the masking PRs are ones the fleet created itself.** #473, #464 and #476
are the duplicate PRs auto-dispatch opened on already-merged waves — the ones a
person had to close by hand. So the defect is self-reinforcing:

1. a leftover worktree lets auto-dispatch adopt a merged branch;
2. the worker opens a duplicate PR;
3. that PR is newer than the real one, so `--limit 1` reports `mergedAt=null`;
4. the reaper keeps the worktree — which is the input to step 1.

The other four `keep` verdicts are correct: `merged=0, open=0`, genuinely
unlanded work. **The reaper is wrong about 3 of 23, not about 11.** An earlier
reading of this session blamed squash-merge for all of them; squash-merge is why
*ancestry* cannot decide, and this is a different bug with a one-line cause.

## Design

### The trigger already exists; only the act is missing

`allWavesMerged` is the condition, computed every scan from git. Delivering on it
means: flip `Phase: Approved` → `Delivered`, write the `Delivered:` record, move
the index symlink — the same three writes `/plot-deliver` performs, through the
same code path.

**One implementation, two entrances.** `/plot-deliver` stays the command a person
runs; this adds a caller, not a second implementation — the same split
`plot-approve.sh` already has between the skill and the board's Approve button.

### The board calls a SCRIPT, because it may not invent a transition

Found while reviewing this plan on 2026-08-27, before approving it.

**The board never writes a plan file.** `approve.ts` writes only state and prompt
files and shells out to `plot-approve.sh`; the rule this repo keeps is *board
writes wrap scripts, or they are licensed repairs — the board never invents a
lifecycle transition*.

**And `plot-deliver.sh` does not exist.** `skills/plot/scripts/` holds
`plot-approve.sh` and no delivery counterpart: the transition lives only in
`/plot-deliver`'s prose. So "the board delivers a plan" — as this plan first
phrased it — asks for a caller with nothing safe to call, and an implementer
reaching that point would have re-implemented the phase flip, the `Delivered:`
record and the symlink move in TypeScript. That is precisely the drift the
approve split removed.

So the mechanical half is extracted FIRST, into its own wave, exactly as
`plot-approve.sh` was: one implementation, two entrances. `/plot-deliver` keeps
the judgement — the completeness check, the partial-deliverable question — and
delegates the writes.

### Two modes, mirroring Approve

`plot-approve.sh` is reached two ways, chosen by a config key:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

Delivery takes the same shape with a `Deliver command` key. Direct is the
default and is what the tests assert; a project that wants its own checks
interposed sets the key and gets an agent, without this plan having to know what
those checks are.

### The reaper runs after the delivery, never before

Ordering matters and is a `Done when` item. A reap before the phase flip removes
the worktree of a plan still reading `Approved`, which is the state a human would
read as *work in progress with no desk*. Deliver, then reap.

### `--limit 1` becomes "any merged PR for this branch"

The one-line cause above. The question the reaper asks is *has this branch's work
landed*, and the newest PR is not the answer — a closed duplicate is newer than
the merge it duplicates.

This is the same lesson `plot-reap.sh` already learned once and recorded: it
reads `mergedAt` and never `state`, because a merged PR reports `CLOSED`. Reading
only the newest PR is that error one level out.

### Not chosen: deliver without asking anyone

The strongest objection, and it is answered by what delivery *means* rather than
by caution. `Delivered` is not a claim that the work is correct — `/plot-deliver`
itself says features and bugs then wait for `/plot-release`, and the board
renders the phase as **Testing**. It is a claim that every branch merged, which
is precisely what `allWavesMerged` measures from git.

**The judgement `/plot-deliver` reserves for a person is a different one:**
whether to deliver a plan with *partial or missing* deliverables. That question
does not arise here — this fires only when every non-deferred branch has landed,
which is the same gate the manual command applies before it offers to proceed.

### Not chosen: auto-deliver a plan with deferred waves

A plan can carry `<!-- deferred: -->` waves that will never merge.
`allWavesMerged` already excludes them, and that is correct for the measurement —
but a plan whose remaining work is *all* deferred has not finished, it has been
shelved. Delivering it would record a completion nobody decided.

So the trigger requires at least one merged wave and no unmerged non-deferred
one. A wholly-deferred plan stays for a person.

### Not chosen: reap on any merged branch, plan or no plan

The reaper already does that when run — this plan does not widen what it reaps,
only when it runs. A branch with no plan (`bug/a-head-counts-its-own-waves`,
merged three days ago, owned by no wave) is still reaped by the ordinary
`plot-reap.sh` run and needs no plan-shaped trigger.

### Not chosen: run the reaper on a timer

It would clear worktrees on a schedule unrelated to whether anything finished,
and the board would remove a desk while its operator was looking at it. The
finishing of a plan is the event; a timer is a guess about when events happen.

## Waves

### Landed (Branch: bug/the-reaper-reads-any-merged-pr)

`plot-reap.sh` asks whether ANY PR for the branch merged, not whether the newest
one did — so a closed duplicate stops masking a real merge.

**Independent in CONTENT, not in ORDER.** It shares no file with the two waves
below and could be built beside them — but wave ordering is positional, so
`Extracted` stays `blocked` until this merges. That is the mechanism working as
designed, and it is why this wave is first: it is the shortest, and the other two
wait behind it. A reading of "independent" as "startable in parallel" was
measured wrong on 2026-08-27 — `--max 2` dispatched one wave and reported
`dispatched=0` for the second, correctly.

### Extracted (Branch: feature/plot-deliver-has-a-script)

The mechanical half of delivery — phase flip, `Delivered:` record, index symlink,
push — moves into `skills/plot/scripts/plot-deliver.sh`, and `/plot-deliver`
calls it. Idempotent and refusing on its own preconditions, the way
`plot-approve.sh` is. **No behaviour changes**: this is the extraction that gives
the next wave something to call.

### Delivered (Branch: feature/a-finished-plan-delivers-itself)

The board delivers a plan whose every non-deferred wave has merged, by calling
that script — direct, or through an agent where a `Deliver command` is set — and
reaps its worktrees afterwards. **Depends on `Extracted`.**

## Done when

1. **A branch whose merged PR is not its newest is reaped.** The measured case —
   three branches today, each masked by a duplicate the fleet itself opened.
2. **A branch with no merged PR at all is still kept.** Four such today
   (`merged=0, open=0`); a fix that reaps them destroys unlanded work and would
   pass item 1.
3. **A plan whose last non-deferred wave merges reaches `Phase: Delivered`
   with its `Delivered:` record**, both written in one commit. The record is
   load-bearing: the fleet scan reads its rolling window from `delivered_raw`,
   so a phase flip without it makes the plan invisible rather than delivered.
4. **The reap runs AFTER the delivery, never before.** Asserted by ordering, not
   by end state — both orders end with a delivered plan and no worktree, and only
   one of them never shows a desk-less `Approved` plan.
5. **A plan whose remaining waves are all `deferred` is NOT auto-delivered.**
   Shelved is not finished; that call stays with a person.
6. **Nothing is delivered while any non-deferred wave is unmerged.** The gate
   `/plot-deliver` applies by hand, applied here.
7. **`/plot-deliver` and the board reach ONE implementation.** The board must
   not write a plan file itself; asserted by the absence of any phase-flip or
   `Delivered:` write in `packages/board`. This is the rule the approve split
   already established, and the reason `Extracted` comes first.
8. **`plot-deliver.sh` is idempotent**, like `plot-approve.sh`: it writes
   irreversibly (the push), so re-running it is the repair for an interruption,
   and every step tests the source it would have written.
9. **`Extracted` changes no behaviour.** `/plot-deliver` delivers exactly what it
   delivered before, by the same rules; only the location of the writes moves.
10. **A `Deliver command` routes through an agent; its absence routes direct.**
    Both paths asserted, mirroring `Approve command`.
11. `pnpm run validate`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### What the operator actually asked

*"Why are the worktrees for done work not cleaned up?"* — and the honest answer
was that the reaper works and nobody had run it. Twelve worktrees went in one
command.

That is the shape worth naming: **not a broken mechanism, an unautomated one.**
Every piece of this plan already exists — `allWavesMerged` computes the trigger,
`/plot-deliver` performs the transition, `plot-reap.sh` clears the desks. What is
missing is the wire between them, and while it is missing the estate grows until
a 90-second scan cannot walk it.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A board that measures
`deliverable`, renders it, and then waits for someone to notice is telling the
truth and doing nothing with it. The estate it fails to clear is what eventually
stops it telling the truth at all.

### Interrogated 2026-08-27, before approval

Reviewing this plan against the code found a gap that would have surfaced
mid-implementation.

**The board never writes a plan file, and there is no `plot-deliver.sh`.**
`approve.ts` shells out to `plot-approve.sh`; the repo's rule is that the board
wraps scripts and never invents a lifecycle transition. But delivery has no
script — it lives in `/plot-deliver`'s prose. This plan asked the board to
deliver, which is a caller with nothing safe to call, and an implementer reaching
that point would have rebuilt the phase flip, the record and the symlink move in
TypeScript.

So the extraction became its own wave, ordered first: one implementation, two
entrances, exactly as `plot-approve.sh` was split out. `Extracted` changes no
behaviour and `Done when` item 9 pins that.

**And Approve has two modes this plan had not considered** — direct, or via an
agent when an `Approve command` is set. Delivery mirrors it with a `Deliver
command` key: direct by default and asserted, with the agent path available to a
project that wants its own checks interposed.

Three waves now, and only `Landed` is independent — it fixes the `--limit 1`
reaper bug and needs nothing from the others.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "The board may not write plan files and plot-deliver.sh does not exist \u2014 how?", "a": "Extract plot-deliver.sh as its own wave first, mirroring the plot-approve.sh split; one implementation, two entrances", "category": "technical"},
    {"q": "Which of Approve's two modes should auto-deliver use?", "a": "Mirror Approve: direct by default, agent when a Deliver command key is set", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
