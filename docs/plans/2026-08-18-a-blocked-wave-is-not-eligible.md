# A blocked wave is not eligible

> The board invited an operator to take a branch its own wave gate was holding closed. The scan said `blocked`, the server's `waveSummary` said two waves, and the card said "1 wave, first eligible".

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

- A board card reports the wave count and the branch availability its own server already computed, so a blocked branch stops being offered as claimable.

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

- `bug/a-card-does-not-offer-a-blocked-branch` — reproduce the disagreement in a local fixture, then make the card render the wave count and branch availability its server already computed, with a cold pulse rendering as unknown rather than as available. Tests: a two-wave plan whose wave 2 is blocked never renders that branch as claimable; the card's wave count matches `waveSummary`; a card built with no pulse omits availability rather than assuming it; a genuinely eligible first wave is unchanged.

## Notes

Filed by the operator as #227 with the three conflicting outputs captured side
by side, and explicitly titled "cause unconfirmed" — which is why this plan
starts with a reproduction rather than a fix, and why its first open point asks
whether the defect still exists at all.
