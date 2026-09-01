## Implementation brief — a-teardown-does-not-fail-a-suite (slice: the rmSync conversion)

- **Plan (canonical):** `docs/plans/2026-09-01-a-teardown-does-not-fail-a-suite.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/a-test-teardown-does-not-call-rmsync` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

### READ THIS FIRST — the plan's population count is stale

**Re-measured 2026-09-01, 12:5x, on `main`:**

| | plan says | measured now |
|---|---:|---:|
| `fs.rmSync(…, { recursive })` under `packages/board/test/` | 80 | **76** |
| `rmTree(` call sites | 1 | **88** |

**The conversion is largely done already**, by work that landed after the plan was written.
`rmTree` is defined at `helpers.mjs:496` (the plan says 455 — also moved) and is now called
from 88 sites. Do **not** open this branch expecting 80 untouched teardowns; re-measure before
you start, and put your own number in the PR body.

This is the repo's recurring trap: a brief that quotes a count nobody re-took sends an
implementer to redo landed work, and they lose trust in the plan when the numbers disagree.

**Where the remaining 76 live** — heavily in `unit/`, and mostly TypeScript:

```
unit/gate-asks-once-per-estate.test.ts   7     port.test.mjs        4
unit/continue.test.ts                    7     lifetime.test.mjs    4
unit/transcript.test.ts                  6     git-retry.test.mjs   4
.ts: 61        .mjs: 15
```

`.ts` files already import from `helpers.mjs` (`unit/needs-real-board.test.ts:46`), so there is
no module barrier to solve.

### What to build

Replace every `fs.rmSync(target, { recursive: … })` in a **test teardown** with `rmTree(target)`,
and add a gate that fails the build when one reappears.

### The decisions the plan settles — do not re-derive them

**The control experiment is the proof, and it rules out the obvious alternative.** Measured on
one tree, one commit:

| run | result |
|---|---|
| `node --test --test-concurrency=1` | **exit 0** |
| `node --test --test-concurrency=4` (what `test:board` runs) | **failed 5 of 5** |

Serial passes, parallel fails. That kills the tempting reading — *"the fixtures collide on a
shared temp root"* — because a shared root would collide serially too.

**`force: true` DOES NOT FIX THIS, and reaching for it is the trap.** From `helpers.mjs`'s own
note: it suppresses *"no such file"* — the absence of something expected — while this is **the
presence of something unexpected**, the opposite failure. A doomed child writes
`.git/index.lock` between `rmSync`'s walk and its `rmdir`, and the `rmdir` fails `ENOTEMPTY`.
If you "fix" it with `force: true` the flake persists and the diagnosis looks wrong.

**Convert EVERY teardown, not only the ones that can race.** Settled, with two reasons:

- **A retry that never fires is free.** `rmTree`'s first attempt *is*
  `fs.rmSync(target, { recursive: true, force: true })` — the identical call. On a clean
  removal it returns from that attempt: no behaviour change, no delay.
- **The precise population is not nameable.** *"Removes a directory a spawned process wrote
  in"* is a judgement no grep can decide, so it would be a rule a reviewer re-makes for every
  new teardown. The mechanical rule — *a test teardown does not call `fs.rmSync` directly* — is
  gateable by grep and decidable without judgement.

**Production is out of scope**, deliberately. Three sites live in `packages/board/src/`
(`idea.ts:691`, `board.ts:1579`, `board.ts:1864`). The two in `board.ts` remove a directory a
**git** process wrote in — the same shape as this bug — and they are still excluded: a
production `rmSync` throwing is a different subject from a teardown failing a suite. **Record
that reading somewhere a later plan can pick it up**; the plan's `Done when` asks for it.

### Done when

The plan's list is the specification. Two items carry the weight:

- **`test:board` passes on a FIRST run, twice in a row, under deliberate contention** — a
  second suite running in another worktree. State the measurement in the changeset. *"Passes on
  a re-run"* is the symptom, not the fix, and it is how this bug hid.
- **A gate, not a review note.** No file under `packages/board/test/` calls `fs.rmSync` with
  `recursive`, `rmTree`'s own implementation excepted, and CI fails when one reappears. Follow
  the shape of the existing layering gate in `.github/workflows/ci.yml` ("One place reaches a
  process"): grep, count, compare to an allowed number, `::notice::` when it can tighten.
- `git-retry.test.mjs`'s absorption test still passes, **and the fixture gains one proving
  `cleanup()` itself survives a regrowing directory** — the test that would have caught this.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset
(`'@plot-pm/board': patch` — a packages/board change uses package frontmatter, no `bumps:`
block).

**Do not run `pnpm run test:e2e` locally.** CI's gate, its own machine.

**Verify the gate is discriminating before trusting it.** Re-introduce one `fs.rmSync` and
confirm CI's grep fails. A gate that counts wrong passes silently, and this repo has caught
three inert mutations that way today alone.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** `packages/board/test/**`, plus one CI step in
`.github/workflows/ci.yml`, plus a changeset.

**It does not own** `packages/board/src/**` — the three production sites stay, by decision.

**In flight elsewhere, 2026-09-01:** `feature/the-refusals-are-domain-rules` (claimed 12:19,
`plot-dispatch.sh` + a domain rule), `infra/the-agents-tab-tests-serve-their-own-state` (#591,
board browser tests — **overlaps `packages/board/test/integration/`**, so expect a rebase), and
`docs/a-machine-has-an-identity` (docs only).

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
