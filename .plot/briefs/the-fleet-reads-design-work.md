## Implementation brief — the-fleet-writes-the-design (slice: What the fleet reads)

- **Plan (canonical):** [docs/plans/2026-10-12-the-fleet-writes-the-design.md](../../docs/plans/2026-10-12-the-fleet-writes-the-design.md) on `main`
- **Approved:** 2026-10-13, jwloka, plan-PR #1608 merged
- **Branch:** `feature/the-fleet-reads-design-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This is wave 2. Wave 1 (`feature/the-fleet-dispatches-an-approved-spike`, PR #1665) merged 2026-10-13. Wave 3 (`feature/the-fleet-commissions-the-spec`) builds on the rules this branch adds, so it stays blocked until this one merges.

### What to build

The fleet has no way to ask "does this Design plan still need a spec, and may a spec run start?". This slice adds the domain half of that answer and nothing that acts on it: no agent starts, no file under `packages/fleet/src/` changes, no board surface changes. Four moves, all in `packages/domain` except the one board import:

1. **`specOf` moves into the domain.** It lives today in `packages/board/src/server/entry/needs-design.ts:146-163`. Move it beside `SPEC_PLACEHOLDER` (`packages/domain/src/workflows/needs-design.ts:5`) and make the board entry import it. Behaviour does not change.
2. **`rules/fleet-run.ts` is extracted from `rules/auto-verify.ts`.** It takes `VerifyStore` as `RunStore`, `VERIFY_HALT_AFTER` as `RUN_HALT_AFTER`, `recordVerifyFailure` as `recordRunFailure`, `verifyRetryVerdict` as `runRetryVerdict`, `failuresSinceSuccess`, `verifyHalted` as `runHalted`, and a new `slotRefusal` holding the last three refusals of `verifyStart` (`queue-unread`, `no-free-agent`, `starved`). `auto-verify.ts` re-exports every moved name under its current name and `verifyStart` calls `slotRefusal`, so no verify caller changes.
3. **`rules/design-work.ts`** holds `specIsEmpty(text)`, `designWork(readings)`, `specStart(input)`, `specDeclined(pr, answeredPr)` and `specRow(slug, designCommit, store, log, going, now)`. The plan's *Design* section (lines 50-60) states the exact signatures, the refusal order of `specStart` and the answers of each function. Read it before writing a line.
4. **`DESIGN-phases.md` §8 (`:323`)** names the five functions with those signatures (the plan's cross-file duty).

### Settled decisions — do not re-derive them

**The store is shared, with four design-only fields on top.** `RunStore` carries run records, failures and `lastSuccessAt`. The design store adds `declined[slug]`, `answeredPr[slug]`, `restart[slug]` and `orphans[slug]`. Do not give the verify store those fields, and do not copy the failure rules into `design-work.ts`: the plan chose extraction so that one run-failure rule answers for both runs, and a copy is a second place for them to disagree.

**`specStart` refuses on local readings only, and the order is the contract.** `off`, `running`, `declined`, `halted`, `stopped`, `waiting`, `queue-unread`, `no-free-agent`, `starved`; `ask-host` when none applies. The host read comes last and lives in `specDeclined`, so a pass that refuses locally makes zero host calls — the Acceptance case wave 3 will test. A restart mark passes `off`, `declined`, `halted`, `stopped` and `waiting` once (D36); it does not pass `running` or the three slot refusals. An `open-pr` answer passes the slot refusals because it starts no agent.

**`running` covers a verify run too.** The machine keeps the `Parallel agents` + 1 bound, so `specStart` refuses while a verify run goes. The mirror refusal in `verifyStart` belongs to wave 3, not here.

**`designWork` reads `claimTip`'s answer, and `unknown` answers `none`.** Absent is not false: a ref the fleet could not read must neither start a run nor record a failure. `write-spec` needs `specRef: 'absent'` and an empty spec; `open-pr` needs `specRef: 'work'`, an empty-spec-or-written-spec reading as the plan states, and `prRetry`. Read `rules/claim.ts:15` and `:40` for `ClaimAnswer` and do not invent a new vocabulary.

**A link-only `## Spec` section counts as written.** `specIsEmpty` is true only for an absent section, `''` and `SPEC_PLACEHOLDER`. The spike does not change the answer: a spec and a spike are two forms of design work.

**`specDeclined`: a restart wins over an older closed PR.** A closed PR at or below `answeredPr` is one a person already answered with a restart, so it answers `start`; above it, `declined`. An open PR answers `pr-open`: start nothing, record nothing.

**Terminology.** Use `Agent` for the actor and `Slice` for a branch. `Wave` stays out of new code ([CLAUDE.md](../../CLAUDE.md), *The Domain Package*). New functions are arrows (`export const f = (…) => …`), and TSDoc states what an export does, its parameters, its return and how it fails — no history.

### Done when

The plan's `## Acceptance` is the specification. For this slice that is its second, third and fourth bullets (*Spec reading*, *Start rule*, *Rows*):

- `packages/domain/test/design-work.test.ts`: `specIsEmpty` for an absent section, an empty one, `SPEC_PLACEHOLDER` (true) and a link-only section and written text (false); `designWork` for each answer in the plan; `specStart` for each refusal in its order, with a fixture per refusal so a swapped order fails by name; `specDeclined` for its four answers; `specRow` for `working`, `waiting-on-you`, `stopped`, `halted` and `null` under another commit.
- `packages/domain/test/fleet-run.test.ts`: the extracted store rules answer as the verify tests did. **`auto-verify.test.ts` must still pass unchanged** — that is the guard that the extraction moved code and changed no behaviour. Do not edit that file to make it pass.
- The order test catches the naive implementation: a `specStart` that tests `declined` before `running` passes every single-refusal test and fails only a fixture where both hold.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — for `packages/domain/**` that is `vitest related` and `tsc --noEmit` for `@plot-pm/domain`, and because `needs-design.ts` in the board changes, the board's related tests and `pnpm run typecheck` as well. The suites in `CI suites` run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` is a no-op here: no `.sh` file changes. A change to `packages/domain` ships with a changeset per `## Versioning` in `CLAUDE.md`: description first, `bumps:` block last, package `plot` or `@plot-pm/board`; run `./scripts/check-changeset-packages.sh`. Never commit a `board-server.mjs` diff.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit: `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. No project board is configured here.

### Scope guard

This branch owns:
- `packages/domain/src/rules/fleet-run.ts` (new), `rules/auto-verify.ts` (re-exports and the `slotRefusal` call), `rules/design-work.ts` (new)
- `packages/domain/src/workflows/needs-design.ts` (receives `specOf`) and `packages/board/src/server/entry/needs-design.ts` (imports it)
- the domain's index exports for the new rules
- `packages/domain/test/design-work.test.ts`, `packages/domain/test/fleet-run.test.ts`
- `docs/stories/plot-works-in-five-phases/DESIGN-phases.md` §8

Other slices of this plan, from the plan's `## Slices` section: `feature/the-fleet-commissions-the-spec` owns `packages/fleet/src/shared/fleet-run.ts`, `auto-design.ts`, `assign.ts:229` and the `verifyStart` refusal for a going spec run; `feature/commission-design-is-removed` owns the board's commission route; `feature/the-board-shows-the-spec-run` owns `packages/board/src/app/lib/agent-rows/`. Do not touch those. The `verifyStart` change in this branch is the extraction of `slotRefusal` only; a new refusal there is wave 3's.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
