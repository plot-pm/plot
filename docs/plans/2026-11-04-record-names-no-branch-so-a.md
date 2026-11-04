# The Spike approved: record names no branch, so a moved marker moves the approval

> A plan edit that moves or renames the spike marker after approval moves the approval to another branch, so the record must bind to the branch it licenses.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3101
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3116 merged

## Changelog

- A `Spike approved:` record names the branch it licenses, for example `2026-11-04, jwloka, pr, feature/x`. Moving or renaming the `<!-- spike -->` marker after approval no longer admits another branch.
- A `Spike approved:` record that names no branch licenses nothing. Re-run `plot-approve.mjs --spike <slug> --who <handle>` (or `POST /api/approve {"slug":"<slug>","spike":true}`) to write a record with the branch. This applies to a spike already in flight: its commits and dispatch stop until the re-approval.

<!-- Board impact: board server source changes in slice 2. `packages/board/src/server/board.ts` (`approvedSpikeOf`, deleted), `entry/gate.ts` (`approvedSpikeOf`, deleted) and `entry/plangate.ts` (`spikeBranchOf`, deleted) call the domain rule `licensedSpike` instead. The card readings in `board.ts:2692` stay the raw record; `rules/card-controls.ts` and `rules/spike-confirm.ts` decide from it through `licensedSpike`. The plan parser and `plot-plan-meta.sh` do not change: `spike_approved_raw` stays the verbatim record, so the board contract (`schema.ts:166`) and the plan-store corpus field do not change. No card word changes. main rebuilds the board artifact after merge. Run `pnpm run typecheck`. -->

## Motivation

The `Spike approved:` record does not name the branch it licenses. `sliceVerdict` admits a Design plan's slice when `phase` is `design`, the slice names one branch, `spike === true` and `spikeApproved === true` (`packages/domain/src/rules/eligible.ts:132-133`). `spike` comes from the `<!-- spike -->` marker (`spikeOf`, `packages/domain/src/rules/spike.ts:37-41`). `spikeApproved` reads only that a record exists (`packages/domain/src/workflows/plan-walk-assembly.ts:334`).

`approveSpike` decides with a branch (`packages/domain/src/transitions/plan.ts:493-494`, `:601`) and writes only `${input.on}, ${who}, ${input.channel}` (`plan.ts:600`). The branch the person approved is not recorded.

The state gate covers the `Spike approved:` line (receipt key `<plan path>#Spike approved`). It does not cover the marker. A plan edit that moves the marker, or renames the spike branch, after approval moves the approval to that branch.

Design plans are edited during Design by people, by `Design command` agents and by `/plot-reslice`. A marker move is a normal edit. This was review finding M2 in #1637, closed and folded into #1836.

**Exposure on origin/main `e54e53815`.** Plan PR #3095 is merged, but its implementation PR #3105 (`bug/the-queue-hands-out-an-approved-spike`) is open. The registry queue on main reads no spike field (`git grep -i spike` over `packages/domain/src/rules/queue.ts` and `packages/fleet/src/shared/queue-reading.ts`: zero lines). So today a moved marker reaches the scan's `eligible` word, the board placement, the commit gate and the dispatch gate. When #3105 merges, the queue reads the same two fields and fleetd hands a moved or renamed spike branch to a free agent with no person in the loop.

**Every reader derives the licensed branch the same wrong way.** Each site below takes "a non-empty record" plus "the branch `spikeOf` names". Each one follows a moved marker. Verified on origin/main `e54e53815`:

| Site | What it decides |
|---|---|
| `packages/domain/src/workflows/plan-walk-assembly.ts:334` (moves to `rules/slice-readings.ts` with #3105) | the scan verdict, and the queue after #3105 |
| `packages/board/src/server/entry/gate.ts:561-580` `approvedSpikeOf`, called at `:758` | the commit gate: `phaseGateRefusal` (`rules/phase-gate.ts:178-197`) lets a commit on that branch through |
| `packages/board/src/server/entry/plangate.ts:51-63` `spikeBranchOf`, called at `:105` | the dispatch plan gate (`workflows/dispatch.ts:111-115`, `:609`), asked by `plot-dispatch.sh:2815` through `plot-ask.mjs plangate` |
| `packages/board/src/server/board.ts:1393-1401` `approvedSpikeOf`, called at `:3149` | `approvedSpikes`, which `fleet.ts:6433` turns into the `approvedSpike` boolean (`fleet.ts:4106-4116`) and `draftPlacement` reads (`rules/draft-placement.ts:13-16`, `:55`) |
| `packages/domain/src/rules/card-controls.ts:70` | whether the card offers *Approve spike* |
| `packages/domain/src/rules/spike-confirm.ts:39` | the card's spike state (`spike-not-approved` / `spike-approved` / `spike-merged`) |
| `skills/plot-implement/SKILL.md:69`, `:85` | the prose rule an agent applies before it starts the spike |

`workflows/implement.ts:61-65` and `:144` take a `spikeBranch` reading, and no production caller supplies it on origin/main (`git grep 'spikeBranch:' origin/main -- packages` finds only `plangate.ts:105`). Filed as #3124.

`packages/board/src/server/entry/verdicts.ts:66-113` reads a `1/0` spike-approved column, and no script writes it on origin/main: `plot-fleet-scan.sh` is a 276-line launcher with zero `spike` lines. This plan does not change it. Filed as #3123.

## Design

### Decision

**Settled by the person (jwloka), 2026-11-04: option 1.** The approval writes the licensed branch into the `Spike approved:` record, and one domain rule answers which branch a record licenses. The state gate does not refuse a marker move (the former option 2 is removed): a commit gate holds only on a checkout with the hook installed, and a plan edit on the host or on another machine reaches `origin/main` unseen. The data binding holds everywhere.

### The record format

`approveSpike` (`transitions/plan.ts:600`) writes `<date>, <who>, <channel>, <branch>`, for example `2026-11-04, jwloka, pr, feature/x`. The branch is the fourth field: the text after the third `, ` separator, trimmed.

### The rule

One arrow function in `packages/domain/src/rules/spike.ts`:

```ts
export type SpikeUnlicensed =
  | 'spike-record-absent'      // no record, or an empty one
  | 'spike-record-branchless'  // fewer than four fields: `2026-11-03`, `2026-10-12, jwloka`, `2026-10-12, jwloka, in-session`
  | 'spike-record-unparseable' // a fourth field that is empty after trim, holds whitespace, or is followed by a fifth field
  | 'spike-none'               // the plan marks no branch, or more than one (`spikeOf` answers undefined)
  | 'spike-marker-moved'       // the record's branch is in the plan, but the marker is on another branch
  | 'spike-branch-renamed';    // the record's branch is in no slice of the plan

export type LicensedSpike =
  | { readonly licensed: true; readonly branch: string; readonly slice: number }
  | { readonly licensed: false; readonly reason: SpikeUnlicensed };

export const licensedSpike = (record: string, slices: readonly SpikeSlice[]): LicensedSpike => …
```

The rule takes the verbatim record (`spikeApprovedRaw`, `spike_approved_raw`) and the parsed slices. It answers `licensed: true` only where the record's fourth field equals `spikeOf(slices)?.branch`. It reads no phase: each caller already holds the phase and keeps its own phase test. The reasons are checked in the order listed, so a branchless record on a plan with no marker answers `spike-record-branchless`.

**The branch is parsed in the domain, not in awk.** `plot-plan-meta.sh` keeps `spike_approved_raw` verbatim (`:285-286`, `:804`, `:1283`), the plan-store corpus field (`packages/domain/corpus/plan-store.corpus.test.ts:75`) stays the same, and no shell line changes, so `scripts/check-shell-lines.sh` does not move.

### The legacy record

**Settled by the person: a record with no branch licenses nothing (fail-closed).** This covers the date-only `Spike approved: 2026-11-03` shape that #3095 measured on an adopting repository on 2026-11-03, the two-field `2026-10-12, jwloka` shape in test fixtures, and the three-field shape `approveSpike` writes on origin/main today. Measured on origin/main `e54e53815`: `git grep -n '^- \*\*Spike approved' origin/main -- docs/plans` finds zero plans, so no plan in this repository loses an admission. Plan branches not on main and adopting repositories were not measured; the changelog line tells them to re-approve.

### The re-approval path

**Settled by the person: the way out is a re-approval through `plot-approve.mjs --spike` or `POST /api/approve {"slug":"<slug>","spike":true}`.** This also covers a moved marker and a renamed branch.

- `approveSpike` (`transitions/plan.ts:533-538`) refuses `spike-approved` only where `licensedSpike(record, slices)` answers `licensed: true`. A record that licenses nothing (any `SpikeUnlicensed` reason other than `spike-record-absent`) no longer refuses: the transition decides a new record as for a plan with no record, and passes the same `spike-none`, `spike-not-first`, review and `who` checks.
- The write replaces the existing line. A new arrow function `replaceStatusRecord(content, field, record)` in `packages/domain/src/rules/plan-record-edit.ts` replaces the first filled `- **<field>:**` line in `## Status`, and calls `insertStatusRecord` where there is none. `applySpikeWrites` (`packages/board/src/server/entry/approve.ts:664-706`) calls it instead of `insertStatusRecord`. Without the replace, `insertStatusRecord` (`plan-record-edit.ts:169-201`) appends a second line, and the parser keeps the first one it reads (`plot-plan-meta.sh:1283`, `canon_spike_approved == ""`).
- The read-back check at `entry/approve.ts:702` compares the whole raw record to `decision.record`. Both carry the branch, so the check needs no change, and a test proves it.
- The receipt is filed under the same key, `<plan path>#Spike approved`, with the new value. The state gate reads a changed value as a transition (`rules/state-transition.ts:314-345`) and clears it with that receipt.
- `/plot-reslice` follows the same path. A reslice that renames or moves the spike leaves a record that licenses nothing, and a person re-approves. No reslice controller writes the record.

### Named reasons and where they show

- **Dispatch gate.** The plan gate readings (`workflows/dispatch.ts:111-115`) gain `spikeUnlicensed?: SpikeUnlicensed`. `plangate.ts` fills `spikeBranch` and `spikeUnlicensed` from one `licensedSpike` call. In the `design` arm (`dispatch.ts:604-618`), an empty `spikeBranch` with a `spikeUnlicensed` other than `spike-record-absent` refuses with the new reason `spike-unlicensed`, and the detail names the `SpikeUnlicensed` word. `planGateHint` (`rules/plangate-hints.ts`) answers `spike-unlicensed` with the re-approval command. A plan with no record keeps `state-wrong`.
- **Commit gate.** `PhaseReadings` (`rules/phase-gate.ts:172-183`) gains `spikeUnlicensed?: SpikeUnlicensed`. Where the phase is `design`, the branch is refused, and a reason other than `spike-record-absent` is present, the refusal text adds one line naming the reason and the re-approval command.
- **Card.** `cardControls` offers *Approve spike* (`card-controls.ts:67-74`) where `licensedSpike` answers `licensed: false` instead of where the record is empty, so the re-approval button shows. `spikeCardState` (`spike-confirm.ts:37-41`) answers `spike-not-approved` for any `licensed: false`. The card shows no reason word in this plan; #3122 files that.
- **Scan verdict and queue.** `sliceVerdict` keeps the word `unapproved` for a slice whose record licenses nothing. The verdict vocabulary does not change.

### Readers switched to the one rule

Every site in the Motivation table calls `licensedSpike`. The three board copies are deleted, not patched:

- `rules/slice-readings.ts` (added by #3105): `spikeApproved` is `licensedSpike(plan.spikeApprovedRaw ?? '', plan.slices).licensed`.
- `entry/gate.ts:566-580`: delete `approvedSpikeOf`. A pure exported `spikeBranchOfRecord(record: PlanRecord): LicensedSpike` (in `gate.ts`) calls `licensedSpike(record.spikeApprovedRaw, record.slices)`; the scratch-copy parse stays and calls it. `:758` passes `spikeBranch` and `spikeUnlicensed` to `phaseGateRefusal`.
- `entry/plangate.ts:51-63`: delete `spikeBranchOf`. `planGateAnswer` (`:77`) shapes the slices as today and calls `licensedSpike` once.
- `board.ts:1393-1401`: delete `approvedSpikeOf`. `planEstate` (`:3149`) adds the branch where `meta.phase` is `design` and `licensedSpike(meta.spike_approved_raw, meta.slices)` answers `licensed: true`. `fleet.ts:4106-4116` and `draft-placement.ts:13-16`, `:55` keep their boolean and change only their TSDoc to name `licensedSpike`.
- `phase-gate.ts:178`, `dispatch.ts:111`, `implement.ts:61`: TSDoc of `spikeBranch` names `licensedSpike` ("the branch `licensedSpike` names, else `''`").
- `card-controls.ts:70`, `spike-confirm.ts:39`: as in *Named reasons* above.
- `skills/plot-implement/SKILL.md:47`, `:69`, `:85`: the spike branch is the record's fourth field, and only where it equals the one branch whose parsed `spike` flag is true. A record with no fourth field, or one that names another branch, stops with: "The `Spike approved:` record of `<slug>` licenses no branch — re-run `plot-approve.mjs --spike <slug> --who <handle>`."

### Docs the slices update

- `skills/plot-approve/SKILL.md:379` (the record format), `:391` (`spike-approved` refuses only while the record licenses the marked branch; a record that licenses nothing is re-approved).
- `CLAUDE.md:540`: the `--spike` sentence says the record names the branch. Regenerate `AGENTS.md` with `./scripts/check-agents-md.sh --write`.
- `skills/plot/MANIFESTO.md:23` already says "licenses implementation of its one branch and no other" and does not change.

### Seams

- **Open PR #3105** (`bug/the-queue-hands-out-an-approved-spike`) adds `rules/slice-readings.ts` and removes the `plan-walk-assembly.ts:334` line. Slice 2 waits on it and changes `slice-readings.ts`.
- **Open PR #3112** (`bug/plot-approve-reads-the-plan-from`) changes `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/approve.ts`, `packages/domain/test/approve-spike.test.ts`, `test/reconcile/approve.test.mjs` and `skills/plot-approve/SKILL.md`, all of which slice 1 changes. Slice 1 waits on it.

### Slice 1 work: the record names its branch

**Files.** `packages/domain/src/rules/spike.ts` (`SpikeUnlicensed`, `LicensedSpike`, `licensedSpike`); `packages/domain/src/transitions/plan.ts` (`:533-538` refusal, `:600` record); `packages/domain/src/rules/plan-record-edit.ts` (`replaceStatusRecord`); `packages/board/src/server/entry/approve.ts` (`applySpikeWrites` calls `replaceStatusRecord`; dry-run line `:1017` prints the branch); `packages/domain/src/workflows/approve.ts` (TSDoc of the refusal list only); `skills/plot-approve/SKILL.md:379`, `:391`; `CLAUDE.md:540`; `AGENTS.md`; a changeset (`'plot': minor`, `bumps: skills: plot-approve: minor`, `plan:` line).

**Tests that fail on origin/main and pass after.**

- `packages/domain/test/spike.test.ts`, new `describe('licensedSpike')`: bound record `2026-11-04, j, pr, feature/a` with the marker on `feature/a` → `{ licensed: true, branch: 'feature/a', slice: 0 }`; marker on `feature/b`, `feature/a` still in the plan → `spike-marker-moved`; `feature/a` in no slice → `spike-branch-renamed`; `''` → `spike-record-absent`; `2026-11-03` and `2026-10-12, jwloka` and `2026-10-12, jwloka, in-session` → `spike-record-branchless`; `d, w, c, feature/a extra` and `d, w, c, ` → `spike-record-unparseable`; a bound record with two markers → `spike-none`. Fails on main: the export does not exist.
- `packages/domain/test/approve-spike.test.ts`: the decided `record` ends with `, feature/spike` (fails on main: `plan.ts:600`); a three-field record answers a decision, not `spike-approved` (fails on main: `:533`); a bound record on the marked branch still refuses `spike-approved` (passes on main, kept as a guard).
- `packages/domain/test/plan-record-edit.test.ts`: `replaceStatusRecord` replaces a filled `Spike approved:` line in place and leaves one line; with no line it inserts as `insertStatusRecord` does.
- `test/reconcile/approve-entry.test.mjs` (fixture at `:217`): `--spike` over a plan whose record is `2026-10-01, jwloka, in-session` rewrites the one line to a four-field record, files the receipt under `<plan path>#Spike approved`, and the read-back at `entry/approve.ts:702` passes. Fails on main with `spike-approved`.
- `test/e2e/spike-dispatch.test.mjs:119`: tighten the regex to end with `, in-session, feature/<spike>$` (multiline). This suite is CI's gate; do not run it locally.

**Gates.** `node skills/plot/scripts/board/plot-local-checks.mjs` and every command it prints: `pnpm --filter @plot-pm/domain exec vitest related --run <changed>`, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`, `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <changed>`, `pnpm run typecheck`, `node --test test/reconcile/approve-entry.test.mjs test/reconcile/approve.test.mjs test/reconcile/state-gate.test.mjs`, `node --test test/reconcile/*gate*.test.mjs`, and the `./scripts/check-*.sh` list, including `./scripts/check-shell-lines.sh pr` (expected: zero shell lines added) and `./scripts/check-agents-md.sh`. No browser, e2e, board or fleet run.

### Slice 2 work: every reader asks the one rule

**Files.** `packages/domain/src/rules/slice-readings.ts`; `packages/domain/src/rules/phase-gate.ts`; `packages/domain/src/workflows/dispatch.ts`; `packages/domain/src/rules/plangate-hints.ts`; `packages/domain/src/workflows/implement.ts` (TSDoc only); `packages/domain/src/rules/card-controls.ts`; `packages/domain/src/rules/spike-confirm.ts`; `packages/domain/src/rules/draft-placement.ts` (TSDoc only); `packages/board/src/server/board.ts`; `packages/board/src/server/entry/gate.ts`; `packages/board/src/server/entry/plangate.ts`; `packages/board/src/server/fleet.ts` (TSDoc only); `skills/plot-implement/SKILL.md`; one changeset naming `'plot': patch` and `'@plot-pm/board': patch` in its frontmatter, with `bumps: skills: plot-implement: patch` and a `plan:` line.

**Fixtures that write a branchless record and expect an admission** get a fourth field naming their marked branch: `packages/board/test/unit/a-design-plans-approved-spike-is-runnable.test.ts:122`, `packages/domain/test/approve-confirm.test.ts:26`, `packages/domain/test/spike-confirm.test.ts:27`, `:31`, `test/reconcile/approve.test.mjs:329`, `test/reconcile/scan-spike-readings.test.mjs:56`, `:88`. Fixtures that test only the parser keep their text: `test/reconcile/spike-marker.test.mjs:52-54`, `packages/board/test/unit/a-slice-is-marked-spike.test.ts:25-29`, `test/reconcile/state-gate.test.mjs:628`, `packages/domain/test/state-transition.test.ts:508`.

**Tests that fail on origin/main and pass after.**

- Verdict: `packages/domain/test/slice-readings.test.ts` (added by #3105): a Design plan whose record names `feature/a` while the marker sits on `feature/b` gives `spikeApproved: false`, and `sliceVerdict` answers `unapproved` for `feature/b`'s slice; the same with `feature/a` renamed to `feature/c` and the marker on `feature/c`; a record `2026-11-03` answers `unapproved`. Each answers `eligible` before the change.
- Commit gate: `packages/domain/test/phase-gate.test.ts`: `phaseGateRefusal` with `phase: 'design'`, `spikeBranch: ''` and `spikeUnlicensed: 'spike-marker-moved'` names the reason and the re-approval command. `test/reconcile/gate.test.mjs`: extend `repoWith` with an optional plan body; a Design plan with record `…, feature/a` and the marker on `feature/x`, and a staged `src/a.js` on `feature/x`, exits 2 naming `spike-marker-moved` (exits 0 on main); with a branchless record it exits 2 naming `spike-record-branchless`; with a bound record on `feature/x` it exits 0.
- Dispatch gate: new `packages/board/test/unit/plangate-licensed-spike.test.ts` over the exported `planGateAnswer` (`plangate.ts:77`) with plan-meta JSON: a moved marker answers code 1 with `spike-unlicensed` and `spike-marker-moved`; a renamed branch with `spike-branch-renamed`; a branchless record with `spike-record-branchless`; a bound record on the asked branch answers code 0. The first three answer code 0 on main. `packages/domain/test/workflows-dispatch.test.ts` and `plangate-hints.test.ts` gain the `spike-unlicensed` case.
- Agreement: new `packages/board/test/unit/licensed-spike-agreement.test.ts`. For six fixtures (bound, moved marker, renamed branch, date-only, three-field, unparseable), it asserts that `sliceReadingsOf`, `planGateAnswer`, `planEstate`'s `approvedSpikes`, `spikeBranchOfRecord` and `cardControls`/`spikeCardState` name the same licensed branch, or none. It also reads the source of `board.ts`, `entry/gate.ts`, `entry/plangate.ts` and `rules/slice-readings.ts` and asserts that each imports `licensedSpike` and that none tests the spike record for emptiness (`spike_approved_raw.trim()`, `spikeApprovedRaw.trim()`, `spikeApprovedRaw !== ''`).
- Card: `packages/domain/test/card-controls.test.ts`: a Design plan with a record that licenses nothing offers `approveSpike: true`; `spike-confirm.test.ts`: that record reads `spike-not-approved`.

**Gates.** As slice 1, plus `pnpm run typecheck` for the board types, `node --test test/reconcile/gate.test.mjs test/reconcile/scan-spike-readings.test.mjs test/reconcile/approve.test.mjs`, and `./scripts/check-shell-lines.sh pr` (expected: zero shell lines added). No browser test (`spike-card-states.browser.test.ts`), no `test/e2e/`, no board or fleet run.

## Slices

### The record names its branch

- `feature/record-names-no-branch-so-a` <!-- waits: bug/plot-approve-reads-the-plan-from --> — add `licensedSpike`, write the branch into the record, add the re-approval path

### Every reader asks the one rule

- `feature/every-spike-reader-asks-one-rule` <!-- waits: bug/the-queue-hands-out-an-approved-spike --> — switch every reader to `licensedSpike`, delete the three board copies, name the refusal reasons

## Notes

- Source: tracker issue #3101, evidence re-read at origin/main `e54e53815` on 2026-11-04.
- Round 1: four-juror panel, `.plot/panels/2026-11-04-record-names-no-branch-so-a/panel.md`. Filed from it: #3122, #3123, #3124.
- Related: #1637, #1836, #3092, plan PR #3095 (merged), PR #3105 (open), PR #3112 (open).
