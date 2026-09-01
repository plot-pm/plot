## Implementation brief — the-board-suite-runs-twice-green (wave Knowing whether it worked)

- **Plan (canonical):** `docs/plans/2026-09-01-a-teardown-does-not-fail-a-suite.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/the-board-suite-runs-twice-green` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's third and last wave. Both earlier waves landed: `bug/the-stub-fixture-retries-its-teardown` as #578 (merge commit `9baee1e1`) and `bug/a-test-teardown-does-not-call-rmsync` as #616 (`e61b3eb8`, 37 files, +107/-71). This wave measures whether their fix holds. It writes no production source and no new helper.

### READ THIS FIRST — re-measure before you start

The sibling brief for #616 records what a stale count costs: it quoted 80 sites where the tree held 76, and it sent an implementer toward work that had already landed. The same trap applies here in the opposite direction, because #616 landed after the plan was written.

**Measured on `main` at `3738f66f`, 2026-09-01:**

| | plan says | measured now |
|---|---:|---:|
| `fs.rmSync(…, { recursive })` under `packages/board/test/` | 80 | **2** |
| of those, `rmTree`'s own implementation | 1 | 1 (`helpers.mjs:499`) |
| raw sites still to convert | 79 | **1** |
| `rmTree(` call sites | 1 | **157** |

The conversion is done. Take your own measurement and put it in the PR body.

### What to build

Two things, and only these two.

**1. The measurement the plan asks for, recorded.** Run `test:board` under deliberate contention — a second suite in another worktree, the condition all three original failures shared — and record the FIRST-run outcome, twice in a row. The plan's claim is *"a first run passes"* and nothing in the plan proves it.

**2. The gate that keeps the conversion, which does not exist yet.** `.github/workflows/ci.yml` has no step naming `rmSync` or `rmTree`. The plan's second Open Question is answered `[x] Yes` and its `Done when` asks for a gate rather than a review note, so this wave owes it.

### The one site the gate will find

`packages/board/test/unit/findings-reach-attention.test.ts:40` calls `fs.rmSync(root, { recursive: true, force: true })` directly. It landed after #616's sweep. Convert it to `rmTree(root)` in this branch — a gate that fails on the day it ships gets turned off, and this is a one-line conversion at zero cost.

Note that this file runs under **vitest**, not the `node --test` glob: `packages/board`'s `test` script globs `test/*.test.mjs` only, and `test:board` runs `vitest run` as a third step. The gate greps the directory, so it covers both runners; the population is a path, not a runner.

### The decisions the plan settles — do not re-derive them

**The first run is the measurement, and a re-run proves nothing.** From the plan: *"A suite that passes on retry is indistinguishable from a suite that passes, right up to the moment somebody believes a red result."* Report first-run outcomes. A green second run is the symptom the plan exists to remove.

**Contention is the whole trigger, and the control experiment proves it.** Measured on one tree at one commit:

| run | result |
|---|---|
| `node --test --test-concurrency=1 test/*.test.mjs` | **exit 0** |
| `node --test --test-concurrency=4` (what `test:board` runs) | **failed 5 of 5 attempts** |

Serial passes, parallel fails. So a run without contention measures nothing this wave cares about. All three original failures happened while a dispatched worker ran `test:board` in another worktree.

**A teardown failure blames a passing test.** `node --test` reports an `after()` throw as the test failing, so the output named `the BOUND port reaches the same-origin check` — a test that passed. Read the failing SITE, not the failing test name. All three original failures pointed at `helpers.mjs:246`.

**`force: true` does not cover this failure.** It suppresses the absence of something expected; this is the presence of something unexpected. Do not treat a `force: true` call as already safe — the stray site above has `force: true` and is still a raw `rmSync`.

**The gate is mechanical, not judged.** The population is *"a file under `packages/board/test/` calling `fs.rmSync` with `recursive`"* — a grep, with one allowance for `rmTree`'s own implementation. A gate scoped to *"teardowns that race a child"* needs a reviewer's opinion per site, which is a rule rather than a gate.

**Follow the ratchet shape already in CI.** `.github/workflows/ci.yml:187`, *"One place reaches a process"*, is the model: grep, count, compare against an `allowed=` number, `::error::` and print the sites when the count rises, `::notice::` when it can tighten. Set `allowed=1` for `rmTree`'s own implementation after the stray is converted.

**Production is out of scope, deliberately.** Three `fs.rmSync` calls live in `packages/board/src/` — `idea.ts:691`, `board.ts:1579`, `board.ts:1864`. The two in `board.ts` remove a directory a git process wrote in, the same shape as this bug. They stay. The plan's `Done when` asks that the reading be recorded where a later plan can pick it up, so record it and do not fix it here.

**Retry sizing stays at `retries = 10, delayMs = 25`.** The plan's first Open Question is open and says to measure before changing it: *"a retry budget raised on a guess hides the next real failure for a quarter second longer and proves nothing."* If your contention run shows the 250 ms ceiling is short, report the measurement rather than raising the number.

### Out of scope

The corpus tier's own concurrency split — `refs.corpus.test.ts` disagreeing by one file when a push lands mid-run — has its own section in the plan and belongs in its own plan. Do not widen into it.

### Done when

- **`test:board` passes on a FIRST run, twice in a row, under deliberate contention.** Both first-run outcomes stated in the changeset with the contention named.
- **`packages/board/test/unit/findings-reach-attention.test.ts:40` calls `rmTree`.** Then no file under `packages/board/test/` calls `fs.rmSync` with `recursive` except `helpers.mjs`.
- **A CI step fails the build when a raw recursive `fs.rmSync` reappears in that directory.** Verify it is discriminating: re-introduce one site, confirm the step fails, remove it. A gate that counts wrong passes silently.
- **The `board.ts` stage-dir reading is recorded** somewhere a plan can pick it up.
- `git-retry.test.mjs`'s absorption tests still pass, including the fixture's own at line 222.

### Repo gates

Node 24 (`nvm use`). Run `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, and `pnpm build:board` with the artifact committed — CI gates on no-diff.

`pnpm run test:board` is this wave's subject, so run it deliberately. It is bounded at 1200 s. The plan measures it at ~456 s, and the browser-test migration reports 381 s after its own change landed. This wave needs at least two first runs plus the contending suite, so budget the time.

**Do not run `pnpm run test:e2e`.** It is CI's gate and dispatches real workers into sandbox repositories. Two agents running it here produced 53 concurrent `node --test` processes and load average 8.69 — which is the contention this wave is trying to CONTROL, not add to.

### The contending suite

Contention means a second suite in another worktree, running while `test:board` runs. Use a suite that is long and does not itself dispatch workers. `pnpm --filter @plot-pm/board test` in a second worktree is the honest choice: it is the same `--test-concurrency=4` load the original failures ran under.

### Changeset

Description FIRST, `bumps:` block LAST. Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note. A description under 20 characters is refused by `./scripts/check-changeset-packages.sh`.

A `packages/board` change uses package frontmatter — `'@plot-pm/board': patch` — with no `bumps:` block. This branch also edits `.github/workflows/ci.yml`, which is repo-level.

State the first-run measurement in the description. That is what the plan asks the changeset to carry.

### Bookkeeping

Push the first real commit as soon as it exists — the ref push is the claim.

When the PR exists, append `→ #<number>` to this branch's line under `## Branches` in the plan on main. **Never begin a line in a Branches section with a backticked branch name:** the loose matcher reads it as a claim and `parser.test.mjs`'s estate-wide differential fails. It cost a red main on 2026-09-01.

`.gitattributes` marks the built board artifacts `-merge`. On a conflict there take either side, run `pnpm build:board`, `git add`, and continue. Do not read that diff — the rebuild overwrites whichever side you took.
