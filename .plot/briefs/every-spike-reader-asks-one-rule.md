## Implementation brief — record-names-no-branch-so-a (wave 2: Every reader asks the one rule)

- **Plan (canonical):** docs/plans/2026-11-04-record-names-no-branch-so-a.md on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3116 merged
- **Branch:** `feature/every-spike-reader-asks-one-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR, per repo convention

Both predecessors have merged: wave 1 (`feature/record-names-no-branch-so-a`, PR #3172) and `bug/the-queue-hands-out-an-approved-spike` (PR #3105). Cut the branch from current `origin/main`. Nothing waits on this slice.

### What to build

Wave 1 added `licensedSpike(record, slices)` in `packages/domain/src/rules/spike.ts` and made `approveSpike` write `<date>, <who>, <channel>, <branch>`. No reader calls it yet. Every reader still takes "a non-empty record" plus "the branch `spikeOf` names" as the licence, so a plan edit that moves the `<!-- spike -->` marker or renames the spike branch after approval moves the approval to another branch. Since #3105 merged, the registry queue reads the same two fields, so fleetd hands a moved spike branch to a free agent with no person in the loop. Issue #3101 tracks it.

After this slice every reader asks `licensedSpike`, the three board copies are deleted, and two gates name the reason a record licenses nothing. Build, in this order:

1. `packages/domain/src/rules/slice-readings.ts:26`: `spikeApproved` is `licensedSpike(plan.spikeApprovedRaw ?? '', plan.slices).licensed` instead of the `!== undefined && !== ''` test.
2. `packages/board/src/server/entry/gate.ts`: delete `approvedSpikeOf` (`:566`). Add a pure exported `spikeBranchOfRecord(record: PlanRecord): LicensedSpike` in the same file that calls `licensedSpike(record.spikeApprovedRaw, record.slices)`. The scratch-copy parse stays and calls it. `:758` passes `spikeBranch` and `spikeUnlicensed` to `phaseGateRefusal`.
3. `packages/board/src/server/entry/plangate.ts`: delete `spikeBranchOf` (`:55`). `planGateAnswer` shapes the slices as today and calls `licensedSpike` once, filling `spikeBranch` and `spikeUnlicensed` from it.
4. `packages/board/src/server/board.ts`: delete the exported `approvedSpikeOf` (`:1398`). `planEstate` (`:3149`) adds the branch where `meta.phase` is `design` and `licensedSpike(meta.spike_approved_raw, meta.slices)` answers `licensed: true`. `fleet.ts` (`approvedSpike` boolean) and `rules/draft-placement.ts` keep their boolean; change only their TSDoc to name `licensedSpike`.
5. `rules/phase-gate.ts`: `PhaseReadings` gains `spikeUnlicensed?: SpikeUnlicensed`. Where the phase is `design`, the branch is refused, and a reason other than `spike-record-absent` is present, the refusal text adds one line naming the reason and the re-approval command.
6. `workflows/dispatch.ts`: the plan gate readings gain `spikeUnlicensed?: SpikeUnlicensed`. In the `design` arm (`:604-618`), an empty `spikeBranch` with a `spikeUnlicensed` other than `spike-record-absent` refuses with the new reason `spike-unlicensed`, and the detail names the `SpikeUnlicensed` word. `rules/plangate-hints.ts` `planGateHint` answers `spike-unlicensed` with the re-approval command. A plan with no record keeps `state-wrong`.
7. `rules/card-controls.ts:70`: offer *Approve spike* where `licensedSpike` answers `licensed: false`, so a stale record shows the re-approval button. `rules/spike-confirm.ts:39`: `spikeCardState` answers `spike-not-approved` for any `licensed: false`.
8. TSDoc of `spikeBranch` in `phase-gate.ts`, `dispatch.ts` and `implement.ts` reads "the branch `licensedSpike` names, else `''`". `implement.ts` changes TSDoc only.
9. `skills/plot-implement/SKILL.md` (`:47`, `:69`, `:85`): the spike branch is the record's fourth field, and only where it equals the one branch whose parsed `spike` flag is true. A record with no fourth field, or one that names another branch, stops with: "The `Spike approved:` record of `<slug>` licenses no branch — re-run `plot-approve.mjs --spike <slug> --who <handle>`." Update this skill's Model Guidance table if a step changes.
10. A changeset: frontmatter names `'plot': patch` and `'@plot-pm/board': patch`; description first; the comment block last with `plan: docs/plans/2026-11-04-record-names-no-branch-so-a.md` and `bumps: skills: plot-implement: patch`.

New code is arrow functions (`export const f = (…) => …`). TSDoc states what the export does, its parameters, its return and how it fails; the reasoning stays in the plan and the commit message.

### Settled decisions — do not re-derive

- **Delete the three board copies; do not patch them.** `approvedSpikeOf` in `board.ts`, `approvedSpikeOf` in `entry/gate.ts` and `spikeBranchOf` in `entry/plangate.ts` each derive the licence the same wrong way. A patched copy is a fourth implementation free to drift. The agreement test below reads the source to enforce this.
- **The verdict word stays `unapproved`.** `sliceVerdict` keeps the word for a slice whose record licenses nothing; the verdict vocabulary does not change. The new words live only in the dispatch gate (`spike-unlicensed`) and the commit gate text.
- **No reason word on the card.** The card shows `spike-not-approved` and the re-approval button. #3122 files the reason word; do not add it here.
- **`licensedSpike` reads no phase.** Each caller already holds the phase and keeps its own phase test. Do not move a phase check into the rule.
- **The branch is parsed in the domain, not in awk.** `plot-plan-meta.sh` keeps `spike_approved_raw` verbatim, the plan parser and the plan-store corpus field do not change, and this slice adds zero shell lines. `scripts/check-shell-lines.sh pr` must report no growth.
- **The state gate does not refuse a marker move.** A commit gate holds only on a checkout with the hook installed. The data binding holds everywhere; the plan removed the other option.
- **A record with no branch licenses nothing (fail-closed).** Do not add a lenient reading for the date-only, two-field or three-field shapes.
- **Out of this slice, already filed:** #3122 (card reason word), #3123 (`entry/verdicts.ts` reads a `1/0` spike column no script writes), #3124 (`implement.ts` `spikeBranch` has no production caller). Do not fix them here.

Rules carried over: an empty or missing answer is not `false`; read the exit code, not the emptiness; a refusal leaves the plan file byte-identical.

### Done when

The plan's `## Slices` entry and its *Slice 2 work* section are the specification. The assertions that exist because a naive implementation would pass without them:

- **Verdict.** `packages/domain/test/slice-readings.test.ts`: a Design plan whose record names `feature/a` while the marker sits on `feature/b` gives `spikeApproved: false`, and `sliceVerdict` answers `unapproved` for `feature/b`'s slice; the same with `feature/a` renamed to `feature/c` and the marker on `feature/c`; a record `2026-11-03` answers `unapproved`. Each answers `eligible` before the change, which catches a reader still testing emptiness.
- **Commit gate.** `packages/domain/test/phase-gate.test.ts`: `phaseGateRefusal` with `phase: 'design'`, `spikeBranch: ''` and `spikeUnlicensed: 'spike-marker-moved'` names the reason and the re-approval command. `test/reconcile/gate.test.mjs`: extend `repoWith` with an optional plan body. A Design plan with record `…, feature/a` and the marker on `feature/x`, and a staged `src/a.js` on `feature/x`, exits 2 naming `spike-marker-moved` (exits 0 on main). A branchless record exits 2 naming `spike-record-branchless`. A bound record on `feature/x` exits 0 — the guard that catches an implementation which refuses everything.
- **Dispatch gate.** New `packages/board/test/unit/plangate-licensed-spike.test.ts` over the exported `planGateAnswer` with plan-meta JSON: a moved marker answers code 1 with `spike-unlicensed` and `spike-marker-moved`; a renamed branch with `spike-branch-renamed`; a branchless record with `spike-record-branchless`; a bound record on the asked branch answers code 0. The first three answer code 0 on main. `packages/domain/test/workflows-dispatch.test.ts` and `plangate-hints.test.ts` gain the `spike-unlicensed` case.
- **Agreement.** New `packages/board/test/unit/licensed-spike-agreement.test.ts`. For six fixtures (bound, moved marker, renamed branch, date-only, three-field, unparseable), `sliceReadingsOf`, `planGateAnswer`, `planEstate`'s `approvedSpikes`, `spikeBranchOfRecord` and `cardControls`/`spikeCardState` name the same licensed branch, or none. It also reads the source of `board.ts`, `entry/gate.ts`, `entry/plangate.ts` and `rules/slice-readings.ts`, asserts that each imports `licensedSpike`, and asserts that none tests the record for emptiness (`spike_approved_raw.trim()`, `spikeApprovedRaw.trim()`, `spikeApprovedRaw !== ''`). This catches a seventh reader added later.
- **Card.** `packages/domain/test/card-controls.test.ts`: a Design plan with a record that licenses nothing offers `approveSpike: true`. `spike-confirm.test.ts`: that record reads `spike-not-approved`.
- **Fixtures that write a branchless record and expect an admission** get a fourth field naming their marked branch: `packages/board/test/unit/a-design-plans-approved-spike-is-runnable.test.ts:122`, `packages/domain/test/approve-confirm.test.ts:26`, `packages/domain/test/spike-confirm.test.ts:27`, `:31`, `test/reconcile/approve.test.mjs:329`, `test/reconcile/scan-spike-readings.test.mjs:56`, `:88`. Fixtures that test only the parser keep their text: `test/reconcile/spike-marker.test.mjs:52-54`, `packages/board/test/unit/a-slice-is-marked-spike.test.ts:25-29`, `test/reconcile/state-gate.test.mjs:628`, `packages/domain/test/state-transition.test.ts:508`. Wave 1 may already have changed some of these; grep before editing.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (related domain and board vitest, `tsc --noEmit` for the domain, `pnpm run typecheck`, the reconcile tests that name a changed file, `node --test test/reconcile/*gate*.test.mjs`, the `./scripts/check-*.sh` list). Add `node --test test/reconcile/gate.test.mjs test/reconcile/scan-spike-readings.test.mjs test/reconcile/approve.test.mjs`. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. No browser test (`spike-card-states.browser.test.ts`), no `test/e2e/`, no board or fleet run.

`scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file and must add zero shell lines. Should a change ever need one, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

The board is first-class: this slice changes board server source, so run `pnpm run typecheck`. `main` rebuilds the board artifact after merge; commit no generated bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Changeset order: description first, `plan:` and `bumps:` inside the comment block last.

### Scope guard

This branch owns: `packages/domain/src/rules/slice-readings.ts`, `rules/phase-gate.ts`, `rules/plangate-hints.ts`, `rules/card-controls.ts`, `rules/spike-confirm.ts`, `rules/draft-placement.ts` (TSDoc only), `workflows/dispatch.ts`, `workflows/implement.ts` (TSDoc only), `packages/board/src/server/board.ts`, `entry/gate.ts`, `entry/plangate.ts`, `fleet.ts` (TSDoc only), `skills/plot-implement/SKILL.md`, one changeset, and the tests named above.

Other branches in flight, verified at brief time against `origin/main` `e3a2086a0`: no open pull request touches any of these files. Wave 1 (#3172) and #3105 are merged. Leave `rules/spike.ts`, `transitions/plan.ts`, `rules/plan-record-edit.ts` and `entry/approve.ts` alone; wave 1 owned them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
