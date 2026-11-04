## Implementation brief — record-names-no-branch-so-a (wave 1: The record names its branch)

- **Plan (canonical):** docs/plans/2026-11-04-record-names-no-branch-so-a.md on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3116 merged
- **Branch:** `feature/record-names-no-branch-so-a` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR, per repo convention

This slice waits on `bug/plot-approve-reads-the-plan-from` (PR #3112, open at brief time). #3112 changes `workflows/approve.ts`, `entry/approve.ts`, `approve-spike.test.ts`, `approve.test.mjs` and `skills/plot-approve/SKILL.md`, all of which this slice changes. Start only when #3112 has merged, then rebase on `origin/main`. Wave 2 (`feature/every-spike-reader-asks-one-rule`) waits on this slice and on #3105, and switches the readers; this slice touches no reader.

### What to build

The `Spike approved:` record does not name the branch it licenses. `approveSpike` writes `${input.on}, ${who}, ${input.channel}` (`packages/domain/src/transitions/plan.ts:600`), and every reader treats "a non-empty record" plus "the branch `spikeOf` names" as the licence. A plan edit that moves the `<!-- spike -->` marker, or renames the spike branch, after approval therefore moves the approval to another branch. The state gate covers the record line and not the marker. Review finding M2 in #1637 named this; issue #3101 tracks it.

After this slice the record is `<date>, <who>, <channel>, <branch>` (for example `2026-11-04, jwloka, pr, feature/x`), one domain rule `licensedSpike` answers which branch a record licenses, and a record that licenses nothing is re-approved through the existing command.

Build, in this order:

1. `packages/domain/src/rules/spike.ts`: export `SpikeUnlicensed`, `LicensedSpike` and `licensedSpike(record, slices)` as the plan's *The rule* section defines them. Reasons are checked in the listed order: `spike-record-absent`, `spike-record-branchless`, `spike-record-unparseable`, `spike-none`, `spike-marker-moved`, `spike-branch-renamed`. The rule reads no phase.
2. `packages/domain/src/transitions/plan.ts`: `:600` writes the fourth field (`spike.branch`). `:533-538` refuses `spike-approved` only where `licensedSpike(record, slices)` answers `licensed: true`; any other reason except `spike-record-absent` falls through to a new decision, past the same `spike-none`, `spike-not-first`, review and `who` checks.
3. `packages/domain/src/rules/plan-record-edit.ts`: add `replaceStatusRecord(content, field, record)`. It replaces the first filled `- **<field>:**` line in `## Status` and calls `insertStatusRecord` where there is none.
4. `packages/board/src/server/entry/approve.ts`: `applySpikeWrites` calls `replaceStatusRecord` instead of `insertStatusRecord`; the dry-run line near `:1017` prints the branch.
5. Docs: `skills/plot-approve/SKILL.md:379` (record format) and `:391` (`spike-approved` refuses only while the record licenses the marked branch), `CLAUDE.md:540` (the record names the branch), then `./scripts/check-agents-md.sh --write`. TSDoc only in `workflows/approve.ts`.
6. A changeset: `'plot': minor`, description first and the `bumps:` block last, with `skills: plot-approve: minor` and the `plan:` line.

New code is arrow functions (`export const f = (…) => …`). TSDoc states what the export does, its parameters, its return and how it fails; the reasoning stays in the plan and the commit message.

### Settled decisions — do not re-derive

- **The branch is parsed in the domain, not in awk.** `plot-plan-meta.sh` keeps `spike_approved_raw` verbatim (`:285-286`, `:804`, `:1283`), the plan-store corpus field (`corpus/plan-store.corpus.test.ts:75`) does not change, and no shell line changes. `scripts/check-shell-lines.sh` must report zero lines added. Adding a branch field to the shell parser would pay in shell lines and create a second parser free to drift.
- **The state gate does not refuse a marker move.** A commit gate holds only on a checkout with the hook installed; a plan edit on the host or on another machine reaches `origin/main` unseen. The data binding holds everywhere. The plan removed this option; do not rebuild it.
- **A record with no branch licenses nothing (fail-closed).** This covers `Spike approved: 2026-11-03` (measured in #3095 on an adopting repository), `2026-10-12, jwloka` and the three-field shape written today. `git grep -n '^- \*\*Spike approved' origin/main -- docs/plans` finds zero plans, so this repository loses no admission. Do not add a lenient reading for old shapes.
- **The way out is a re-approval, and it replaces the line.** `insertStatusRecord` appends a second line, and the parser keeps the first one it reads (`plot-plan-meta.sh:1283`, `canon_spike_approved == ""`), so appending leaves the old record in force. This is why `replaceStatusRecord` exists. A test must prove one line remains.
- **The read-back at `entry/approve.ts:702` needs no change.** It compares the whole raw record to `decision.record`, and both now carry the branch. A test proves it rather than assuming it.
- **The receipt key stays `<plan path>#Spike approved`** with the new value. The state gate reads a changed value as a transition (`rules/state-transition.ts:314-345`) and clears it with that receipt.
- **`/plot-reslice` has no controller that writes the record.** A reslice that renames or moves the spike leaves a record that licenses nothing, and a person re-approves.
- **Out of this slice, already filed:** #3122 (card shows no reason word), #3123 (`verdicts.ts` reads a `1/0` spike column no script writes), #3124 (`implement.ts` `spikeBranch` has no production caller). Do not fix them here.

Rules carried over from related work: an empty or missing answer is not `false` (`spikeOf` answers `undefined`, never `false`); read the exit code, not the emptiness; a refusal leaves the plan file byte-identical.

### Done when

The plan's `## Slices` entry and its *Slice 1 work* section are the specification. The assertions that exist because a naive implementation would pass without them:

- **`licensedSpike` is tested over every reason, in order.** `packages/domain/test/spike.test.ts`, new `describe('licensedSpike')`: bound record with the marker on the same branch → `{ licensed: true, branch: 'feature/a', slice: 0 }`; marker on `feature/b` with `feature/a` still in the plan → `spike-marker-moved`; `feature/a` in no slice → `spike-branch-renamed`; `''` → `spike-record-absent`; `2026-11-03`, `2026-10-12, jwloka` and `2026-10-12, jwloka, in-session` → `spike-record-branchless`; `d, w, c, feature/a extra` and `d, w, c, ` → `spike-record-unparseable`; a bound record with two markers → `spike-none`. A branchless record on a plan with no marker answers `spike-record-branchless`, which catches an implementation that checks the marker first.
- **The decided record ends with `, feature/spike`** (`approve-spike.test.ts`; fails on main at `plan.ts:600`).
- **A three-field record answers a decision, not `spike-approved`** (fails on main at `:533`). The paired guard stays: a bound record on the marked branch still refuses `spike-approved`. Without the guard, an implementation that never refuses passes.
- **`replaceStatusRecord` leaves one line.** `plan-record-edit.test.ts`: a filled `Spike approved:` line is replaced in place; with no line it inserts as `insertStatusRecord` does.
- **End to end through the entry.** `test/reconcile/approve-entry.test.mjs` (fixture near `:217`): `--spike` over a plan whose record is `2026-10-01, jwloka, in-session` rewrites the one line to a four-field record, files the receipt under `<plan path>#Spike approved`, and the read-back passes. This fails on main with `spike-approved`.
- **`test/e2e/spike-dispatch.test.mjs:119`:** tighten the regex to end with `, in-session, feature/<spike>$` (multiline). This suite is CI's gate; do not run it locally.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (related domain and board vitest, `tsc --noEmit` for the domain, `pnpm run typecheck`, the reconcile tests that name a changed file, `node --test test/reconcile/*gate*.test.mjs`, the `./scripts/check-*.sh` list including `./scripts/check-agents-md.sh`). The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. No browser, e2e, board or fleet run.

`scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file and must add zero shell lines. Should a change ever need one, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Changeset order: description first, `plan:` and `bumps:` inside the comment block last.

### Scope guard

This branch owns: `packages/domain/src/rules/spike.ts`, `packages/domain/src/rules/plan-record-edit.ts`, `packages/domain/src/transitions/plan.ts`, `packages/domain/src/workflows/approve.ts` (TSDoc only), `packages/board/src/server/entry/approve.ts`, `skills/plot-approve/SKILL.md`, `CLAUDE.md`, `AGENTS.md`, one changeset, and the tests named above.

Other branches in flight, verified at brief time against `origin/main` `db54723e2`:

- `bug/plot-approve-reads-the-plan-from` (#3112, open) holds `workflows/approve.ts`, `entry/approve.ts`, `approve-spike.test.ts`, `approve.test.mjs` and `skills/plot-approve/SKILL.md`. A collision here is known: wait for the merge, then rebase.
- `bug/the-queue-hands-out-an-approved-spike` (#3105, open) adds `rules/slice-readings.ts` and removes the `plan-walk-assembly.ts:334` line. This slice does not touch either. Wave 2 does.
- `feature/every-spike-reader-asks-one-rule` (wave 2) owns every reader: `board.ts`, `entry/gate.ts`, `entry/plangate.ts`, `phase-gate.ts`, `dispatch.ts`, `plangate-hints.ts`, `card-controls.ts`, `spike-confirm.ts`, `skills/plot-implement/SKILL.md`. Leave them alone, including the fixtures wave 2 lists.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
