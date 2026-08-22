## Implementation brief — a-plan-moves-through-the-sections (wave 1: Reachable)

- **Plan (canonical):** `docs/plans/2026-08-22-a-plan-moves-through-the-sections.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `bug/the-plan-row-carries-the-plan-decisions` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Wave 2 (`feature/an-approved-plan-offers-start-work`) waits on this one: it
walks Draft → Approve → NOT STARTED → Start work end to end, and cannot walk
it until Approve is reachable and NOT STARTED holds approved plans only.

### What to build

Two board controls are dead in the UI, and one section admits rows it promises
not to.

**Approve, on a branch row, cannot render for any row, ever.** `RowActions`
gates it on `isDraft(card) && row.waitingOn === 'you'`. `waitingOnFor` returns
non-null **only** for `group === 'not-started'`, while `classify` routes every
Draft plan to `waiting-on-you` — so the two clauses exclude each other. Measured
by executing the function, not by reading it:

    waitingOnFor('not-started',      'open',     'eligible', 'draft') -> 'click'
    waitingOnFor('waiting-on-you',   'open',     'eligible', 'draft') -> null
    waitingOnFor('not-started',      'deferred', 'eligible', 'draft') -> 'you'

`'you'` occurs only with `state === 'deferred'`.

**Commission design is worse: self-contradictory.** `canCommissionDesign` reads
`row.waitingOn === 'you' && row.state === 'open'`, and `'you'` only ever arrives
with `state === 'deferred'`. Evaluated over every (group, state, phase) the
board can produce, it is satisfied by **none** of them.

**And NOT STARTED admits Draft plans.** Its hint reads *approved — nobody has
taken it*, and the `open` path honours it. The `deferred` path does not:

    if (planPhase !== '' && planPhase !== 'approved' && planPhase !== 'draft')

so `draft/deferred` falls through to `not-started` for both verdicts.

Move both plan-level acts to the plan head, delete their row-level twins, and
drop `'draft'` from the deferred allowlist. The plan is canonical; this is
orientation.

### The decisions the plan settles — do not re-derive them

**Do NOT re-gate the row control on `group === 'waiting-on-you'`.** This was the
plan's first design and it is wrong. A branch BLOCKED by an earlier wave is
*also* in `waiting-on-you` when its plan is Draft — measured, `open/blocked` +
`draft` → `waiting-on-you` — so that predicate puts Approve back on a row whose
available act is not its own. That is precisely the defect the `waitingOn ===
'you'` clause was added to fix (see the comment above `canApprove`). **No
narrowing makes a plan-level act correct on a branch row**, which is why the
row control is deleted rather than repaired.

**Approve already works on the plan head — do not rebuild it.** `PlanActions`
gates on `isDraft(card)` alone, which is the correct rule, and its call site
argues it: *"approving belongs to the PLAN … the row that names the plan is the
only honest place for it."* Twelve browser tests in `approve.browser.test.ts`
already cover the arm-then-post interaction. Every one of them exercises the
**card** — that is the split the code calls *one board, two answers*, and it is
why the row could be dead for weeks with a green suite.

**Commission design needs a prop, not a redesign.** `PlanActions` takes no
`commission` prop, and the plan-head call site (~line 4548) passes only
`approve`. `commission` is already threaded to five other components, so this
is an extension of an existing chain. Gate it on `isDraft(card)`, exactly as
Approve is gated there.

**The branch row keeps everything genuinely branch-level.** Start work,
Open/Review and the rest stay. Only the two plan decisions leave. A menu that
opens on nothing is a defect this file already warns about — do not create one.

**`fleet.test.ts:1122` is rewritten, not deleted.** It deliberately pins the
current behaviour, arguing a shelved branch of a plan under review *"waits on a
person twice over — approve the plan, un-shelve the branch"*. That is sound
about the WAIT and wrong about the SECTION: both waits are on the same person
for the same next act, and NOT STARTED promises work that can be taken now,
which a Draft branch cannot — no phase gate would let it start. Record the
superseded argument and why it was superseded **in the test body**, so the next
reader sees a decision rather than a flip-flop.

**Carried over unchanged:** absent is not false — `planPhase === ''` must keep
falling through untouched (a scan predating the field says nothing about the
plan). Only the literal `'draft'` leaves the allowlist; `delivered`, `released`
and every unrecognised phase keep their current answers.

### Done when

The plan's changelog is the specification. Lift these assertions in particular,
because a naive implementation passes without them:

- **The first run of the new plan-head tests must FAIL.** Write them against
  today's code and watch them fail *for the stated reason* before deleting
  anything. A control that cannot render is exactly what twelve green tests
  missed; a test that passes before the fix is evidence of nothing.
- A Draft plan's head in `waiting-on-you` offers **Approve and Commission
  design** — catches the missing `commission` prop, which a UI check by eye
  will not.
- **No branch or wave row offers either**, including a row blocked by an
  earlier wave — catches a re-gating that looks right on the happy row.
- A Draft row's menu still offers Start work and Open/Review — catches an
  over-broad deletion that empties the menu.
- `draft/deferred` → `waiting-on-you` for **both** verdicts; `approved/deferred`
  unmoved in `not-started`; `delivered`/`released` still `done`; a pulse with no
  phase unchanged — the last one catches treating `''` as a phase.

Plus the repo's gates: `nvm use` (Node 24), `pnpm test`, `pnpm run
test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm
build:board` committed, and a changeset with its `bumps:` block. Never edit
versions by hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` as soon as the PR exists — check `git branch --show-current` is
`main` before that edit. Push the first real commit as soon as it exists, and
again immediately after any rebase.

### Scope guard

This branch owns `packages/board/src/app/components/AgentList.tsx` (the two
predicates, the plan-head call site) and `packages/board/src/server/fleet.ts`
(the deferred allowlist in `classify`), plus their tests
(`packages/board/test/unit/agent-list.test.ts`,
`packages/board/test/unit/fleet.test.ts`, and a browser test for the plan-head
controls).

`AgentList.tsx` is the busiest file in this repo and several merged branches
touched it today. Rebase before opening the PR, and on a conflict in
`board-server.mjs` do **not** read the diff — take either side, run `pnpm
build:board`, commit the result.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
