# The derivations leave the component, by subject

> `AgentList.tsx` is 8104 lines and 90 exports, and every one of the last 60 commits to it touched it. Four of eight currently-claimable branches want this one file. One module would end the serialisation; several cohesive ones end the *accidental* collisions too — two branches on unrelated subjects should not meet at all.

## Status

- **Phase:** Approved
- **Type:** infra
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `infra/the-derivations-leave-the-component`
- **Started:** 2026-08-23, Jan Wloka, `infra/the-components-leave-the-shell`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The row derivations move out of `AgentList.tsx` into modules grouped by subject, so two branches working on unrelated things no longer edit the same file.

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

### The modules follow the churn, not a taxonomy

Where the last 40 commits actually landed:

```
lines     0- 999   32 hunks
lines  1000-1999   15
lines  2000-2999    9
lines  3000-3999    5
lines  4000-4999   21
lines  5000-5999   13
```

Two hot regions: the derivations (0–3000, **56 hunks**) and the row components
(4000–6000, **34**). The subjects inside the first are already legible from the
export names, and they are what the modules should be:

| module | subject | ~lines |
|---|---|---|
| `host-notes.ts` | what the host and its PRs can say — `hostAnswer`, `prNote`, `issueNote`, `machineNote` | 268 |
| `collapse.ts` | what is folded, and remembered — `readCollapsed`, `isCollapsible` | 85 |
| `waves.ts` | grouping into waves and describing them — `groupByWave`, `waveDissent`, `groupedNote` | 314 |
| `sections.ts` | which section a row lands in — `waveGroupsFor`, `groupByPlan`, `rowsBySection`, `GROUPS` | ~330 |
| `activity.ts` | motion, change marks, pace — `activeRowKeys`, `activityPace`, `watchedState` | 560 |
| `stuck.ts` | liveness and why a row is stuck — `stuckEvidence`, `stuckWord`, `isLive`, `isActive` | ~320 |
| `row-identity.ts` | what a row IS and how it is keyed — `rowKey`, `isFinished`, `sortByWaiting` | 327 |
| `actions.ts` | what a row offers — `offersAction`, `changedFilesLabel`, `repairWord` | 109 |

**Eight, not six.** A first cut named six and covered only ~1660 of the 3008
derivation lines; measuring the remainder found two more real subjects —
`sections` and `stuck` — rather than a residue. That is the check the plan
demands of itself: a leftover pile means the cut was wrong.

### And the components, because otherwise the largest file barely moves

The derivations are 3008 of 8104 lines. Moving them alone leaves
**`AgentList.tsx` at ~5095 lines** — still the largest file in the package, and
still the file every row, menu and mark branch has to edit. Measured spans:

```
AgentList (shell)  1316      Row            698      RowActions   603
WaveRow             540      ChangeMark     346      PlanRow      279
ActivityMark        222      StuckCell      197      IssueRowActions 152
PlanActions         143      BlockedByMark  115      ResliceMenu   98
WaveActions          96      BranchMenu      64      HeaderRow     60
IssueRowView         58      PlanLink        59      UnpushedMark  50
```

So the components split too, by what they render:

| module | holds | ~lines |
|---|---|---|
| `rows.tsx` | `Row`, `WaveRow`, `PlanRow`, `HeaderRow`, `IssueRowView`, `PlanLink` | ~1690 |
| `menus.tsx` | `RowActions`, `PlanActions`, `WaveActions`, `BranchMenu`, `ResliceMenu`, `IssueRowActions` | ~1160 |
| `marks.tsx` | `ActivityMark`, `UnpushedMark`, `ChangeMark`, `StuckCell`, `BlockedByMark` | ~930 |
| `AgentList.tsx` | the shell only | ~1320 |

**Largest file after: ~1690** (`rows.tsx`), against 8104 today. That is the
number this plan is answerable for, and it is stated here so the claim can be
checked rather than felt.

**This is the whole point of the change.** One module would end the
serialisation — the fleet could at least queue. Six end the *accidental*
collisions: a branch changing wave grouping and a branch changing host notes now
have no file in common, and neither rebases across the other.

Today's evidence that the split is along the right seam: **#339 conflicted on
`groupedNote`** while rewriting wave rendering. Under this cut, `groupedNote` is
in `waves.ts` with the grouping that actually uses it — the conflict would have
been a real one about waves, not an accident of shared residence.

### One move per module, not a redesign

`AgentList.tsx` keeps its 18 components and its shell. The derivations move to
`packages/board/src/app/lib/agent-rows/`, beside the existing `tuple-row.ts` and
`filters.ts` — the directory that already holds this kind of code.

**A function goes where its SUBJECT is, not where its line number was.** The
table above is derived from what the exports are about; if a function does not
fit any of the six, that is a finding worth reporting rather than a seventh
module invented to hold one thing.

**`useChangeMarks` stays in the component file.** It is a hook; it belongs with
the components that call it. Do not move it to keep a line-number boundary tidy.

### Nothing changes except where the code lives

- **No behaviour change.** No function is rewritten, renamed, merged, or split.
- **No signature change.** If a helper's shape is wrong, that is a different
  plan.
- **No re-exports.** All 14 importing files point at the module that owns the
  function. A re-export block would leave `AgentList.tsx` naming every symbol it
  no longer holds — and being edited by every module change, which is the
  contention this plan removes.

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

### The component split is the riskier half, and is treated as such

The derivation modules are pure moves: no JSX, no hooks, no shared render
conventions. The components are not — `Row`, `WaveRow` and `PlanRow` share
props, helpers and idioms, and an earlier draft of this plan rejected splitting
them for exactly that reason.

**It is included because the measurement overruled the caution:** derivations
alone leave a 5095-line file that four branches still queue on, which is most of
the problem left in place.

So the component half carries a stricter rule than the derivation half:

- **Move whole components, never parts of one.** If a component has to be
  divided to fit a module, stop and report it — that is a redesign, not a move.
- **Shared render helpers go to one module and are imported**, never duplicated.
  Two copies of a helper is how the next `groupedNote` conflict gets made.
- **If a component cannot move without editing it, leave it in
  `AgentList.tsx`** and say so in the PR. A shell of 1320 lines plus one awkward
  component is a better outcome than a move that quietly changed behaviour.

### Not chosen: move only the contended functions### Not chosen: move only the contended functions

`groupedNote` and `waveDissent` caused today's conflict, so moving just those is
tempting. Rejected: it fixes the collision that already happened rather than the
one that will, and it leaves a file that is 8000 lines for no stated reason.

### Open Questions

- [x] ~~One module or several?~~ **Several — settled 2026-08-23.** One module
      ends the serialisation; six end the accidental collisions. The subjects
      come from the export names and are listed above.
- [x] ~~One PR or six?~~ **One — settled 2026-08-23.** Six would each edit
      `AgentList.tsx`'s import block and serialise on exactly the file this plan
      exists to unblock, each rebasing across the last.

      **One PR, six commits — one per module.** The diff is large and that is
      accepted: every hunk is a move, the commits are the review unit, and the
      green suite is the claim. A reviewer reads `git log -p` per module rather
      than one 3000-line diff.
- [x] ~~Direct imports, or re-exports from `AgentList.tsx`?~~ **Direct, and no
      re-exports — settled 2026-08-23.**

      Re-exports would have left `AgentList.tsx` naming all 65 symbols in an
      export block, so every module change still edits it and the file stays the
      place branches meet. That reduces line count without reducing contention,
      which is the one thing this plan exists to do.

      Cost accepted: 13 more files in the diff, each a one-line import change.

## Done when

- **One commit per module**, each moving exactly that module's functions and
  nothing else. A commit that touches two modules is a review unit nobody asked
  for; a commit that moves and edits is not a move.
- **No file in `packages/board/src/app` exceeds ~1700 lines.** Asserted by
  counting: this is the number the plan is answerable for, against 8104 today.
- `AgentList.tsx` is a shell of roughly 1320 lines — it holds the top-level
  component and nothing else.
- **Every component moved whole.** A component split across modules, or edited to
  fit one, means the move became a redesign.
- **`AgentList.tsx` re-exports nothing.** Assert by grep: no `export {` block
  forwarding a moved symbol. This is the assertion that separates a real split
  from a line-count reduction — every other assertion here passes with a
  re-export block in place, and so would the whole refactor while changing
  nothing about contention.
- **Each module is about one subject**, and its name says which. A module that
  ends up holding "the rest" means the cut was wrong — report it rather than
  shipping a `misc.ts`.
- **No module imports another** except where a genuine dependency exists, and any
  such import is named in the PR body. Six modules that all import each other are
  one module with extra files, and would not reduce collisions at all.
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

- `infra/the-derivations-leave-the-component` — move the derivations into eight subject modules under `app/lib/agent-rows/`, docstrings intact, no re-exports, and update the 14 importing files → #357

### Rendered

- `infra/the-components-leave-the-shell` — move the 18 components into `rows.tsx`, `menus.tsx` and `marks.tsx`, whole components only, leaving `AgentList.tsx` as a ~1320-line shell; largest file in the package drops to ~1690

## Notes

Asked for 2026-08-23 as *"refactor AgentList.tsx to reduce the bottleneck"*,
after a session in which the file blocked three dispatches and produced two
separate rebase incidents.

The measurement that justifies it is not the line count — it is that **all 60 of
the last 60 commits to the file touched the file**. A file with no divisible
surface cannot be worked on by two branches, and this fleet routinely wants four.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 5,
  "questionHistory": [
    {"q": "Is the region above the first component actually pure?", "a": "Not quite - grep showed 25 JSX hits and 10 hook uses. Reading them: the hits are <AgentRow generic type parameters, not markup, and only useChangeMarks is a real hook. The cut is derivations, not a line number", "category": "technical"},
    {"q": "One derivations module, or several by subject?", "a": "SEVERAL - operator call. One ends the serialisation; six end the ACCIDENTAL collisions, so two branches on unrelated subjects share no file. Subjects taken from export names: host-notes, collapse, waves, activity, row-identity, actions", "category": "architecture"},
    {"q": "Direct imports or re-exports from AgentList.tsx?", "a": "DIRECT, no re-exports - operator call. A re-export block leaves AgentList.tsx naming all 65 symbols and edited by every module change: line count down, contention unchanged", "category": "implementation"},
    {"q": "How big is the largest file after the refactor?", "a": "Derivations alone left AgentList.tsx at ~5095 - still the largest and still the bottleneck. So the components split too: rows/menus/marks, largest file ~1690 against 8104 today. Also found the six modules covered only 1660 of 3008 lines; the rest were two missed subjects, sections and stuck, making eight", "category": "architecture"},
    {"q": "Six PRs or one?", "a": "ONE - operator call. Six would each edit AgentList.tsx's import block and serialise on the file this unblocks. One PR, six commits, one per module: the commits are the review unit", "category": "implementation"},
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
