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

**The seven values, and what each is measured from:**

| `status` | means | measured from |
|---|---|---|
| `draft` | created; discovery is going on | `phase: draft`, no plan PR open |
| `open` | discovery done; working toward approval | plan PR exists (draft or open) — `plot-pr-state.sh` |
| `approved` | development is possible, implementation not started | `phase: approved` **and no `Started:` record** |
| `in-progress` | implementation under way on a branch or wave | ≥1 `Started:` record, or ≥1 branch claimed |
| `deliverable` | all waves reviewed and merged; ready for `/plot-deliver` | every wave complete, `phase` still `approved` |
| `delivered` | reviewed and `/plot-deliver` was called | `phase: delivered` |
| `released` | released; ready for `/plot-reconcile` | `phase: released` |

**`reviewing` is deliberately absent.** An earlier draft proposed it for *every
branch has an open PR, none merged*. It is dropped: a branch under review is
still implementation in flight, and `in-progress` already says so. Naming the
sub-state would need a per-branch host call the scan avoids, and would split one
answer into two that consumers must both handle.

### `approved` and `in-progress` split on a record, not on a guess

This is the pairing that makes the set work, and both halves are observable:

- `plot-plan-meta.sh` parses **`Started:`** — written by `/plot-implement` and
  by dispatch. Present means someone picked the plan up.
- The fleet scan sees a **claim ref** on the remote for the same fact.

So *approved but untouched* and *approved and running* are distinguishable
without inference. `approved` is the queue the Start button serves;
`in-progress` is what dispatch produced.

### `open` is about the PLAN's own PR, not about availability

`open` does **not** mean *available to claim* — that is `approved`. It means the
plan is out for review: discovery finished, a plan PR is up, and approval has not
landed. `plot-pr-state.sh <slug>` answers it directly, and it is the state
`Review: pr` plans sit in between `/plot-idea` and `/plot-approve`.

A plan whose `Review:` is `in-session` never has a plan PR, so it moves from
`draft` to `approved` without passing through `open`. **That is correct, not a
gap:** the review happened, in a session, and left no PR to observe.

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

- [x] ~~`open` vs `approved` name the same measurement?~~ **No — settled
      2026-08-23.** `open` is the PLAN's own PR being up for review; `approved`
      is development possible with nothing started. Different facts, different
      sources.
- [x] ~~Should `reviewing` require every branch or any?~~ **Dropped** — a branch
      under review is implementation in flight, and `in-progress` says so.
- [ ] `released` is described as *ready for `/plot-reconcile`*. Confirm that is
      the intended follow-on: reconcile is a hygiene sweep over the whole
      estate, not a per-plan step, so a plan does not "await" it the way a
      deliverable plan awaits `/plot-deliver`. Possibly the status is terminal
      and the reconcile note is guidance rather than a state.

## Done when

- A plan whose every wave is complete and whose `phase` is `Approved` reports
  `status: deliverable`. Asserted against the five real cases in this estate.
- **Every one of the seven values is reachable**, asserted one test each. A
  status nothing can produce is a value that will be read as meaningful and
  never be true — the failure `Discovery` had before Draft mapped to it.
- **`approved` and `in-progress` split on the `Started:` record.** Asserted with
  two otherwise-identical approved plans, one carrying the record. This is the
  pairing the Start button and the fleet both depend on, and an implementation
  that reads only `phase` collapses them.
- **A plan with `Review: in-session` reaches `approved` without ever reporting
  `open`.** Asserted directly — it has no plan PR to observe, and an
  implementation that treats a missing PR as an error rather than as a legal
  path breaks every in-session plan in the estate.
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
  "round": 3,
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
