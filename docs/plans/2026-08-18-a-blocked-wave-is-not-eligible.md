# A row belongs to the section that matches what would move it forward

> NOT STARTED means *an agent may take this*. It currently holds a blocked wave, a plan released four months ago, and seven plans whose own dispatcher refuses them — three different reasons a row cannot be started, filed under the one word that says it can.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Sprint:** the-board-tells-the-truth
- **Review:** in-session
- **Impl:** own branches
- **Approved:**
- **Started:**
- **Delivered:**
- **Released:**

## Changelog

- NOT STARTED holds only what an agent may actually claim: a Draft plan waits on approval in WAITING ON YOU, a finished plan appears in neither, and a blocked wave is never offered as eligible.

## Motivation

Reported as issue #227 on 2026-08-18, against a two-wave plan in a Bitbucket
repo. Three sources disagreed at the same moment:

```
board card:              "1 wave, first eligible"
                         "feature/bb-r… — eligible — nobody has taken it"
server waveSummary:      waves: 2
plot-fleet-scan.sh:      Checks — eligible / (wave 2) — blocked
```

**The consequence is not cosmetic.** Wave 2 of that plan exists to be started
*after* wave 1 establishes a cost model — which is exactly what the gate
protects. The board invited someone to start it anyway.

`/plot-dispatch` would have refused, as it refuses every gate the board gets
wrong. That makes this a display defect rather than a correctness one, but only
because a second, independent check happens to cover it — and "no ref" once
again defaulted to *start this*, the reassuring direction.

### The cause is unconfirmed, and that is stated rather than guessed

The issue says so in its own title. Two candidates, neither verified:

- the card reads a **different source** than `waveSummary` — plan-derived wave
  count in one place, git-derived availability in another, and the two
  disagreeing when the pulse is cold or stale;
- the card **collapses** waves, treating a plan's first eligible branch as its
  only one.

The schema comment in `packages/board/src/contract/schema.ts` documents exactly
this split as deliberate: `waves`, `branches` and `deferred` are plan-derived
and true without git; `claimed` and `eligible` come from the fleet pulse and
are **optional**, precisely so that `claimed: 0` and "no pulse yet" do not
render identically. A card that read the optional half as absent rather than
unknown would produce this symptom.

**That is a hypothesis with a named mechanism, not a diagnosis.** The first
task is to reproduce it here, where the plan can be built, rather than in the
repo where it was seen.

### A second case, measured here, with the same shape

Observed on this repo's own board 2026-08-18, and reproducible on demand:

```
plan phase:  Released
branch:      state=deferred  group=not-started  note="no commits"
```

`plot-sprint-support` shipped in v1.0.0-beta.3, four months ago. Its plan reads
`Phase: Released`. The board lists it under **NOT STARTED**, because its single
branch has no commits — the work landed directly on main in February and no
branch was ever created for it.

**The server groups by branch state and never consults the plan's phase.** So a
finished plan is offered as unstarted work, which is the defect
`a-squashed-branch-is-merged-not-open` removed one level lower: there it was a
squash-merged branch with no ref, here it is a plan in its terminal state.

The direction is the reassuring one again — the board says *here is work*
rather than *I cannot place this* — and that is what makes it worth naming
rather than tolerating.

**The rule that is missing:** a plan phase of `Delivered` or `Released`
outranks any branch state. If a plan is finished, none of its branches can be
"not started", whatever the refs say.

### The rule, stated positively

The three cases above are one rule seen from three sides, and it is shorter as
an inclusion than as three exclusions:

**NOT STARTED shows Approved plans, and nothing else.**

That is not a simplification of the phase model — it *is* the phase model.
`Approved` is precisely the phase that means *decided, not yet done*, and it is
the only phase in which `/plot-dispatch` will hand a branch to an agent. Every
other phase fails the section's own question:

| Phase | May an agent take it? | Where it belongs |
|---|---|---|
| Draft | no — waits on approval | WAITING ON YOU |
| **Approved** | **yes** | **NOT STARTED** |
| Delivered | no — work is done | DONE |
| Released | no — shipped | DONE |

Measured on this board 2026-08-18, NOT STARTED held all four:

```
NOT STARTED (10 plans)
  approved   3   ← the only ones /plot-dispatch will start
  draft      7   ← refused with "plan not approved yet"
```

plus `plot-sprint-support`, `Released` since v1.0.0-beta.3 four months ago,
listed because its single branch has no commits — the work landed directly on
main and no branch was ever created.

**The board is grouping by branch state and never asking the plan's phase.**
That is the defect, and it explains all three symptoms at once: a blocked wave,
a finished plan, and seven undecided ones all arrive in the same section
because their branches happen to have no refs.

The phase is not an extra check to add on top. It is the *first* question, and
the branch state only refines the answer within `Approved`.

### The doubled label, and why it is a symptom rather than a fourth bug

The same row renders `Released` twice — once as the plan's column and once
beside its branch:

```
Released  plot-sprint-support
Released  feature/plot-sprint-support  [deferred]  no commits
```

`Released` is a legitimate board column (`board.ts:446`, `phaseDateOf`), so
neither label is invented. The repetition happens only because a Released plan
reached a section that renders both a plan line and a branch line for it — and
in DONE, where the plan belongs, the two never appear stacked.

So fixing the section fixes this. It is recorded because a reader seeing it
should know it was noticed and traced, not tolerated: a label printed twice in
adjacent lines is exactly the kind of detail that looks like a rendering bug
and is really a placement one.

### Blocked belongs in NOT STARTED — visibly blocked

The section's question is *has this work started?*, and a blocked branch has
not. It is unstarted work, and the other sections all answer a different
question: WAITING ON YOU waits on a **person**, WAITING ON A MACHINE waits on a
**machine**, WORKING has an **agent** in it. A branch waiting on another wave
has none of those.

Moving it elsewhere would also tear a plan apart. A plan's waves are its shape,
and seeing `wave 2 — blocked` beside `wave 1 — eligible` is how a reader learns
the order exists. Filing wave 2 in a different section hides the ordering that
the gate is enforcing.

**So the fix is not to move blocked rows out. It is to stop rendering them as
claimable.** The two words the board must not confuse:

| Branch state | Section | Rendered as |
|---|---|---|
| `open`, wave eligible | NOT STARTED | *eligible — nobody has taken it* |
| `open`, wave blocked | NOT STARTED | *blocked — waits on `<wave>`* |
| `claimed` | WORKING | the agent holding it |
| `merged` | DONE | — |

The schema already carries what the third column needs: `blockedBy` exists
(`schema.ts:1291`) and is populated by the scan. The card is not short of data
— it is not asking for it.

**And the blocker should be reachable, not merely named.** A reader who sees
*blocked — waits on `feature/x`* has one question next: how far is `feature/x`?
Answering it today means leaving the board. The blocker's address is already in
the same pulse — its PR if it has one, its branch if it has commits — so the
link costs a lookup the board has already done.

Measured while writing this: `blockedBy` came back `null` for every row,
because the scan the board runs had timed out. The field is designed and
populated; whether it survives a working scan is the first thing the branch
must check.

### Why it could not be reproduced when reported

The plan involved lives in another repository (`ekzweb`), so the reporter's
board and this one do not share the artefact. A local reproduction — a
two-wave plan whose wave 2 is genuinely blocked, rendered with a cold pulse and
with a warm one — is what turns this from a report into a fix.

## Design

### Approach

**Reproduce first, then fix the source that lied.**

The board has three facts about a wave and they must agree: how many waves the
plan declares, which wave is current, and whether that wave's branches may be
claimed. Where they disagree, the card must render the *more restrictive*
answer — a branch shown as blocked that is actually free costs a question; a
branch shown as claimable that is blocked costs a wasted dispatch and a gate
refusal the operator did not expect.

**A cold pulse must say so.** The schema already carries the distinction as
optional fields; the card must render "not known yet" rather than substituting
availability it never received. That rule shipped for the board's own rows in
`2026-08-18-not-yet-asked-is-not-nothing` and applies unchanged here.

### What must not change

**The plan-derived half stays plan-derived.** Wave count and branch list are
true whether or not git can be read, and that is what keeps a card rendering
when the fleet cache is cold. The fix is in how the two halves are combined,
not in collapsing them into one source.

### Open Points

- [ ] Does the defect survive today's fixes? `#217` (enumeration from the ref)
      and `#222` (pruning stale refs) both changed what the scan reports about
      branch availability, and both landed after this was seen. **Reproduce
      before building** — this plan may already be fixed.
- [ ] Is the card's wave count taken from `waveSummary` or recomputed? If
      recomputed, that is the defect and the fix is deletion.
- [ ] Should the card show *why* a wave is blocked — naming the wave it waits
      on? `a-wave-says-what-it-waits-for` (PR #197, open) covers adjacent
      ground and may already answer this.

## Branches

- `bug/not-started-shows-approved-plans` — the section is filtered on the plan's phase first: `Approved` and nothing else. A `Draft` plan moves to WAITING ON YOU with what it waits on named (approval); `Delivered` and `Released` plans appear in neither. Measured on the live board: 10 plans in NOT STARTED, of which 3 were Approved, 7 Draft, plus one Released since v1.0.0-beta.3. Tests: each of the four phases lands in its documented section, driven from one fixture; the phase is read from the plan and never inferred from the branches; a plan that becomes Approved changes section on the next pulse without a restart.

- `bug/a-blocked-branch-says-it-is-blocked` — within NOT STARTED, a branch whose wave is blocked renders as blocked and **links to what it waits on**, using the `blockedBy` the schema already carries; only an eligible branch reads *"eligible — nobody has taken it"*. Merged branches do not appear as rows of an unstarted plan.

  **The link points at the blocker, and what that is depends on how far it got.** A wave is blocked by specific branches, and each of those has a most useful address: an open PR links to the PR, a branch with commits and no PR links to the branch, and a branch nobody has started has no address at all — it is a name in a plan, and the honest rendering is its name as text. The same rule the PR cell already follows (`AgentList.tsx:3708-3722`): a host that reported no address renders text, never an invented link.

  Tests: a blocked branch never renders as claimable and names its blocker; a blocker with an open PR links to that PR; one with commits but no PR links to the branch; one never started renders as text with no anchor; `blockedBy` absent renders as blocked without a name rather than as eligible; an eligible branch is unchanged.

## Notes

Filed by the operator as #227 with the three conflicting outputs captured side
by side, and explicitly titled "cause unconfirmed" — which is why this plan
starts with a reproduction rather than a fix, and why its first open point asks
whether the defect still exists at all.
