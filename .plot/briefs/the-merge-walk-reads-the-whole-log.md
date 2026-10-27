## Implementation brief — read-merged-prs-from-the-merge (wave 2: Whole Merge Walk)

- **Plan (canonical):** `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2419 merged
- **Branch:** `bug/the-merge-walk-reads-the-whole-log` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 of 3. Wave 1 (`bug/a-bitbucket-listing-reads-every-page`) merged as PR #2730 — this wave is eligible. `bug/impl-status-asks-merged-prs-by-branch` (wave 3) does not depend on this wave and may run concurrently.

### What to build

The wave gate's merge walk caps at 2000 merges and silently drops anything older. `plot-fleet-scan.sh` reports saturation when it hits the cap (`note: merge scan hit its limit of N`), but `MERGE_WALK_LIMIT` in the fleet package and the corpus test default carry no such report — they just stop looking. Measured 2026-10-26 on ewz-kus-portal (`origin/develop`): 2340 merges walked in 0.02 s. Raise all three caps to 20 000 — 8.5× the largest measured log — so no real estate saturates silently:

- `MERGE_SCAN_LIMIT` in `skills/plot/scripts/plot-fleet-scan.sh` (currently `${PLOT_MERGE_SCAN_LIMIT:-2000}` near line 472)
- `MERGE_WALK_LIMIT` in `packages/fleet/src/server/entry/registryd-main.ts:609` (`export const MERGE_WALK_LIMIT = 2000;`, used at `:639` via `refs.mergeSubjects(ref, MERGE_WALK_LIMIT)`)
- the corpus default in `readMergeSubjects` — `packages/domain/corpus/production.ts`, the `limit = 2000` parameter, read by `branch-state.corpus.test.ts:340,392`

The plan is canonical; this is orientation. Note the plan's file citations for `registryd-main.ts` and `merge-subjects.ts` are stale relative to the current tree — the real paths are listed below under Scope guard.

### Decisions the plan settles — do not re-derive them

**Full walk, not an incremental cursor.** Answered in the plan's Open Points round 1: 0.02 s for 2340 merges on the measured estate is cheap enough that a cursor buys nothing but a new field to maintain. Do not add one.

**20 000 is a guard against a pathological history, not an optimisation.** The existing saturation test's own comment makes this explicit: capped walk at 500 merges = 7.7 ms, uncapped at 2000 merges = 11.8 ms. A blind low cap re-creates this plan's own bug — an early merge silently reads `open`. 20 000 is chosen as a ceiling no real repository is expected to reach, not a tuned value.

**The scan's saturation report stays; nothing here adds one to the fleet package.** `plot-fleet-scan.sh`'s `MERGE_SCAN_TRUNCATED` / `note: merge scan hit its limit` footer is unchanged — only the default moves. `registryd-main.ts` gets no equivalent saturation report; the plan's Approach section says why (it isn't in scope here) — do not add one.

**All three caps must move together and stay equal.** The plan requires a test asserting the scan's default, `MERGE_WALK_LIMIT`, and the corpus default are the same number. Three independent literals exist today (one shell variable default, one exported TS constant, one default parameter value) — there is no shared constant to import, so each site is edited by hand and the equality is enforced by a test, not by the type system.

**Comment corrections, not just numbers.** Two comments go stale and must be rewritten as part of this slice, not left for later:
- `packages/domain/src/adapters/host/merge-subjects.ts` — the Bitbucket form's comment currently says *"1723 of 1723 `Merged in` subjects sit on two-parent merges, so a `--merges` walk loses none."* Replace with the measured counter-evidence: across about 70 local Bitbucket clones, 7 single-parent commits in 5 repositories carry a `Merged in` subject (so a `--merges` walk *does* lose a few — rare, but real). State the Bitbucket squash measurement beside the existing GitHub squash/rebase measurement in the same doc comment block, rather than overwriting it.
- `packages/board/src/server/entry/merge-subject.ts:39` — currently says *"a stream carries a walk of up to 2000 merges"*. Change `2000` to `20 000`.

**Rules carried over unchanged:** this slice writes no index row and adds no new ancestry-decision call — it only changes how many merges the existing walk reads before giving up. The saturation/truncation reporting mechanism itself (shell: `MERGE_SCAN_TRUNCATED`; the footer note) is untouched.

**Out of scope:** the `registryd-main.ts` saturation report (plan's Approach section explains why none is added), any change to which merges are examined (still `git log --merges`, still first-parent-agnostic — the squash-walk question is a separate, still-open Open Point the plan explicitly defers), and anything about the Bitbucket listing (that was wave 1, already merged).

### Done when

The plan's slice line is the specification: all three caps rise to 20 000, the scan's saturation report is unchanged, and the two comments above are corrected. Tests the plan names, each catching a naive pass:

- The existing saturation tests in `test/reconcile/fleet.test.mjs` (e.g. `'fleet: a saturated merge walk is reported, never silent'`, using `PLOT_MERGE_SCAN_LIMIT` as an env override) must keep passing unchanged — they force saturation via the env seam regardless of the default, so raising the default must not touch their behavior. If one of them breaks, the default change leaked into the seam somehow; find out why rather than loosening the test.
- A new test asserts `MERGE_SCAN_LIMIT`'s default (shell), `MERGE_WALK_LIMIT` (TS constant), and the corpus `readMergeSubjects` default parameter are all equal to 20 000 — this is the test that catches a future edit to one site without the other two.

Plus: add a changeset (description first, `bumps:` block last — the order is load-bearing, a `bumps:` block written first becomes the published description). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally — it is CI's gate, not a local one.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice changes one number on one existing line in `plot-fleet-scan.sh` — 0 commands added, no offset to pay.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Whole Merge Walk` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned (current tree paths — the plan's own citations for these two are stale):
- `skills/plot/scripts/plot-fleet-scan.sh` (`MERGE_SCAN_LIMIT` near line 472)
- `packages/fleet/src/server/entry/registryd-main.ts` (`MERGE_WALK_LIMIT`, line 609; used at line 639 — **not** `packages/fleet/src/shared/registryd-main.ts`, which does not exist)
- `packages/domain/corpus/production.ts` (`readMergeSubjects`'s `limit` default)
- `packages/domain/src/adapters/host/merge-subjects.ts` (Bitbucket comment, **not** a non-existent `merge-subjects.ts` at a different path)
- `packages/board/src/server/entry/merge-subject.ts:39` (the `2000` in the stdin-format doc comment)
- `test/reconcile/fleet.test.mjs` (new equality test; existing saturation tests must keep passing)
- `packages/domain/corpus/branch-state.corpus.test.ts` (reads the corpus default at lines 340, 392 — verify it still passes, do not edit unless the default's removal breaks it)

Not yours: `skills/plot/scripts/plot-host.sh`, `pr-refresh.ts`, `registryd-main.ts`'s queue-limit logic (`MERGE_WALK_LIMIT` is the only part of this file in scope — do not touch `prList`/queue code near it), and `plot-impl-status.sh` / `skills/plot-deliver/SKILL.md` (wave 3's territory). This is a small, single-concern slice — resist the temptation to also "fix" the squash-walk open point or the `registryd-main.ts` saturation gap; both are explicitly deferred by the plan.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
