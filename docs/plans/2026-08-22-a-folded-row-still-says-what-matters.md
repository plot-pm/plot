# A folded row still says what matters

> WORKING spends four lines and ~150px on each of ten branches. The two levels of folding already exist — what a folded head says does not yet make folding worth doing.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Rounds:** 1

## Changelog

- A folded head names the exceptions beneath it and stays open when it holds
  one, so folding hides repetition and never hides a conflict.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (the fold heads) and src/app/lib/tuple-row.ts (splitBranch). Rebuild the artifact. -->

## Motivation

Measured from the WORKING section, 2026-08-22: **10 branches, ~1500px**, four
lines each — wave label, plan link, note, and often a warning. A reader looking
for *what needs me* scrolls past nine rows to find the tenth.

**The two collapse levels asked for already exist.** `data-wave-toggle` folds a
plan (`AgentList.tsx:4427`); `data-wave-branch-toggle` folds a wave (5203). The
mechanism is not the gap.

**The gap is what a folded head says.** Today a folded plan head shows the plan
name and a bare count — `every-section-has-one-subject (3)`. Three of what? In
what state? A reader who folds loses the answer and unfolds again, so folding
costs a click and returns nothing. That is why the section is rendered open.

### What the fold must not hide

The same screenshot carries **`claimed twice — claimed by 2 plans:
approval-hands-the-work-to-agents, every-section-has-one-subject`** on PR #327.
That is a real estate defect (both plans name
`feature/the-registry-knows-which-agents-live`, and one records it as `Started:`
twice), and the board surfacing it is the board working.

**A fold that hides a conflict is worse than no fold.** This is the constraint
the whole design turns on: folding may hide *repetition*, never *exceptions*.

### RE-MEASURED 2026-08-26: the head already says most of it

**The premise above was true on 2026-08-22 and is not now.** The plan says a
folded head shows *"the plan name and a bare count — `(3)`. Three of what? In
what state?"* Measured against main, `PlanRow` composes its head from four
sources:

| what renders | from | says |
|---|---|---|
| `2 waves, first eligible` | `waveSummaryFor` | how much, **and whether any is startable** |
| `1 wave elsewhere` | `elsewhereNote` | the plan is split across sections |
| `2 rounds` | `roundsBadgeText` | how far interrogation got |
| the phase | slot 5 | lifecycle |

So *"three of what, in what state"* is answered: **count, startability, split
and discovery state**. The density work this plan asked for was done by sibling
work in the intervening days.

**The file references are also stale.** The fold toggles moved out of
`AgentList.tsx` (now 2002 lines, not 5203) into
`packages/board/src/app/lib/agent-rows/rows.tsx` — `data-wave-toggle` at :659,
`data-wave-branch-toggle` at :1362.

### What survives is the constraint the plan turns on

The plan's own rule — **folding may hide repetition, never exceptions** — is the
part nothing has addressed.

Measured: `claimed twice` is produced by `stuck.ts:141` and rendered **on the
branch row**. No plan head aggregates it, and `waveSummaryFor` counts waves
without regard to whether any child is stuck. So a reader who folds a plan
holding a double-claim sees `2 waves, first eligible` and **loses the conflict
entirely** — the exact failure this plan was written to prevent, still live.

That is what the remaining wave is for. The head is no longer uninformative; it
is informative about volume and silent about danger.

## Design

### The target shape already exists — with the wrong content in it

The one-line folded plan row is **already built and already rendering**.
Measured from the same board:

```
▶  PLAN  a-dispatch-hands-…      (3)   Discovery   ⋯
▶  PLAN  a-mock-row-shows-…      (2)   Discovery   ⋯
▶  PLAN  a-startable-wave-says-so      Discovery   ⋯
▶  PLAN  a-wave-is-one-bra…      (3)   Discovery   ⋯
```

Ten rows, one line each, folded. **This is the density being asked for**, and it
is not a thing to build — it is a thing to fill.

What is wrong is the information content. `Discovery` appears on **nine of ten
rows**: a value identical across the set carries no bits, and it occupies the
row's whole status slot. The count `(3)` carries a little. What a reader wants
from a folded row — *is anyone working in there, and does anything need me* —
appears nowhere.

The WORKING screenshot has the opposite failure: every runtime fact (worker
state, PR, note, `claimed twice`) at four lines and ~150px per branch.

**The two are one design at two densities.** The target is the folded row's
shape carrying the open row's facts.

### What a folded head carries

A folded head answers the question its children would have answered, in one
line — replacing the constant phase word, not sitting beside it:

```
▶  PLAN  every-section-has-one-subject   3 branches · 2 waiting on you · 1 claimed twice
▶  PLAN  a-dispatch-hands-over-a-brief   3 branches · 1 working 12m
▶  PLAN  a-startable-wave-says-so        nothing started
```

Three parts, and each earns its place:

- **the count**, which the head already has
- **the tally by attention** — how many of the children need a person. This is
  the fact folding currently destroys.
- **the exceptions, named** — `claimed twice`, `conflicts`, `stalled`. Never a
  count alone: a reader must be able to decide whether to unfold without
  unfolding.

Where a fold holds nothing exceptional, the third part is absent — not `0
problems`, which teaches a reader to stop reading the line.

### The runtime half, and where it comes from

*"Something like this, but with runtime information about the work currently
happening"* — the fold should say what is **live**, not only what is counted.

The board already has this. `registry.ts` resolves an `AgentState` per
dispatched agent — `running`, `waiting`, `stalled`, `finished`, `unknown` —
against a real `kill -0`, batched once per pulse. WORKING renders it today
(`worker waiting on you: TOD…`, `uncommitted work in a local worktree`). None of
it survives folding.

So a folded head names the live states inside it:

| inside the fold | the head says |
|---|---|
| an agent `running` | `1 working 12m` |
| an agent `waiting` (a `PLOT-BLOCKED:` marker) | `1 waiting on you` |
| an agent `stalled` | `1 stalled` — and the fold **renders open** |
| no agent at all | `nothing started` |

**`stalled` is the case that justifies the runtime half.** Measured today: a
dispatched worker exited 0 with no PR and 283 lines of good work uncommitted,
because it ended its turn awaiting a notification that could not arrive. Exit
code 0 — indistinguishable from success from outside the worktree. A fold that
says `3 branches` over that is actively misleading; a fold that says `1 stalled`
is the whole point of the board.

**The age is the freshest child's, not the fold's own.** A plan folded over an
agent that moved 12 minutes ago is 12 minutes old, whatever the plan file's
mtime says. Deriving it from anything else reproduces the defect
`the-pulse-measures-progress-not-elapsed-time` already fixed once.

**`nameList` already does this shape** (`AgentList.tsx:1069`): at most three
names, then `and N more`. Reuse it rather than inventing a second summary
grammar; the argument it was written under — *"a banner that grows without bound
stops being a banner"* — is the same argument here.

### Which level folds by default

**Plans fold; waves within an unfolded plan do not.** A plan is the unit a
reader chooses to care about; a wave is how that plan is sliced, which matters
only once the plan does.

**Exception, and it is the point of the whole plan: a fold containing anything
exceptional renders unfolded.** A `claimed twice` or a `stalled` worker is not
something a reader should have to go looking for. The default is *quiet things
fold, loud things do not*.

### The single-wave case

A plan with one wave should render as **one row**, not a plan head above a
lone wave head above a branch. `the-plan-is-the-wave` (approved, eligible)
already covers exactly this — *"Plans with a single WAVE don't have a WAVE. The
plan is the WAVE."* This plan must not re-implement it; where the two meet, that
plan owns the single-wave collapse and this one owns what a MULTI-child fold
says.

### A defect this exposes, and it is not cosmetic

The branch labels in the screenshot read `f…s-start-work`, `b…s-its-rounds`,
`de-challenged`, `fnt-needs-you`. `splitBranch` keeps a fixed-width **tail** and
clips the **head** — but the head is where `feature/`, `bug/`, `infra/` live, so
the elision destroys the branch's KIND and keeps its middle. `de-challenged` and
`fnt-needs-you` are not readable as branch names at all.

The rationale for tail-keeping is sound and stated: six branches here share
twenty-four characters of prefix, so end-truncation renders them identically.
But the current split is the other extreme. **The prefix is a category, not
noise**: `feature/…` and `bug/…` are what a reader scans for.

This wants the prefix kept, the middle elided, and the tail kept —
`feature/…start-work` rather than `f…s-start-work`. Folded rows make it worse
(less width per row), which is why it belongs here rather than being deferred.

### Open Questions

- [ ] Does the attention tally come from `waitingOn`, or from the row's own
      `group`? These disagree — the plan `a-plan-moves-through-the-sections`
      exists because `waitingOn` was unreachable for whole classes of row.
      Resolve by reading what is true after #325, not before it.
- [ ] Should a fold's state persist per viewer (`localStorage`)? Probably yes,
      but it is view state and this board's stated rule is *view state in the
      URL, convenience in localStorage*. Decide against that rule, not ad hoc.

## Done when

- A folded plan head names its branch count, its attention tally, and any
  exception by name — asserted on rendered text, not on a data attribute.
- The **constant phase word is gone** from the folded row, or has yielded its
  slot. Asserted directly, because an implementation that appends the tally
  beside `Discovery` passes every other test here and buys no width — which is
  the actual complaint.
- A folded head names the live agent states inside it (`working`, `waiting on
  you`, `stalled`), sourced from the registry rather than re-derived. A fold
  over an agent that moved 12 minutes ago reads 12 minutes, not the plan's age.
- A fold containing a **stalled** agent renders open and says `stalled` — the
  exit-0-with-uncommitted-work case measured 2026-08-22, which is invisible from
  outside the worktree and is the reason the runtime half exists.
- A fold holding a `claimed twice`, a conflict, or a stalled worker **renders
  unfolded**. Asserted directly: this is the property the plan exists for, and
  an implementation that folds everything uniformly passes every other test here.
- A fold holding nothing exceptional shows no exception clause — no `0 problems`.
- `splitBranch` keeps the branch's prefix: `feature/x` elides to something a
  reader can still identify as `feature/…`, asserted on the rendered string.
- **The density claim is a measured ratio, not a word.** With the ten-branch
  fixture below, the folded render is at most **40%** of the unfolded height —
  and the 40 is derived rather than chosen: two folded heads against ten rows.
  Assert the ratio, so it fails when folding stops saving space; "materially
  less" is a claim nothing can fail.

### Fixtures are hand-built, because these states are rare

Every assertion here needs a board state the live estate does not hold. Measured
2026-08-23: **WORKING is empty (0 rows)**, there are **0 stalled workers**, and
only 2 rows carry `claimedBy`. The screenshot this plan was written from showed
ten agents running; that moment is gone and will not recur on demand.

So the pulses are **constructed in the test**, as literals:

```ts
const busy = fleet([
  row({ group: 'working', worker: 'running', wave: 'Folded', ... }),
  ...nine more
]);
```

**The cost is stated rather than hidden:** a hand-built fixture is what someone
believes the board produces, not what it produced. Two guards against that:

- every value in the fixture must be one the **live payload has actually
  carried** — checked against `/api/fleet`, never invented
- the fixture is parsed by the **schema**, so one that drifts from the contract
  fails rather than testing a board that cannot exist

A captured pulse was considered and rejected for the density claim specifically:
it needs a moment when ten agents are running, and waiting for one makes the test
unwritable today.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Waves

### Elided (Branch: bug/the-elision-keeps-the-prefix) <!-- deferred: not measured as a live defect 2026-08-26 — re-measure before building -->
- Retired pending measurement. The elision work was scoped from the 2026-08-22
  screenshot; the row has been rebuilt since and no truncation defect was
  observed while re-measuring. Re-open with a measurement rather than on the
  strength of the original one.

### Tallied (Branch: feature/a-folded-head-carries-its-tally) <!-- deferred: delivered by siblings 2026-08-26 — waveSummaryFor + elsewhereNote + rounds already carry count, startability, split and discovery state -->
- Retired. What it asked for renders today; see *RE-MEASURED* above.

### Live (Branch: feature/a-folded-head-says-what-is-live) <!-- deferred: WORKING renders registry agents, not branch rows — re-scope before building -->
- Retired pending re-scope. It asked the head to name the registry's agent
  states inside it, scoped from the WORKING section — and WORKING iterates
  `fleet.agents` through `RegistryRow`, not the branch rows a plan head groups.
  The two may not meet at all, and that has to be established before the work
  is described.

### Loud (Branch: feature/the-loud-things-stay-open, PR #455)
- A folded head **names the exceptions beneath it**, and a fold holding one does
  not default closed. `claimed twice` lives on the branch row and vanishes on
  fold; this is the plan's own rule — hide repetition, never exceptions — and
  the only part of it still unbuilt.

## Approval

- **Assignee:** Jan Wloka

## Notes

Asked as *"collapse this information but still show the most important — two
level collapsing? waves on a single row? plans on a single row?"* The
investigation found both levels already built (`data-wave-toggle`,
`data-wave-branch-toggle`), so the answer is not a new mechanism but a folded
head worth reading.

The single-wave-is-the-plan case belongs to `the-plan-is-the-wave`, already
approved and eligible — deliberately not duplicated here.

The `claimed twice` visible in the same screenshot is a real estate defect, not
a rendering one: `approval-hands-the-work-to-agents` and
`every-section-has-one-subject` both name
`feature/the-registry-knows-which-agents-live`, and the former records it as
`Started:` twice. It needs fixing in the plans, separately from this work — and
it is the reason the fold's exception rule is a hard requirement rather than a
nicety.

### Interrogated 2026-08-26 — three of four waves retired

One round, spent re-measuring the premise. Three of the four branches did not
survive it, and the fourth got sharper.

**The head already says most of what the plan asked for.** `PlanRow` composes it
from `waveSummaryFor` (*"2 waves, first eligible"* — count **and**
startability), `elsewhereNote` (the plan is split), `roundsBadgeText`, and the
phase. The plan's *"a bare count — three of what, in what state?"* is answered.
`Tallied` retired: what it asked for renders today.

**Its file references are stale too** — the fold toggles moved out of
`AgentList.tsx` (2002 lines now, not 5203) into `lib/agent-rows/rows.tsx`. A
worker following the plan's line numbers would have landed nowhere.

**`Elided` retired pending measurement.** The elision work was scoped from a
screenshot taken before the row was rebuilt, and no truncation defect was
observed while re-measuring. It should be re-opened on evidence, not on the
original screenshot.

**`Live` retired pending re-scope.** It asked the head to name the registry's
agent states inside it — but WORKING iterates `fleet.agents` through
`RegistryRow`, while a plan head groups branch rows. The two may not meet, and
that must be established before the work is described.

**What survives is the constraint the whole plan turns on**, and it is untouched:
*folding may hide repetition, never exceptions.* `claimed twice` is produced at
`stuck.ts:141` and rendered on the **branch row**; no head aggregates it. Fold a
plan holding a double-claim and the conflict disappears while the head still
reads *"2 waves, first eligible"*. The head became informative about volume and
stayed silent about danger — which is the more dangerous of the two states the
plan set out to fix.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Does a folded head still show only a bare count?",
      "a": "No — waveSummaryFor, elsewhereNote, rounds and the phase already carry count, startability, split and discovery state; the Tallied wave was retired",
      "category": "technical"
    },
    {
      "q": "What survives the re-measurement?",
      "a": "The exception constraint: claimed twice lives on the branch row in stuck.ts and no head aggregates it, so a fold still hides a conflict",
      "category": "technical"
    },
    {
      "q": "Do the other two branches still hold?",
      "a": "No — Elided was scoped from a pre-rebuild screenshot, and Live targets WORKING which renders registry agents rather than branch rows; both deferred pending measurement",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": true, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
