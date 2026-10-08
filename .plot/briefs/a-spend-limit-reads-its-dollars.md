## Implementation brief — the-fleet-loop-reads-its-runs-right (wave 2: A spend limit reads its dollars)

- **Plan (canonical):** `docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-spend-limit-reads-its-dollars` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the second wave of four. It waits on wave 1 (`bug/a-run-no-runner-took-is-no-answer`, #1353, merged) and waves 3 and 4 wait on it (`rules/eligible.ts:131-134`).

### What to build

`dollarsOrUnset` (`packages/board/src/server/entry/worker-loop.ts:1656-1659`) reads `Number(raw)` and answers `null` unless the result is finite and above 0. `Number('$20')` and `Number('20 USD')` are `NaN`, so a repository that writes `Slice max spend: $20` or `Agent max spend: $5` in `## Plot Config` gets **no limit at all**, and nothing says so (#1328). The same function serves both keys: `maxSpendUsd: dollarsOrUnset(cfg('Agent max spend')) ?? 0` at `:1825` (inside `runnerDeps`) and `sliceMaxSpendUsd: dollarsOrUnset(configKey(worktree, 'Slice max spend'))` at `:2074` (inside `main`'s config block). Those are the only two callers (`git grep dollarsOrUnset` finds also `packages/board/test/unit/worker-loop-run.test.ts` and the generated `skills/plot/scripts/board/plot-worker-loop.mjs`).

The change has two parts:

1. **The parser reads dollars.** `dollarsOrUnset` accepts a leading `$` and a trailing ` USD` (case-insensitive, surrounding blanks allowed), then reads the number as before. `$20`, `20 USD`, `$ 20`, `12.5` and `$12.50 USD` read as 20, 20, 20, 12.5 and 12.5.
2. **A value it cannot read refuses the start.** The loop logs the key and the raw value (`plot-worker-loop: unreadable Slice max spend "x" — refusing to start`) and `main` returns a non-zero code before it runs anything. The log and the refusal belong to the caller, because `dollarsOrUnset` does not know the key; the function must give the caller a way to tell *absent* from *unreadable* (for example a result type with a third arm, or a separate `readable` check) and must stay pure.

### The decisions the plan settles — do not re-derive them

**Refuse; do not fall back.** The plan answers the open choice: "a cap that disappears in silence is worse than a stopped loop." Do not log a warning and run with no limit, and do not fall back to a default cap. The measured failure is the silent one: `Number('$20')` is `NaN`, the function answers `null`, and the loop runs a slice with no cap while the operator believes it has one.

**Absent is not unreadable.** `plot-config.sh` prints an absent key as `''`, and `shippedConfig` (`:1723-1727`) turns `''` into `undefined`. So `undefined` stays "no limit", and so does a key the reader answers `undefined` for. Only a value that is present and cannot be read refuses. A refusal on absence would stop every repository that sets no cap, which is nearly all of them. A test names this: a parser that refuses everything non-numeric, including `undefined`, passes the `'x'` test and breaks every loop.

**`0` and negative values are unreadable caps, not "no limit".** The current test (`worker-loop-run.test.ts:1146-1149`) asserts `'0'` and `'-3'` answer `null`. That is the same silent loss as `$20`: the operator wrote a cap, and the loop runs without one. The plan names `'x'` explicitly and says "a value the loop cannot read"; a cap of `0` or `-3` is a value the loop cannot honour. Move `'0'` and `'-3'` to the refused set and change that test, and say so in the PR body. If you read the plan differently, report it as a plan question; do not keep the old `null` for them by default. `''` and whitespace-only values stay unset, because they are what an empty key looks like.

**One parser.** The plan's deliverable search (2026-10-07) found `dollarsOrUnset` is the only dollar parser. Do not add a second one for the shell: `plot-config.sh` documents both keys (`:153-156`) and only documents them; it reads no amount.

**Rules carried over unchanged.** Absent is not false: `undefined` never refuses. Read the exit code, not the emptiness: the refusal is a non-zero return from `main`, and a test asserts the code, not that some line was logged. A function you write or rewrite is an arrow (`dollarsOrUnset` is already one). TSDoc states what an export does and how it fails; the reasoning goes in the commit message. Update the TSDoc and the `plot-config.sh:153-156` comment, which says "Absent = no limit" and should add that an unreadable value refuses the start and that `$` and `USD` are accepted.

### Done when

The plan's `## Done when` item for this slice is the specification: `dollarsOrUnset('$20')` answers 20; `dollarsOrUnset('x')` is logged and refused. Assertions that exist because a naive implementation passes without them:

- **Absent still runs.** `dollarsOrUnset(undefined)` is unset, and `main` with neither key set starts the loop. This catches a parser that refuses absence.
- **Both keys refuse.** `main` with `Agent max spend: x` returns non-zero, and so does `main` with `Slice max spend: x`, each logging its own key name and the raw value. The two callers are in different functions; a fix in the parser that is wired to one of them passes a one-key test.
- **The refusal happens before work.** The refused start claims nothing and launches no prompt: assert no take-up write and no runner start. A refusal after the first slice is taken up leaves a claimed branch and a desk behind.
- **`0` and `-3`.** The old test asserted `null`; the new one asserts the refusal (see the decision above).
- **The unit change reaches the bundle.** `skills/plot/scripts/board/plot-worker-loop.mjs` is generated; `pnpm build:board` rebuilds it for local tests only. Do not commit the rebuild (`scripts/check-no-bundle-diff.sh`): `main` builds its bundles after every merge.

Plus the repo's gates: a `'@plot-pm/board'` changeset with the description first and the `bumps:` block last (`plot` is a patch only if a skill file changes; the `plot-config.sh` comment is a shipped script, so add `'plot': patch` too, and leave `plot-dispatch` untouched). `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; keep the `plot-config.sh` comment edit the same length or shorter, or remove a line elsewhere in the same change. The gate stores no number and has no override. Run `scripts/check-changeset-packages.sh` locally.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`). Do not run board tests while an operator's board is open on this machine.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names the issue (#1328) and states what `0` and negative values now do.

### Scope guard

This branch owns the dollar reading and its refusal:

- `packages/board/src/server/entry/worker-loop.ts`: `dollarsOrUnset` and the two lines that call it, plus the refusal in `main`. Touch nothing else in that file; wave 3 edits `:1762` and `:2039` (the charter) and wave 4 edits `:821` (`buildRun`).
- `packages/board/test/unit/worker-loop-run.test.ts`: the `dollarsOrUnset` test and the new `main` refusal tests.
- `skills/plot/scripts/plot-config.sh`: the comment at `:153-156` only.

Not this branch's: the charter and `.gitignore` (wave 3), `buildRun` and `buildFindingFor` (wave 4), the checks reading (wave 1, merged).

Other branches in flight, checked at dispatch on origin: none of this plan's other slices has a branch yet. Sibling plans run in parallel; any that names `worker-loop.ts` collides at merge time, so rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
