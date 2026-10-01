## Implementation brief — a-closed-pr-carries-no-branch

- **Plan (canonical):** `docs/plans/2026-10-01-a-closed-pr-carries-no-branch.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-closed-pr-carries-no-branch` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1093

The plan has one slice. Nothing waits on it, and it waits on nothing.

### What to build

`plot-open-pr.sh` refuses a branch that a closed, unmerged PR once carried. Measured 2026-09-30 on `bug/a-state-sweep-is-one-request` (#1049): the agent opened #1089, closed it 38 s later, and force-pushed the branch, so GitHub refuses to reopen #1089. From then on every `plot-open-pr.sh` run refused with `pr-exists` naming #1089, and the agent stopped with `PLOT-BLOCKED` while it held two finished commits.

The fix moves the decision about *which PR carries the branch* into the rule. The script passes every `pr-list` row for the branch, with its state. `openSlicePr` refuses on an `OPEN` or `MERGED` row, and opens when only `CLOSED` rows exist. In that case it names the closed PRs in the decision, in the PR body, and on stderr.

Locations on `origin/main` at dispatch (2026-10-02). The script's line numbers match the plan. Two test lines moved by 2:

- `skills/plot/scripts/plot-open-pr.sh:138-155` keeps one number: the first row whose `head` matches (`:149`). It reads no `state`.
- `plot-open-pr.sh:216` sends `existingPr: Number(e.PLOT_PR)`. The marker-only stderr notice is at `:248-250`.
- `packages/domain/src/rules/slice-pr.ts:118` declares `existingPr: number`. The refusal is at `:210-216`, and `bodyFor` is at `:160`. The type comment at `:34` already says *"open or merged"*, which the code does not do.
- `packages/board/src/server/entry/slice-pr.ts:101` reads `existingPr` with `numberOr` (`:69`).
- `test/reconcile/openpr.test.mjs:277` (OPEN) and `:286` (MERGED) are the existing refusal tests. No test has a `CLOSED` row.
- The `pr-list` rows already carry `state`: the GitHub mapper is at `plot-host.sh:3845`/`:3874` (`state:.state`), and the Bitbucket mapper at `:4013`/`:4019` maps `DECLINED` to `CLOSED`. No new host call is needed.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**The rule decides and the adapter does not.** The script must not filter rows by state in its inline `node -e`. The bug is exactly that: the shell picks one row by a rule nobody tests, and the domain sees a single number. The script prints every matching row as `{number, state}`, in the host's order, as `readings.prs`. `SlicePrReadings.existingPr: number` becomes `prs: readonly SlicePrRow[]`, where `SlicePrRow = { number, state }` and `state` is `'OPEN' | 'MERGED' | 'CLOSED'`. Remove `existingPr`. Do not keep it beside `prs` as a second answer.

**Position does not matter. State does.** Today the first matching row wins, so a branch with `[CLOSED 1089, OPEN 1102]` gives an answer that depends on how the host orders the rows. The rule searches all rows for the first `OPEN` or `MERGED` row and names that one, wherever it is. Rows `[CLOSED, OPEN]` and `[OPEN, CLOSED]` must give the same refusal.

**An unknown state counts as carrying.** A row whose state the entry cannot read becomes `OPEN` in `prsFrom`, so it refuses as today. The alternative, treating it as closed, opens a duplicate PR on a parse defect. Bitbucket does not always refuse a duplicate, so the host is no safety net there. A row with no usable `number` is dropped.

**`DRAFT` is not a state here.** The `pr-list` rows carry draft status as a separate field. An open draft PR has `state: 'OPEN'` and refuses. Do not add a fourth state value.

**A host that cannot be asked stays as today.** A failed `pr-list` gives no rows (`plot-open-pr.sh:139`), and the rule opens. The comment at `:136-137` explains why. That comment now describes rows, so update its wording, but keep the behaviour.

**The refusal order is fixed:** plan, wave, PR, commits (`packages/domain/test/slice-pr.test.ts:133` pins it). A closed-only branch with zero commits still refuses `branch-empty`.

**The body line.** `SlicePrDecision` gains `closedPrs: readonly number[]`, which is empty in the ordinary case. When the list is not empty, `bodyFor` adds one line per the plan: *"Earlier PR #1089 was closed unmerged."* For several numbers, write one sentence that names each one. Pick the wording and pin it in a test. When `closedPrs` is empty, the body must stay byte-identical to today's body. The existing body tests assert this.

**Stderr wording:** `plot-open-pr: '<branch>' had #1089 closed unmerged — opening a new PR`, printed next to the marker-only notice. A person who runs the script reads the terminal, not the body.

**Domain style:** use arrow functions and factual TSDoc in `packages/domain/src/`. Put the measurement (#1089, 38 s, force-push) in the commit message and not in a TSDoc block. Do not add new `Wave` naming.

**Invariants this repo keeps re-learning:**

- A missing answer is not a negative one. An absent `prs` reads as *no rows found*, which is today's outage path, and it never means *closed*.
- `pr-list` defaults to a window (`--limit 200`). The plan names this as an open point and does not change it. Leave it.

### Done when

The plan's `## Done when` list is the specification. Each test it names must fail on `origin/main` first. Run each one red before you write the fix.

The assertions a naive fix would pass without:

- **`[OPEN 1102, CLOSED 1089]` and `[CLOSED 1089, OPEN 1102]` both refuse naming `#1102`.** A fix that only skips a leading CLOSED row and then takes the next row passes the first case. A fix that refuses on "any row exists unless the first row is closed" fails the second case. Both orders pin "position does not matter".
- **`MERGED` behind `CLOSED` refuses naming the merged number.** This catches a fix that checks only for `OPEN`.
- **Unknown or missing state reads as `OPEN`** in the board entry test. This catches the permissive parse that opens duplicates. There is no unit test for `entry/slice-pr.ts` today, so create `packages/board/test/unit/slice-pr.test.ts`, modelled on `test/unit/stack-readings.test.ts`.
- **The script-level CLOSED-then-OPEN test in `openpr.test.mjs`.** This proves that the shell passes every row and not the first match. A domain-only fix passes every domain test and still fails this test.
- **The existing tests at `openpr.test.mjs:277` and `:286` pass unchanged.** Their fixtures already carry `state`, so they need no edit. If you edit them, you broke the adapter's contract.
- **100 % branch coverage on `slice-pr.ts`** (`pnpm --filter @plot-pm/domain test:coverage`). The new state branches must each be exercised.

Plus the repo's gates. Run `nvm use` first (Node 24, because pnpm crashes on 26).

- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain coverage gate.
- Rebuild the bundle with `pnpm build:board`. This regenerates `skills/plot/scripts/board/plot-slice-pr.mjs` (`packages/board/build.mjs:721-725`), and you commit it. CI fails on a stale artifact. If `board-server.mjs` conflicts on a rebase, take either side and rebuild. Do not read the diff.
- A changeset naming `plot` and `@plot-pm/board`, with the description first. Add a `plan: docs/plans/2026-10-01-a-closed-pr-carries-no-branch.md` line and a `bumps:` block last. The skills bump is `plot: patch`, because `plot-open-pr.sh` lives under `skills/plot/`.
- Do not run `pnpm run test:e2e` locally. It is CI's gate.
- After a suite run, check `git status`. Board test runs rewrite the tracked `tiny-garden` pulse fixture, so do not `git add -A`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves). Do not use `gh pr create`. Note: until this fix merges, the script on `main` has the same defect. If your branch somehow gets a closed PR, run the script from your branch's checkout. It then uses your fixed copy.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Write `Closes #1093` in the PR body.

### Scope guard

This branch owns:

- `packages/domain/src/rules/slice-pr.ts` and `packages/domain/test/slice-pr.test.ts`
- `packages/board/src/server/entry/slice-pr.ts` and a new `packages/board/test/unit/slice-pr.test.ts`
- `skills/plot/scripts/plot-open-pr.sh` and `test/reconcile/openpr.test.mjs`
- `skills/plot/scripts/board/plot-slice-pr.mjs` (rebuilt, never hand-edited), plus whatever `pnpm build:board` regenerates
- one new `.changeset/*.md`

Branches in flight at dispatch: a check of every `origin/*` branch against `origin/main` found **none** that touches `slice-pr`, `plot-open-pr` or `openpr.test`. Expect conflicts only in the generated board artifacts.

Out of scope, per the plan: the board's reading of a closed PR (#1091, closed), the supervisor's landing label (#1094, owned by `a-hold-names-the-landing-nobody-could-answer`), and the `--limit 200` window.

If you find something the plan did not anticipate, report it. Do not improvise outside scope.
