## Implementation brief — a-branch-behind-main-holds-nothing

- **Plan (canonical):** `docs/plans/2026-09-26-a-branch-behind-main-holds-nothing.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `bug/a-branch-behind-main-holds-nothing` (base: `main`), claimed 2026-09-26 by a pushed empty claim commit
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI `validate`)

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`branchState` in `packages/domain/src/rules/branch-state.ts` ends its zero-ahead arm with `return 'merged'` (currently the last line of the function, after the `refTip === mainTip` check). That line answers `merged` for a ref that is behind `main` and carries no commit of its own. Measured 2026-09-26: three approved slices of three plans read `merged` with `commits=0 prs=0 desks=0`, were absent from `--list-eligible`, and dispatch printed `dispatched=0 skipped=0` — the same output as a finished plan.

The change: in that arm, return `merged` only when `readings.pr === 'MERGED'`; otherwise return `unknown`. Then extend the shape table in the comment above it from two rows to three, and add tests. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**`unknown`, not a new state.** `unknown` already means "the readings are present and do not determine the answer" (docstring: *"`unknown` MARKS AN ABSENT READING, NEVER AN EMPTY ONE"*). Downstream already does the right thing with it: `packages/domain/src/rules/queue.ts:207` returns the `merge-unknown` hold, and `plot-fleet-scan.sh` treats `unknown` as outstanding. So no schema, board, queue or scan change is needed. Adding a state would touch every consumer for no gain.

**No host call.** The comment above the arm already records why: `plot-pr-merged.sh` answered *not merged* for three merged branches while throttled. The only host fact the rule may consult is `readings.pr`, which is already in `BranchReadings`.

**No staleness field.** The defect reproduces on a fully fresh reading; the plan rejects a `readAt` field as the wrong fix.

**`mergeSubjectFound` does not apply.** It is read only in the no-ref arm; this shape has a ref.

**No board change, no `plot-dispatch.sh` change, no change to `--start`'s detached cut.** The section follows the state; a board-side check comparing two payload fields is the shape CLAUDE.md forbids.

**The cost is accepted, not a bug to fix.** A genuinely merged branch whose ref outlived the merge, and whose PR the host cannot confirm (`pr` ≠ `MERGED`), now reads `unknown` and holds its wave. The plan chooses a visible hold over a silent settle. `plot-release-refs.sh` bounds that population (3 surviving merged refs on this estate).

**Round 1 correction — the producer.** The plan's later section *"`plot-dispatch.sh --start` creates this shape as a matter of course"* was REFUTED in round 1 (see *Round 1 refuted the producer*): `--start` cuts detached and pushes no ref. The real source is a claim whose `--allow-empty` commit was lost or squashed away. Do NOT repeat the `--start` claim in the new code comment; name the lost claim commit and the old-main cut instead.

**The two existing tests must be argued against, not just flipped.** `packages/domain/test/branch-state.test.ts`, describe `a branch reset to main holds nothing`:

- `it('answers merged when its tip is behind main')`
- `it('answers merged where main cannot be read and the tip differs')` — defends itself with *"an unreadable main is not equality"*

Both become `unknown` cases (the second keeps its point: an unreadable main is not equality, so it does not answer `open` either — it answers `unknown`). Rename each test to say what it now asserts and state in the commit message why the old assertion was wrong. A juror measured the blast radius: 4 failed / 38 passed, all in this file, no collateral.

### Done when

The plan's `## Done when` list is the specification. Assertions that a naive implementation would pass without:

- **Behind main, zero ahead, `pr: 'none'` → `unknown`.** The core case.
- **Same with `pr: 'MERGED'` → `merged`.** Catches a fix that returns `unknown` unconditionally and demotes every genuinely merged surviving ref.
- **Same with `pr: 'CLOSED'`, `'OPEN'`, `'unreadable'` → `unknown`.** Only `MERGED` may promote, mirroring the resurrected-ref arm's `it.each`.
- **`mainTip: null`, tip present → `unknown`,** not `open` and not `merged`.
- **`refTip === mainTip` → still `open`.** Catches a fix placed above the equality check.
- **Claim commit pushed (`commitsAhead: 1, realCommitsAhead: 0`) → still `claimed`.**
- **The four probe rows from the plan's Motivation as one named describe block** (the plan's Notes ask for the probe to live in the test file): claimed / behind-main-empty / at-main / no-ref, host `ok`, `pr: 'none'`, `waits: null`.
- **The comment's table names three shapes** (behind main via landed work, reset to main, cut from an older main or lost claim commit) and states that tip equality separates *reset* from the other two and cannot separate those two from each other.

Also check `packages/domain/corpus/branch-state.corpus.test.ts`: the plan says `:264` is reached by 0 branches on this estate, so the corpus should not move — if it does, stop and report rather than adjust either side.

Repo gates:

- `nvm use` (Node 24; pnpm crashes on 26), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain package's own vitest run.
- `pnpm build:board` — the scan asks this rule through `skills/plot/scripts/board/plot-branch-state.mjs`, and other bundles embed it too; commit the rebuilt artifacts or CI's no-diff gate fails.
- Domain style: arrow functions, factual TSDoc — reasoning goes in the commit message, not a 4:1 comment.
- A changeset: `'plot': patch` (the rule ships in the skill bundles) with the description first; include `plan: docs/plans/2026-09-26-a-branch-behind-main-holds-nothing.md` inside the trailing comment block, never as the first line.
- Do NOT run `pnpm run test:e2e` locally — CI owns it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never `gh pr create`.
- When the PR exists, append `, PR: #<number>` inside the slice heading in the plan's `## Slices` section: `### A branch behind main holds nothing (Branch: bug/a-branch-behind-main-holds-nothing, PR: #N)`. Keep the branch name bare — backticks inside the heading made the parser read `branches=[]` until 2026-09-26.
- Issue #1002 is the tracker reference; do not close it by hand — delivery handles tracker status.

### Scope guard

This branch owns:

- `packages/domain/src/rules/branch-state.ts`
- `packages/domain/test/branch-state.test.ts`
- the rebuilt bundles under `skills/plot/scripts/board/` and `packages/board/src/contract/bundles.generated.ts` if the build changes it
- one `.changeset/*.md`

Verified at dispatch (2026-09-26): no other remote branch changes `branch-state` files. Related plans in flight: `a-claim-is-released-not-deleted` (the source of the lost-claim shape) and `a-corpus-test-says-what-it-verifies` (the corpus for this same line). Do not edit their files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
