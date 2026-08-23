# A draft plan claims no approvals

> A wave head on an unapproved plan reads *work landed — waiting to be merged* and *2 to approve*. Nothing landed, nothing is approvable, and every row beneath it says so.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** same branch

## Changelog

- A wave head no longer reports work as landed or awaiting approval on a plan that is still a draft. The head's sentence is derived from the wave's own state instead of from a fallback that assumed one.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (groupedNote and the waveNote ternary). Rebuild the artifact. -->

## Motivation

Measured on the live board, 2026-08-23. `a-dispatch-hands-over-a-brief` renders
in WAITING ON YOU:

```
▼ PLAN  a-dispatch-hands-…  (3)                              Discovery
    WAVE  Gated        bug/a-dispatch-without-a-brief-refuses    open
          "plan not approved yet — still in review"
  ▼ WAVE  Handed over  work landed — waiting to be merged    2 to approve
```

**The payload contains none of that.** All three rows:

```
wave=Gated        state=open  verdict=eligible  phase=Discovery  "plan not approved yet — still in review"
wave=Handed over  state=open  verdict=blocked   phase=Discovery  "plan not approved yet — still in review"
wave=Handed over  state=open  verdict=blocked   phase=Discovery  "plan not approved yet — still in review"
```

And the plan file agrees: `phase: draft`, `approved_raw: ''`, no `Started:`
records, no claims. **There is no partial-approval state in Plot** — a plan is
Draft or Approved — so nothing here is approvable.

**Nothing landed either, and the branches do not exist.** Checked on the host
and on the remote, 2026-08-23:

```
bug/a-dispatch-without-a-brief-refuses   PR: none   remote ref: absent
feature/the-board-asks-for-a-brief       PR: none   remote ref: absent
feature/implement-runs-from-the-board    PR: none   remote ref: absent
```

No pull request was ever opened, no ref was ever pushed, and nobody merged
anything. *work landed — waiting to be merged* is false in **every** part: no
work, no landing, and no merge to wait for. The branches are names in a draft
plan's `## Branches` section and nothing else yet.

The server is right. The renderer invents both sentences, and only on the
**wave head**: the two child rows underneath it report `open` correctly.

## Design

### Where it comes from

`groupedNote` (`AgentList.tsx:753`) answers by a single word, and its fallback
is a claim:

```ts
export function groupedNote(word: string | undefined): string {
  switch (word) {
    case 'delivered': return 'landed — nothing left in it';
    case 'stalled': return 'nothing has moved here for a while';
    default: return 'work landed — waiting to be merged';   // ← any other word
  }
}
```

**The `default` is not a default; it is a third case wearing a fallback's
clothes.** Any word the switch does not recognise — including no word at all —
produces *work landed*. For a wave of open branches on a draft plan that is
false in both halves.

The call site (`AgentList.tsx:4914`) then keeps the verdict from correcting it:

```ts
soleRow ? soleNote
  : groupedCount !== undefined ? groupedNote(groupedWord)   // ← short-circuits here
  : group.verdict === 'eligible' ? 'approved — nobody has taken it'
    : group.verdict === 'blocked' ? 'an earlier wave has to land first'
      : '';
```

`Handed over` has two branches, so `groupedCount` is defined and the chain stops
at the second arm. The `blocked` case below it — which describes this wave
exactly, *an earlier wave has to land first* — is unreachable for any
multi-branch wave.

**This is the same ternary that carried the `soleRow` defect fixed in #325.**
That fix corrected the first arm's guard; this is the second arm, and it was not
examined. Worth stating plainly: *a fix is not finished when the reported
instance stops* — a sentence this file already contains, four hundred lines
above, about a different instance of the same habit.

### When it fires — measured, and it is not rare

**The sentence exists only in the renderer.** It is in no payload field: the
three branches under `a-folded-row-still-says-what-matters :: Folded` all carry
`note: "plan not approved yet — still in review"` and `verdict: blocked`. The
head above them synthesises the claim.

**The trigger is exact: a wave with MORE THAN ONE branch.** `groupedCount` is
defined only for a grouped head, so the ternary short-circuits there and
`groupedNote` runs with a word it does not know:

```
soleRow ? soleNote
  : groupedCount !== undefined ? groupedNote(groupedWord)   ← taken for any multi-branch wave
  : group.verdict === 'blocked' ? 'an earlier wave has to land first'   ← unreachable
```

Measured on the live board 2026-08-23 — **five waves reproduce it**, and every
one has a verdict of **`blocked`**:

```
a-dispatch-hands-over-a-brief    Handed over    2 branches, all blocked
a-folded-row-still-says-what-...  Folded        3 branches, all blocked
the-budget-is-spent-where-...     Spent well    2 branches, all blocked
the-wave-is-a-thing-the-board...  Consumed      4 branches, all blocked
opus5-longhorizon-hardening       Implementation 5 branches, all blocked
```

**So the head claims work landed on five waves whose own verdict says blocked** —
and the arm that would have said *an earlier wave has to land first* sits two
lines below, unreachable for every one of them.

`a-folded-row-still-says-what-matters :: Folded` is the clearest: three branches,
none with a PR, on a plan that is still a Draft, under a head reading *work
landed — waiting to be merged*.

### The fix

**A note is derived, never defaulted into.** `groupedNote` answers only for
words it knows and returns `''` otherwise, letting the call site fall through to
the verdict — which is the value that actually describes an unstarted wave.

The ternary then reads in the order the questions are asked: does one branch
speak for this wave, does a known aggregate word describe it, and otherwise what
does the wave's own verdict say.

**Absent is not false, and here it was worse than false**: absent became a
positive claim about work that does not exist. That is the rule this estate
keeps re-learning, and a `default:` branch returning a sentence is one of its
disguises.

### What must not be done instead

**Do not special-case the draft phase.** Checking `phase === 'Discovery'` before
printing the sentence would silence this instance and leave the fallback wrong
for every other unrecognised word — the next occurrence would look like a new
bug. The defect is *a fallback that asserts*, not *drafts specifically*.

### Open Questions

- [ ] Are there other `default:` arms in this file that return a claim rather
      than an absence? Worth one grep before implementing, since the habit is
      what produced this and it will have produced others.

## Done when

- A wave whose branches have **no PR and no remote ref** never reports work as
  landed or merged. That is the live shape here, and it is the strongest form of
  the assertion: the claim was made about branches that do not exist.
- **All five live cases render their verdict.** `Folded`, `Handed over`,
  `Spent well`, `Consumed` and `Implementation` each have >1 branch and a
  `blocked` verdict, and each must read *an earlier wave has to land first*. That
  is the whole population today; a fix verified on one of them is verified on the
  shape, not on an instance.
- A wave of open branches on a **draft** plan reports what its verdict says
  (`an earlier wave has to land first` for `blocked`), never *work landed*.
  Asserted on the live shape: `a-dispatch-hands-over-a-brief` / `Handed over`,
  two branches, `verdict=blocked`, `phase=Discovery`.
- `groupedNote` returns `''` for an unknown word, asserted directly — an
  implementation that keeps the sentence and adds a phase check passes the test
  above and leaves the defect.
- The two known words still answer as they do today (`delivered`, `stalled`) —
  the fix must not silence the aggregate where it was right.
- A **multi-branch** wave can reach the verdict arms of the ternary at all,
  asserted for both `eligible` and `blocked`. That path is currently dead for
  every wave with more than one branch, and a test that only checks the
  single-branch case cannot detect it.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Derived

- `bug/a-wave-head-says-what-its-verdict-says` — `groupedNote` answers only for words it knows; the ternary falls through to the verdict for everything else

## Notes

Reported from the running board, 2026-08-23: *"How can that happen in WAITING ON
YOU?"*, followed by *"is the plan partially approved?"* — the right thing to rule
out, and ruled out: the plan file reads `Phase: Draft` with an empty
`Approved:`, and Plot has no partial-approval state.

The rows were checked against `/api/fleet` before the renderer was blamed. The
server's answer is correct and consistent across all three rows; the two
sentences exist only in the head.

`2 to approve` is the same shape and was not separately traced — it counts the
wave's branches and labels them approvable, on a plan nobody may approve yet.
The implementer should confirm it falls out of the same fix rather than assuming
it does.
