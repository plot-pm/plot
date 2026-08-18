# Brief: bug/a-deferred-row-answers-to-the-phase-too

Implement wave 2 of `docs/plans/2026-08-18-a-blocked-wave-is-not-eligible.md`.

Read it first, and read **`fleet.ts:1129-1133`** — the previous wave's author
saw this case and left it deliberately. Your job is to narrow that decision,
not to overturn it.

## What #231 established, and what it left

The phase filter works. Measured on the live board immediately after it merged:
three Released plans that NOT STARTED had been offering — `a-squashed-branch`,
`bb-state-vocabulary`, `the-gate-reads-what-was-shared` — disappeared.

Three `deferred` rows remained:

```
feature/the-pulse-repairs-the-artifact   plan phase: NONE
feature/a-repaired-row-says-so           plan phase: approved
feature/plot-sprint-support              plan phase: RELEASED
```

The last one belongs to a plan Released in v1.0.0-beta.3, four months ago.

## Why it happens, in the previous author's own words

```
// A shelved branch waits on a person — a deliberate hand-back, and the one
// row here that a phase check does not account for. It reaches `not-started`
// by its own route, never through the `open` arm below.
if (state === 'deferred') return 'you';
```

**That reasoning is right for an Approved plan** and wrong for a finished one.
A deferred branch of an Approved plan genuinely waits on a person: someone
shelved it, someone may unshelve it. A deferred branch of a **Released** plan
waits on nobody — the plan shipped, and the shelf is part of the history.

`feature/plot-sprint-support` makes the case concretely: it was annotated
`deferred` because the branch was **never created** — February's work landed
directly on main — and the plan has been Released since April.

## What to build

The phase answers first for **every** row in the section, whatever route
brought it there. `deferred` keeps its meaning *within* a plan that can still
move; it stops being a waiting state once the plan is `Delivered` or
`Released`.

## Do not

- **Do not remove the deferred arm.** Its `'you'` answer is correct for an
  Approved plan and the comment explaining why must survive, extended rather
  than replaced.
- **Do not touch the open-row behaviour.** #231's tests pin it; they must keep
  passing untouched.
- **Do not infer the phase from the branch.** Read it from the plan, as #231
  does. That is the rule this whole plan exists to establish.

## An open point you may hit

`feature/the-pulse-repairs-the-artifact` shows `plan phase: NONE` — its plan
could not be resolved from the branch name. Whether that is a lookup gap or a
plan-side annotation problem is not established. If your change makes it
visible, **report it rather than guessing**; if the phase is genuinely unknown,
the honest rendering is not the same as a known-terminal one.

## Definition of Done

- A deferred branch of a `Released` plan is not in NOT STARTED. Reproduce the
  measured case (`feature/plot-sprint-support`) and verify it fails against the
  unchanged code
- A deferred branch of a `Delivered` plan likewise
- A deferred branch of an `Approved` plan is still there, still answering
  `you` — the previous wave's behaviour, unchanged
- #231's open-row tests pass untouched
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Note on CI

A `validate` run on the previous wave hung for over an hour on this repo while
the same branch's earlier commit passed in minutes. If your run exceeds ~25
minutes with no output, it is likely stuck rather than slow — say so rather
than waiting it out.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
