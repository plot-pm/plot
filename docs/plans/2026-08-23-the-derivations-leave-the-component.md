# The derivations leave the component

> `AgentList.tsx` is 8104 lines and 90 exports, and every one of the last 60 commits to it touched it. Four of eight currently-claimable branches want this one file, so the fleet serialises on a component that is mostly not a component.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The row derivations move out of `AgentList.tsx` into their own module, so branches that change what a row *says* no longer collide with branches that change how it *renders*.

<!-- Board impact: pure refactor. Moves code out of
     packages/board/src/app/components/AgentList.tsx into a new module and
     updates 14 importing files. No behaviour change, no contract change, no
     plan-format change. Rebuild the artifact. -->

## Motivation

Measured 2026-08-23:

```
AgentList.tsx                                   8104 lines
exports                                           90
  of which pure helpers (no JSX, no hooks)        65
React components                                  18
files importing from it                           14   (13 of them tests)
of the last 60 commits touching it                60   ← all of them
```

**Every commit to this file is a commit to this file.** There is no subset a
branch can own, so contention is structural rather than unlucky.

### What it cost today, specifically

- Four of eight currently-claimable branches name `AgentList.tsx`. Three were
  held back rather than dispatched.
- **#339's rebase conflicted on `groupedNote`** — a pure function with no JSX in
  it — because it lives in the same file as the wave rendering. Resolving it took
  a hand-written merge of two docstrings and two implementations.
- The same rebase produced a **broken splice** that reported as *"1 file failed,
  1944 tests passed"*: an unterminated template literal, not a failing test. It
  survived a full suite run and was only caught by re-running one file.

None of that is about the code being wrong. It is about one file being the only
place to put anything.

### Why the pure half is the right cut

The first component (`ActivityMark`) starts at line 3009. Everything above it is
derivation: `prNote`, `isFinished`, `rowKey`, `groupedNote`, `waveDissent`,
`statusTone` callers, the classifiers.

**Verified rather than assumed.** A first reading called that region "JSX-free",
and grep disagreed: 25 JSX-looking hits and 10 hook uses before 3009. Reading
them showed the hits are `<AgentRow` **generic type parameters** — `Pick<AgentRow,
…>` — not markup, and only **one** genuine React construct is up there:
`useChangeMarks` (~line 2691).

So the cut is real but it is not the line number. It is *derivations*, minus the
one hook that has to stay behind.

## Design

### One move, not a redesign

`AgentList.tsx` keeps its 18 components and its shell. The derivations move to
`packages/board/src/app/lib/agent-rows.ts`, beside the existing `tuple-row.ts`
and `filters.ts` — the directory that already holds this kind of code.

**`useChangeMarks` stays in the component file.** It is a hook; it belongs with
the components that call it. Do not move it to keep a line-number boundary tidy.

### Nothing changes except where the code lives

- **No behaviour change.** No function is rewritten, renamed, merged, or split.
- **No signature change.** If a helper's shape is wrong, that is a different
  plan.
- **Re-export from `AgentList.tsx`** so the 14 importing files keep working, or
  update all 14 — decide once and do it consistently. Prefer updating the
  imports: a re-export leaves the file named as the source of things it no longer
  holds.

### The docstrings travel with the code

**This is the constraint that makes the refactor worth reviewing.** Several
docstrings in this file record measured failures, and they are the reason the
code is shaped the way it is:

- `groupedNote`'s: the default asserted *work landed — waiting to be merged* over
  five live blocked waves whose branches had never been touched.
- `kind`'s: *"a derivation is a guess with a rule attached"* — set where the row
  is created, because the server is the only place that knows why it exists.
- `rowKey`'s and the activity-mark ordering, each with its own measurement.

A move that drops or scatters these loses reasoning this repo has paid for more
than once. **Every docstring moves with its function, intact.**

### Sequencing is the risk, not the mechanics

The move itself is mechanical. What makes it dangerous is that it touches the
file four branches want.

**It must land when no branch holding `AgentList.tsx` is in flight.** A rebase
across an 8000-line file that has just been halved is not a rebase anyone should
be asked to do. The correct order:

1. let the `AgentList.tsx` branches in flight land;
2. do this move, alone, in one PR;
3. dispatch the held-back branches onto the smaller file.

### Not chosen: split the components too

`PlanRow` / `WaveRow` / `Row` / the menus are the obvious second cut, and they
are the harder one — they share props, helpers and rendering conventions.
Rejected **for this plan**: doing both at once produces a diff nobody can review
against a behaviour-preservation claim. The derivations move is independently
valuable and independently verifiable.

Revisit once this has landed and the contention is measured again.

### Not chosen: move only the contended functions

`groupedNote` and `waveDissent` caused today's conflict, so moving just those is
tempting. Rejected: it fixes the collision that already happened rather than the
one that will, and it leaves a file that is 8000 lines for no stated reason.

### Open Questions

- [ ] Does `agent-rows.ts` want to be one module or several
      (`derive.ts` / `classify.ts` / `notes.ts`)? 65 exports in one file is
      better than 90 in an 8000-line one, and still large. Prefer one module for
      this move — a second split is easier to argue once the first has landed.
- [ ] Should the 13 test files import from the new module directly, or keep
      importing from `AgentList.tsx`? Directly is honest; it is also 13 more
      files in the diff. Decide before starting, not per-file.

## Done when

- `AgentList.tsx` no longer holds the derivations, and is **materially smaller**
  — state the before and after line counts in the PR body.
- **`pnpm run test:board` is green with no test file edited except its imports.**
  This is the assertion that makes it a refactor: any change to a test's
  *expectations* means behaviour moved, and the move is then wrong.
- Every moved function keeps its docstring, verbatim. Asserted by review, and by
  a diff that shows moves rather than rewrites.
- `useChangeMarks` is still in `AgentList.tsx`.
- No export disappears: the 90 exports are still reachable, from wherever they
  now live. A consumer that stops compiling is a finding, not a fix-up.
- `pnpm run typecheck` clean; `pnpm build:board` run and the artifact committed.

## Branches

### Moved

- `infra/the-derivations-leave-the-component` — move the 65 pure derivations from `AgentList.tsx` to `app/lib/agent-rows.ts` with their docstrings intact, update the 14 importing files, and change no behaviour

## Notes

Asked for 2026-08-23 as *"refactor AgentList.tsx to reduce the bottleneck"*,
after a session in which the file blocked three dispatches and produced two
separate rebase incidents.

The measurement that justifies it is not the line count — it is that **all 60 of
the last 60 commits to the file touched the file**. A file with no divisible
surface cannot be worked on by two branches, and this fleet routinely wants four.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Is the region above the first component actually pure?", "a": "Not quite - grep showed 25 JSX hits and 10 hook uses. Reading them: the hits are <AgentRow generic type parameters, not markup, and only useChangeMarks is a real hook. The cut is derivations, not a line number", "category": "technical"},
    {"q": "Split the components too?", "a": "No - they share props and conventions, and doing both produces a diff nobody can review against a behaviour-preservation claim", "category": "tradeOffs"},
    {"q": "Move only the functions that actually collided?", "a": "No - fixes the collision that happened rather than the one that will, and leaves 8000 lines for no stated reason", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
