## Implementation brief — the-controller-gate-reads-every-command-segment (wave 2: Reserved word)

- **Plan (canonical):** docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3610 merged
- **Branch:** `bug/a-reserved-word-hides-no-program` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan Review: `pr`

Slice 2 of 2. Slice 1, `bug/the-controller-gate-reads-a-loop-body-as-a-segment`, merged as #3627 (`aa25317e3`) and added `gitSubcommand`, `RUNS_TEXT` and the `isReadSegment` loop-body test this slice builds on. Nothing waits on this branch.

### What to build

A shell reserved word hides the program that follows it. After a split on `;`, a loop-body segment starts with `do` and an `if` branch with `then`, and `programWords` (`ci-suite.ts:216`) skips assignments and `env` only, so every caller reads `do` or `then` as the program. Pure-function answers on `origin/main` `b21961602`: `controllerHttpAction` answers `null` for `while curl -X POST …/api/release; do break; done`, `if curl -X POST …/api/release; then :; fi`, `! curl -X POST …/api/release`, `(curl -X POST …/api/release)` and `time curl -X POST …/api/release`; `unpinnedMerges` answers `[]` for `if true; then gh pr merge 12; fi`, `for i in 1; do gh pr merge 12; done` and `! gh pr merge 12`; `ciSuiteRefusal` answers `null` for `for i in 1; do pnpm run test:e2e; done`. The same blind spot refuses reads: `if true; then cat plot-deliver.sh; fi`, `while true; do cat plot-deliver.sh; done` and `{ cat plot-deliver.sh; }` answer `'deliver'`. It also closes the HTTP form of #3165, `while X=ps curl -X POST …/api/release`.

Changes, in `packages/domain/src/rules/` plus tests. The gate (`packages/board/src/server/entry/gate.ts`) and `plot-controller-gate.sh` call the rules and do not change.

1. **One exported `LEADING_KEYWORDS` in `ci-suite.ts`:** `!`, `{`, `(`, `do`, `then`, `else`, `elif`, `if`, `while`, `until`, `time`.
2. **`programWords` skips them.** It skips any run of them before the assignment loop, skips `-p` after `time`, drops a `(` glued to the first word, and drops a `)` glued to the segment's last word. The last strip is what lets `(curl -X POST …/api/release)` read the route: `routeIn` accepts only the end of the word, `/`, `?` or `#` after the route.
3. **`commandWords(words)`, a new arrow,** returns the words after the leading keywords. `isReader` and `isReadSegment` read their program from it, and the assignment test in `isReadSegment` (`ci-suite.ts:532-533`) compares `programWords(words)` against `commandWords(words)` instead of against `words`. Without this, `do cat x` reads as prefixed and the read is refused.
4. **`isProcessRead` keeps its own `while`/`until` reading.** `isReader` passes it the segment's original `words`, not `commandWords`, and `isProcessRead` keeps stepping over one `while` or `until` and nothing else.
5. **Fold the two copies of the set.** Remove `LEADING_KEYWORDS` and `withoutLeadingKeywords` from `main-checkout-write.ts` (`:155-170`) and call `programWords` alone at `:186` and `:508`. In `poll-refusal.ts` (`:39`, applied at `:89`) import the shared set and drop the local one; keep `CLOSING_KEYWORDS`.
6. **No change of their own** for `httpRouteAction`, `mergeCall` (`controller-gate.ts:249`), `ciSuiteRefusal`, `programIndex` (`controller-gate.ts:80`), `cdOf` (`main-checkout-write.ts:141`) and `subAndArgsOf`: they call `programWords` and gain the reading. `programIndex` then finds the message of `do git commit -m "…"`, and `cdOf` reads `then cd x`.

Functions are arrows, and TSDoc states behaviour only. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`isProcessRead` must not read through `commandWords`.** Measured by the estate juror: if it did, the pinned row `ci-suite.test.ts:437`, `until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done` → `'deliver'`, and `if pgrep -f plot-deliver.mjs; then :; fi` would both change from `'deliver'` to `null`. The 2026-11-04 decision (`docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md:79`) admits a leading `while` or `until` only, and `until ! pgrep …` stays refused. That decision stands.

**Do not keep a local keyword set in `main-checkout-write.ts` or `poll-refusal.ts`.** The estate juror found three copies of one set, each missing a different word: `main-checkout-write.ts` lacks `then`, `else` and `(`, and `poll-refusal.ts` lacks `time`. A fourth copy is the defect. Two rows are red for that reason: `if true; then cd <dir>; fi; git commit -m x` and `time gh run watch`.

**`time` and a glued `(` stay in the set, and a glued `)` on the last word is stripped.** Coordinator decision after panel round 1, 2026-11-21. Do not reopen it.

**Do not reuse `gitSubcommand`'s option handling or an existing git option set** for anything here. Slice 1 settled that `-c`, `--git-dir` and `--work-tree` stay runs.

Rules carried over unchanged from slice 1: a refusal-by-default reading never turns an unreadable command into a pass; `RUNS_TEXT` stays narrow (the six citation rows stay `null`); an interpreter that only reads a gated file stays a run.

### Done when

The plan's `## Slices` entry for this branch and the Tests list under *Slice 2* in the plan are the specification. Every row there is red (fails on `origin/main`, passes after) unless marked guard. The assertions that exist because a naive implementation would pass without them:

- **The pinned `until ! pgrep …` row → `'deliver'` and `if pgrep -f plot-deliver.mjs; then :; fi` → `'deliver'`** (guard) catch an `isProcessRead` that reads through `commandWords`.
- **`(curl -X POST …/api/release)` → `'release'`** catches a `programWords` that skips a leading `(` but not the glued `)`.
- **`if [ -f skills/plot/scripts/plot-deliver.sh ]; then echo yes; fi` → `null`** catches a `commandWords` that is not wired into the assignment test.
- **`while X=ps curl -X POST …/api/release; do break; done` → `'release'`** (the #3165 form) catches keyword skipping that happens after the assignment loop.
- **`for i in 1; do gh pr merge 12 --match-head-commit abc; done` → `[]`** (guard) catches an over-wide `unpinnedMerges`.
- **`unpinnedMerges`, `withoutMessageSinks`, `cdOf` and the poll rows:** `for i in 1; do git commit -m "plot-deliver.sh"; done` blanks its message; `if true; then cd <dir>; fi; git commit -m x` reads `<dir>`; `time gh run watch` refuses as `gh run watch` does.
- Every other existing row in `ci-suite.test.ts`, `controller-gate.test.ts`, `main-checkout-write.test.ts` and `poll-refusal.test.ts` keeps its answer.

Plus: add a changeset for package `plot`, patch, description first and the `bumps:` block last, with `plan: docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md` inside the block; the description comes from the plan's Changelog entries for this slice (the reserved-word entries). Neither slice bumps a skill. The PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally, then restore the generated paths before you push.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Use Node 26 (`nvm use`).

The change is domain TypeScript and tests only and adds no shell, so `scripts/check-shell-lines.sh` is untouched. If the slice ever touches a `.sh` file, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to the branch line under `## Slices` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ci-suite.ts`, `controller-gate.ts`, `main-checkout-write.ts`, `poll-refusal.ts`, their four test files under `packages/domain/test/`, and one changeset.

No other branch of this plan is in flight; slice 1 is merged. Line numbers above are from `origin/main` `c1bd99e20`, after slice 1.

Out of scope, filed as a follow-up in the plan: `controllerInvocation` throws `Invalid regular expression` from `globToRegExp` for `jq '.["plot-deliver.sh"]' f.json`. Do not fix it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
