Position: amend
Evidence: executed

# EVIDENCE lens — #1045, a sprint item names a plan or says it has none

The disagreement is real, I reproduced it exactly, and the incident account
checks out against git. **But the plan's recommendation is backwards, and the
reason it gives for rejecting the alternative is the opposite of what the code
does.** The plan asks the slice to refute the recommendation; the refutation is
here, and it is decisive.

## What I ran

- Read `plot-sprint-release.sh:230-256` (`emit_tier`, slug regex at `:249`).
- Read `entry/sprint-transition.ts:40-95` (`MEMBER_LINE` at `:73`, and the
  `:69-70` comment the plan quotes).
- Read `entities/sprint.ts:80-130` (`PlanDelivery`, `scoreItem` at `:125`),
  `transitions/sprint.ts:260,326-334` (`openPromises`, `commitment-empty`),
  `workflows/release.ts:172-199` (the Must gate).
- **Reproduced the disagreement** in a scratch script transliterating both
  parsers.
- **Swept all 16 sprint files** for issue-linked items.
- **Ran the corpus tier**: `pnpm test:corpus` → **10 files, 60 tests, all pass,
  504 s**.
- Read `git show f6c7c9ef` and the file's log.

## CONFIRMED — the three-way disagreement reproduces exactly

```
line                                                     | shell | typescript
- [ ] [#1039](…/issues/1039) — **The board watches** …   | ""    | #1039   <-- DISAGREE
- [ ] [a-real-plan-slug](../plans/x.md) — a normal item  | a-real-plan-slug | a-real-plan-slug
- [x] ~~[a-struck-slug]~~ left the sprint                | a-struck-slug | ""   <-- DISAGREE
- [ ] rename the deploy step                             | ""    | ""
```

Shell `""`, TypeScript `"#1039"` — exactly as the plan states. The cause is
mechanical: the shell's regex (`:249`) is
`^(~~)?\[[a-z0-9][a-z0-9-]*\]`, and `#` is not in `[a-z0-9]`, so `[#1039]` does
not match at all. `MEMBER_LINE`'s group is `(?:\[([^\]]+)\]\s*)?` — any bracketed
text — so it captures `#1039`. Both behaviours are deliberate and documented in
place. The plan's "two intentional designs disagree" framing is right.

The incident is also real: `git log` shows `19394785` (W40 goes Active,
21:39-6h) then `f6c7c9ef` *"sprint items name a plan, not an issue — main goes
green"*, whose message states the six-hour window and the same measurement.

## THE RECOMMENDATION IS BACKWARDS

The plan recommends shape 2 and rejects shape 1 with this reasoning:

> **An issue-linked item has no slug, and all three say so.** Simplest. But `""`
> is also what a malformed item reads as … the release gate cannot tell *this
> Must has no plan yet* from *this Must is unparseable*.

and warns of shape 2:

> The gate then has to decide whether an issue-only Must can ever be *done*.

**I read the gate. It already decided, and it decided in favour of shape 1.**

`entities/sprint.ts:103` defines a third `PlanDelivery` value whose docstring
answers the plan's objection directly:

> `'no-plan-named'` the line names no plan, so nothing was looked up.
> **The third value is not "unknown". An item naming no plan is a lightweight
> task with one source of truth, and that is a stated limit rather than a failed
> lookup** — a plan that could not be read would be a different reading with a
> different answer.

So the legal/malformed distinction the plan says shape 1 destroys is **already
modelled**, and `scoreItem` (`:125`) acts on it:

```
if (delivered === 'no-plan-named') return item.checked ? 'done' : 'open';
```

I ran it both ways:

```
SHAPE 1 (no slug -> no-plan-named):
  unchecked -> open   checked -> done      => sprint CLOSEABLE

SHAPE 2 as the TS readers behave TODAY (slug "#1039", looked up in the estate):
  delivered.has("#1039") is always false — no plan file is named "#1039"
  unchecked -> open   checked -> disputed  => sprint UNCLOSEABLE
```

`workflows/release.ts:179` filters `i.status !== 'done' && i.status !== 'withdrawn'`,
so `disputed` is an open Must and `:193` refuses the release. `openPromises`
(`transitions/sprint.ts:326-332`) applies the same rule, and its docstring names
this exact trap:

> Passing `delivered.has('')` would read such an item as an undelivered plan and
> **hold the sprint open on a ticked box.**

**That is precisely what shape 2 does — it just spells the empty slug `#1039`.**
An issue-only Must under shape 2 can never be `done`: ticking it yields
`disputed`, leaving it yields `open`, and both refuse the release. The plan's
feared outcome ("makes the sprint uncloseable") is the property of its own
recommendation, not of shape 1.

Shape 1 is not merely safe — it is the shape the domain was already written for,
and the shell already implements it. It makes the shell authoritative and costs
one regex narrowing on the TypeScript side.

## OPTION 3's W40 CLAIM IS TRUE, BUT THE MECHANISM IS NOT WHERE THE PLAN SAYS

The plan says *"`plot-sprint-state.sh` already refuses nine shapes; a tenth
refuses an item whose first link is not a plan."*

The nine are `RefusalReason` (`transitions/sprint.ts:71-80`):

```
state-unrecognised, state-terminal, state-unreachable, state-unchanged,
commitment-empty, release-unnamed, close-date-missing,
close-date-before-start, precondition-unmet
```

**Every one is about the state transition or the commitment's emptiness. Not one
inspects an item's shape.** `setSprintState` touches `sprint.items` exactly once
— `:260`, `!sprint.items.some(isPromised)`, which reads the **tier**, never
`item.plan`. `item.plan` is read only in `openPromises` (`:328-334`), which is
the release gate, not the write gate.

So a tenth refusal is not "one more in an existing family" — it is the first
refusal of that kind, and it needs a new reading the transition does not
currently take. The plan should say so; as written it makes option 3 sound
cheaper than it is.

The plan's substantive claim about option 3 — that it *would have blocked W40* —
**is true**, and I verified the counter-example is genuine. W40's three Shoulds
(`2026-W40-plot-observes-and-recovers-its-own-fleet.md:34-36`) are real
commitments with no plan: #1039, #1040, #1041, each with a stated reason for
having none (*"needs a decision before it needs a plan"*). A refusal would have
blocked the sprint.

## WHAT EXECUTING REVEALED THAT READING WOULD NOT

**The bug is currently unreproducible from the estate — zero issue-linked items
survive anywhere.** I swept all 16 sprint files with `MEMBER_LINE` and tested
each captured slug against `^#\d+$`:

```
ISSUE-LINKED ITEMS ACROSS ALL 16 SPRINTS: 0
ISSUE-ONLY *MUSTS*: 0
```

And the corpus tier is green: **10 files, 60 tests, 60 passed**.

Two consequences the plan does not draw.

First, **the slice must add its own fixture before it can see the bug**, and the
plan's `Done when` does say so — good. But it must not add one to
`docs/sprints/`: the corpus test reads the real estate, and `f6c7c9ef` is the
commit that emptied it. A fixture placed in the corpus test itself is the only
safe home.

Second, **`expect(struckThrough).toBe(4)` (`sprint-item.corpus.test.ts:268`) is a
pinned count that the fix will move.** The struck-through exclusion exists
because the same two parsers disagree in the *other* direction — shell reads
`a-struck-slug`, TypeScript reads `""`. Narrowing `MEMBER_LINE` to a slug shape
(the shape-1 fix) does not change that, but teaching TypeScript the strike
would. The plan's `Done when` does not mention this pin, and a slice that
touches `MEMBER_LINE` will meet it.

## A CITATION THAT DOES NOT SAY WHAT THE PLAN IMPLIES

The plan quotes `corpus/sprint-item.corpus.test.ts:265` as if it were the source
of the disagreement text. Line 265 is
`expect(found.map(report)).toEqual([])` — the assertion. The quoted string is
runtime failure output from a red run, not a line in the file. Minor, but this
plan's whole argument rests on cited measurements, and a reader following the
citation finds an assertion.

## WHAT THE PLAN MUST SAY BEFORE SOMEONE BUILDS IT

1. **Reverse the recommendation, or justify it against `scoreItem`.** Shape 2
   makes an issue-only Must permanently `disputed` and the sprint uncloseable —
   I ran it. Shape 1's stated flaw does not exist: `PlanDelivery`'s
   `'no-plan-named'` (`entities/sprint.ts:103`) already separates *names no
   plan* from *lookup failed*, and `scoreItem:127` already scores it. If the
   author still wants shape 2, the plan must say what `PlanDelivery` value an
   issue carries and how the gate resolves it.
2. **Correct the option-3 cost.** The nine refusals are all transition-shaped;
   `setSprintState` reads `item.plan` nowhere. A tenth is a new kind of reading,
   not a tenth of the same kind.
3. **Say the estate currently holds zero instances** and the corpus tier is
   green (60/60, measured 2026-09-28). The plan reads as though the bug is live;
   it is latent, and that changes the urgency and the fixture strategy.
4. **Name the `struckThrough` pin at `:268`** as a thing the slice will meet.
5. **Fix the `:265` citation.**

## Position

**amend.** The problem is correctly identified, correctly reproduced, and worth
fixing — an unwritten format rule that cost six hours of red main is exactly
what should get a plan. The plan also does the honest thing in refusing to pick
the shape itself. But it hands the slice a recommendation that the release gate
refutes, and it rejects the shape the domain already implements for a reason the
domain already answered. Amend the Design section to carry `scoreItem`'s
behaviour and the slice can start from a correct premise instead of discovering
it.
