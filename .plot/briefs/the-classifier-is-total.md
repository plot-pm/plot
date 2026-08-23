## Implementation brief — the-wave-is-a-thing-the-board-can-hold (wave 1: Constrained)

- **Plan (canonical):** `docs/plans/2026-08-23-the-wave-is-a-thing-the-board-can-hold.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `feature/the-classifier-is-total` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

**This is wave 1 of 4, and everything waits on it.** Waves *One row*, *Modelled*
and *Consumed* follow, and `Consumed` holds four branches from three plans. Your
job is to record what the board does **today**, before any of them move it.

### What to build

**An executable test for the eighteen section rules, asserting today's measured
behaviour** — twelve that pass and six that do not.

The rules are stated in `docs/board-domain-model.md` under *Section constraints*
and *The same for WAVES*. **That document is the specification; read it before
writing anything.** It also carries the entities, their relations and the
causality between their statuses, all measured rather than asserted.

Plus the totality half the plan names: enumerate the state cross-product against
`classify` and assert it is **total** (every combination yields a group) and
**stable** (the same combination always yields the same one).

### The decisions the plan settles — do not re-derive them

**The six failing rules are xfails carrying today's NUMBERS, not skips.**

```ts
it('DONE => verdict complete', () => {
  // Fails 60/61 today: every-section-has-one-subject / Inverted.
  // `a-wave-is-one-row` makes this 61/61 — and this test will FAIL when it
  // does, which is the point.
  expect(passing).toBe(60);
});
```

- **Not `it.skip`.** A skipped test is invisible in a green run, and every one of
  the seven defects this release fixes was found by a screenshot rather than by a
  test. A skip makes the rules a document again.
- **Not a truthful red suite.** This repo gates merges on `test:board`, so a red
  suite would stop the sprint landing its own fixes.
- The xfail's cost is known: it can pass for the wrong reason if the **estate**
  changes rather than the code. Guard by asserting the rule's outcome over a
  **fixture** wherever the fixture can carry the case, rather than over a live
  count.

**The eighteen rules and their measured results, 2026-08-23:**

```
NOT STARTED => phase Development          HOLDS  9/9
NOT STARTED => state open                 HOLDS  9/9
NOT STARTED => no PR                      HOLDS  9/9
NOT STARTED => worker elsewhere           HOLDS  9/9
QUIET       => state wip                  HOLDS  6/6
QUIET       => phase Development          HOLDS  6/6
WAITING ON YOU => never merged            HOLDS  30/30
WAITING ON YOU => never complete          HOLDS  30/30
DONE => state merged or deferred          HOLDS  61/61
DONE => verdict complete                  FAILS  60/61
DONE => phase Development or Endgame      FAILS  19/61
DONE => no live worker on finished work   FAILS  58/61
every wave has EXACTLY ONE section        FAILS  81/82
complete => no branch open                HOLDS  47/47
complete => all non-deferred merged       HOLDS  47/47
eligible => no branch merged              FAILS  19/20
blocked  => no branch merged              HOLDS  14/14
Discovery plan => wave not in DONE        FAILS  81/82
```

**Two rules need their wording respected or they refuse legitimate rows:**

- *complete ⇒ all NON-DEFERRED merged*, never *all merged*. One wave in the
  estate (`waiting-on-you-says-what-kind-of-waiting / Moved…`) has three deferred
  branches and nothing else — complete because there is nothing left to do.
- *DONE ⇒ state merged **or deferred***. Endgame plans hold 6 merged and 3
  deferred; a deferred branch is exempt from the merge gate by design.

**`state` and `verdict` are different entities' statuses** — the branch's and the
wave's. They are never one axis. Reading one for the other's question is the
cause of four of the seven defects this release fixes.

**Two rows carry no plan at all** (a release PR, an unowned PR), so a
plan-membership rule cannot be stated as a rule about all rows.

**WORKING and WAITING ON A MACHINE are empty on this board.** Their rules are
marked UNMEASURED in the model and must stay that way — do not assert measured
numbers for a section with no rows.

### Done when

The plan's `## Done when` is the specification. Beyond it:

- Every one of the eighteen rules is asserted, and the twelve passing ones pass.
- Each of the six failing ones asserts **its measured number**, with a comment
  naming the plan that will change it.
- `classify` is asserted **total** over the cross-product and **stable** across
  repeated evaluation.
- **No rule is skipped.** Assert it directly: a test file with `it.skip` in it
  fails this brief.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm install`
if `node_modules` is missing, `pnpm run test:board` green, a changeset with its
`bumps:` block if a skill changes. Use `trash`, not `rm`.

**The board suite runs ~6 minutes and 1805 tests.** If it times out, that is the
known state, not your branch — run the file you changed alone for a clean signal.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main` — check `git branch --show-current` is `main`
first. Push your first real commit as soon as it exists.

### Scope guard

You own the new test file and nothing else. **Change no production code**: this
wave records the baseline, and a fix that lands here makes the baseline a
description of your own change.

`AgentList.tsx` is held by several in-flight branches — you should not need to
touch it. Prefer a new file under `packages/board/test/unit/`.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`** —
a tracked fixture the board suite rewrites. Check `git status` before committing,
and never `git add -A` in this worktree.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
