# A plan has a phase and a status

> Every entity on this board carries a measured status. The plan carries a decided one — and nothing else. So *"all its work has landed"* is a fact about a plan with nowhere to live, and it has been squeezed into `phase`, the one field that must never be derived.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan now reports both what a person decided about it (`phase`) and what its branches measure (`status`), so *every wave has landed* is a fact the board can state without pretending someone delivered it.

<!-- Board impact: contract + server. Adds a derived field to the plan row in
     packages/board/src/contract/schema.ts and derives it in src/server/fleet.ts.
     The plan FILE FORMAT does not change — nothing new is written to disk, and
     plot-plan-meta.sh is untouched. Rebuild the artifact. -->

## Motivation

The domain model gives every entity a status and names its owner:

| entity | status | kind |
|---|---|---|
| wave | `verdict` | **measurement** — derived every scan |
| branch | `state` | measurement |
| PR | `state` | measurement |
| worklog | `worker` | measurement |
| **plan** | **`phase`** | **decision** — written by a human |

**The plan is the only entity with no measured status**, and the model states the
consequence:

> merging the last branch of the last wave changes **nothing** about the plan.
> The plan sits at `Approved` with every wave `complete` until somebody runs
> `/plot-deliver`. **A measurement cannot make a commitment.**

That is right, and it is not the defect. The defect is that the measurement
*"every wave of this plan is complete"* is real, is useful, and **has nowhere to
be recorded** — so it gets pushed into the one field that must not carry it.

### Measured, 2026-08-23

Of the 19 plans in the current sprint:

```
delivered (phase caught up)        1
ALL WAVES MERGED, phase Approved   5   ← a measurement with no home
some waves merged                  2
nothing started                   11
```

**Five plans whose every branch has landed still read `Approved`.** Every
consumer that asks *is this done?* gets a different answer depending on which
fact it happens to read:

- the release gate reads `phase` → all five are unfinished
- a branch-based counter reads git → all five are done
- `plot-sprint-release.sh` reported `MUST: 8 open` while branch truth was
  `2 done, 2 partial, 1 open`

None of those is wrong. They are answering **two different questions with one
word**.

### Where it has already leaked

`rowPhase`'s own docstring shows the pressure. The board phase is *already* a
composition — plan phase **plus git state** — rather than a mapping of the
plan's field:

> Which board phase a ROW is in — **from the PAIR, never from the plan file
> alone.**

And `feature/merged-waves-reach-testing` (in flight) extends exactly that: *"a
plan whose every wave holds a merged branch **reports** the phase after
Development."* It is careful — it reports rather than writes, and it derives on
the server — but it makes `phase` carry a measurement in the payload while the
same word means a decision in the file.

**One word, two kinds of fact, and the seam is already load-bearing.** That is
the thing to name before more is built on it.

## Design

### Two fields, two owners

```
plan.phase    Approved       ← DECISION.    Written by a human, in the file.
plan.status   deliverable    ← MEASUREMENT. Derived from waves, stored nowhere.
```

`phase` is **completely unchanged**: same values, same file, same commands, same
release gate. Nothing that reads it today reads anything different.

`status` is new, derived every scan from the plan's own waves:

**The eight values, and what each is measured from:**

| `status` | measured from | phase it can occur in |
|---|---|---|
| `draft` | plan exists, not approved, no branch pushed | Discovery |
| `open` | approved, no branch claimed — waiting for an agent | Development |
| `approved` | the approval record exists and nothing has started | Discovery → Development |
| `in-progress` | at least one branch claimed or pushed, not all merged | Design, Development |
| `reviewing` | every branch has an **open, non-draft PR**, none merged | Development |
| `deliverable` | **every** wave complete, `phase` not yet Testing | Development |
| `delivered` | `phase` is Testing — the decision followed | Testing |
| `released` | `phase` is Released | Released |

**Three of these are echoes of the phase, deliberately.** `draft`, `delivered`
and `released` restate a decision rather than measuring anything new. They are
kept so a single field can be rendered without the reader also holding `phase` —
but they must be *derived from* `phase`, never able to disagree with it.

**`reviewing` is the one that needs a host call.** Branch state
(`open · wip · merged · claimed · deferred`) does not distinguish *pushed* from
*in review*; only a PR's `state`/`draft` pair does, and the scan already fetches
those in `pr-list`. If that turns out to be unavailable on a given host, the
honest degradation is `in-progress` — **never** a guessed `reviewing`.

**`open` vs `approved` is a genuine question, flagged rather than settled.** Both
mean *approved and nothing started*; `open` reads as available-to-claim and
`approved` as the record existing. Two names for one measurement is one too
many. See Open Questions.

### Never stored, and that is the point

`status` is re-derived every scan, exactly like `verdict`. Storing it would
create a second source of truth for something git already answers, and it would
be able to go stale — which is the failure `phase` already has and that this
field exists to compensate for, not to reproduce.

The model's own table is the specification to match:

| | measurement | decision |
|---|---|---|
| written by | nobody — derived | a human, via a command |
| changes | every scan | at a lifecycle event |
| storage | none; re-derived | recorded in the plan file |
| can be wrong by | a stale scan | nobody having run the command |

### `deliverable` is the one that earns the field

The other three states are conveniences — a caller could compute them. Only
`deliverable` names something no single existing field can express: **the
measurement has arrived and the decision has not.** It is a queue of decisions
waiting for a person, and today it is invisible.

That is what DONE should hold and what the plan row's `Deliver` action should
appear on — both specified in `done-means-delivered`, which currently has to
infer this state instead of reading it.

### What must NOT change

- **The plan file format.** Nothing new is written to disk;
  `plot-plan-meta.sh` is untouched. This is a derived payload field, not a
  contract change to plans.
- **`phase`'s meaning, values, or writers.** `/plot-approve`, `/plot-deliver`
  and `/plot-release` are the only things that move it, and they still are.
- **The release gate.** It reads `phase` and must continue to: a release is a
  decision, and gating it on a measurement would let work ship that nobody
  signed off. **`status: deliverable` must never satisfy a gate.**
- **`verdict`.** A wave keeps its own status; `status` is the plan-level
  aggregate of them, not a replacement.

### Not chosen: a fifth phase

Adding `Deliverable` between Approved and Delivered was the obvious move and is
wrong: a phase is *written*, so it could only ever be as current as the last
person to run a command — which is precisely the staleness this fixes. The
moment a branch merges, the fact is true; no phase can be.

### Not chosen: let `phase` be derived when it is unambiguous

Tempting, and it is roughly what the board does today. Rejected: it makes one
field sometimes-a-decision and sometimes-a-measurement, so no reader can know
which they hold. The model's whole distinction collapses.

### The phase vocabulary this assumes

The five phases are **Discovery · Design · Development · Testing · Released**.

`Endgame` is the current name for Testing in
`packages/board/src/contract/schema.ts:142` and `:534`. Renaming it is
**`feature/the-phase-after-development-is-testing`**, the fourth wave of
`done-means-delivered` — not this branch. This plan uses *Testing* throughout
because that is the settled name; if it lands first, the rename wave has one
fewer site to change, and if it lands second, nothing here needs revisiting.

**Do not rename it here.** Two branches renaming one enum value is a conflict
for no gain.

### Open Questions

- [ ] **`open` vs `approved` name the same measurement** — approved, nothing
      started. Two values for one state means every consumer must handle both
      and no reader can tell them apart. Pick one: `open` reads as
      *available to claim*, which is what the board offers a Start button for;
      `approved` restates the phase. Recommend `open`, decide deliberately.
- [ ] Should `reviewing` require **every** branch to have an open PR, or *any*?
      Every is stricter and matches `deliverable`'s shape; any would surface the
      state sooner on a multi-branch wave. Every, unless a measurement says
      otherwise.

- [ ] Does `feature/merged-waves-reach-testing` (in flight) render this
      unnecessary, or is it the thing that needs correcting? Its wave says it
      *reports* the later phase — server-derived, never written — which is
      honest but overloads `phase`. **Read its PR before implementing**: this
      plan may become "give that derivation its own field" rather than a new
      derivation.
- [ ] Should `status` distinguish **blocked** — no wave complete and none
      eligible, because an earlier wave is unmerged? It is derivable from
      verdicts, and `not-started` currently hides it.

## Done when

- A plan whose every wave is complete and whose `phase` is `Approved` reports
  `status: deliverable`. Asserted against the five real cases in this estate.
- **Every one of the eight values is reachable**, asserted one test each. A
  status nothing can produce is a value that will be read as meaningful and
  never be true — the failure `Discovery` had before Draft mapped to it.
- **`draft`, `delivered` and `released` never disagree with `phase`.** They are
  derived from it; a test that constructs a disagreement must fail.
- The same plan still reports `phase: Approved`. Asserted in the **same** test —
  the two fields must be independently observable, and a test that only checks
  the new one passes an implementation that quietly moved the old.
- A plan with **one** wave open reports `in-progress`, not `deliverable`.
- A **deferred** branch does not block `deliverable`, matching the scan's rule.
- A plan in Testing reports `delivered`, not `deliverable` — the decision has
  caught up.
- **The release gate is byte-identical.** Asserted by running it against a
  `deliverable` plan and getting the same refusal as today. This is the
  assertion that stops a measurement from becoming a commitment.
- `status` appears nowhere on disk. Assert by grep: no plan file gains a field.
- `pnpm test`, `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Measured

- `feature/a-plan-reports-its-status` — the contract gains a derived `status` on the plan row, computed from its waves in the server, with `phase` untouched and the release gate proved unchanged

## Notes

Raised 2026-08-23 by the operator, after a sprint count that could not be stated
honestly: the same 19 plans read "6 done" by branches and "1 done" by phase, and
both readings were correct.

The immediate trigger was DONE and the `Deliver` action — `done-means-delivered`
needs to know which plans are ready to deliver, and has no field that says so.
It infers the state instead. This plan gives that inference a name, so the
action, the section, and the sprint counter all read one field rather than three
re-derivations of it.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Should this be a new phase in the lifecycle?", "a": "No - a phase is written, so it can only be as current as the last command run; the measurement is true the moment a branch merges", "category": "domain"},
    {"q": "Is the plan really the only entity without a measured status?", "a": "Yes - wave/branch/PR/worklog all carry measurements; the plan carries only phase, a decision", "category": "architecture"},
    {"q": "Does the in-flight merged-waves-reach-testing already do this?", "a": "It derives a later BOARD phase without writing - honest, but it overloads `phase` to carry a measurement; open question flags reading its PR first", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
