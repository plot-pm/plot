## Implementation brief — a-plan-moves-through-the-sections (wave 2: Started)

- **Plan (canonical):** `docs/plans/2026-08-22-a-plan-moves-through-the-sections.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `feature/an-approved-plan-offers-start-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Wave 1 (`bug/the-plan-row-carries-the-plan-decisions`, PR #325) is **merged**.
It deleted the two unreachable row-level controls and fixed the NOT STARTED
admission. This wave proves the resulting path works end to end. Nothing waits
on this branch.

### What to build

**A browser test that walks the whole operator path, and only the fixes that
walk exposes.**

The path: a Draft plan is approved → its row appears in NOT STARTED → *Start
work* is offered there → clicking it dispatches.

Each leg is already built and wave 1 connected them. This wave's job is to
**prove the connection end to end in one test**, because every existing test
covers one leg. `approve.browser.test.ts` has twelve tests that all exercise the
**card**; nothing walks card-approve through to a row in NOT STARTED offering
Start work.

**Build no new control unless the walk shows one missing.** That sentence is the
plan's, and it is the scope boundary: if the walk passes, the deliverable is the
test. Read the plan's `## Design` before adding anything.

### The decisions the plan settles — do not re-derive them

**The row-level Approve is deleted, not repaired.** Do not add it back, and do
not "fix" its predicate. The plan proves the repair does not work: a branch
BLOCKED by an earlier wave is also in `waiting-on-you` when its plan is Draft
(measured: `open/blocked` + `draft` → `waiting-on-you`), so gating on section
membership alone puts Approve on a row whose available act is not its own —
the exact defect the `waitingOn === 'you'` clause was added to fix. Approve
lives on the **plan head**; the card offers it and the row does not.

**`canCommissionDesign` was self-contradictory, not merely unreachable.** It
read `waitingOn === 'you' && state === 'open'`, and `'you'` is returned only
alongside `state === 'deferred'`. Satisfied by no (group, state, phase) the
board can produce. It is gone. Note the asymmetry the plan records: deleting the
row control removes the feature outright, because `PlanActions` takes no
`commission` prop — so do not assume a plan-head equivalent exists to fall back
on.

**`waitingOnFor` returns `'you'` for exactly ONE input** — `not-started` +
`deferred`, a shelved branch. Not for a Draft plan's first wave, whatever the
old comments say; the arm was deleted and its own comment reads *"THE DRAFT ARM
IS GONE"*. Any predicate you write against `'you'` must be checked against that
single input, not against the prose.

**The measurement was taken twice, months apart, by different routes** — a
reader's report on 2026-08-20 that every row in WAITING ON YOU carried
`waitingOn: null`, and this plan's evaluation of `waitingOnFor` over its whole
input space. Two independent measurements, one defect. `the-plan-actions-read-a-field-that-is-always-null`
is **superseded and rejected**; do not resurrect its fix.

**Carried-over invariants this repo keeps re-learning:**
- **Absent is not false.** Read the exit code, never the emptiness.
- **Playwright route callbacks must be SYNCHRONOUS.** Awaiting `route.fetch()`
  fails tests that already passed on this machine.
- **The board client CASTS the fleet, it does not parse it.** Zod defaults do
  not apply client-side, so a new field is `undefined` in the renderer.
- **Browser tests load the BUILT artifact.** Run `pnpm build:board` first; a
  stale artifact fails reassuringly.

### Done when

The plan's `## Done when` list is the specification. Beyond it, the assertions
that exist *because a naive implementation would pass without them*:

- The walk asserts the row reaches **NOT STARTED** specifically — not merely
  that a row exists somewhere. Wave 1's admission fix is what this proves, and a
  test that only counts rows passes with the Draft plan still admitted.
- *Start work* is asserted to **dispatch**, not merely to be present. A
  disabled-but-rendered control passes a presence check.
- A **Draft** plan's shelved branch must NOT appear in NOT STARTED. The section
  means *approved — nobody has taken it*; the old `'draft'` allowlist at the
  `deferred` path is what wave 1 removed, and only a negative assertion catches
  its return.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm install`
if `node_modules` is missing, `pnpm build:board` in THIS worktree with the
artifact committed, `pnpm run test:board` green, and a changeset with its
`bumps:` block. Never edit versions by hand. Use `trash`, not `rm`.

**The board suite is slow and near its CI cap** (measured 2026-08-22: the full
vitest run exceeded 15 minutes on this machine, and CI's board step has a
15-minute limit). If your run times out, that is the known state of the suite —
do not "fix" it by raising a timeout, and do not assume your branch caused it.
Run the file you changed alone to get a clean signal.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main` — check `git branch --show-current` is `main`
before that edit. Push your first real commit as soon as it exists, and push
again immediately after any rebase.

### Scope guard

This branch owns the **test** proving the walk, plus any narrowly-scoped fix
that walk exposes.

**Heavy collision warning — `AgentList.tsx` is the busiest file in this repo.**
Verified at dispatch, these branches are in flight and hold files you may touch:

- `bug/one-component-renders-every-row` — `AgentList.tsx`, `TupleRow.tsx`, `tuple-row.ts`, `agents-tab.browser.test.ts`
- `bug/a-section-is-not-a-row` — `AgentList.tsx`, `agents-tab.browser.test.ts`, `row-withholds.browser.test.ts`
- `bug/an-agent-is-not-a-machine-you-wait-on` — `AgentList.tsx`, `schema.ts`, `fleet.ts`
- `bug/one-column-one-kind-of-fact` — `AgentList.tsx`, `last-pulse.json`
- `bug/the-board-says-when-it-has-not-asked` — `AgentList.tsx`, `agents-tab.browser.test.ts`, `agent-list.test.ts`
- …and 61 more. Run `/plot-fleet` for the full picture.

Prefer a **new test file** over editing `agents-tab.browser.test.ts`, which four
in-flight branches hold.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`** —
it is a tracked fixture that board test runs rewrite. Check `git status` before
committing and never `git add -A` in this worktree.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
