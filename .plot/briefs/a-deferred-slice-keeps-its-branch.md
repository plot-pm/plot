## Implementation brief — a-deferred-slice-keeps-its-branch

- **Plan (canonical):** `docs/plans/2026-11-16-a-deferred-slice-keeps-its-branch.md` on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3465 merged
- **Branch:** `bug/a-deferred-slice-keeps-its-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR (`Review: pr`)

One slice, one branch: nothing waits on it and it waits on nothing.

### What to build

On 2026-11-16 `plot-reconcile-scan.sh` section 3 prints three branches as `ahead of main, no open PR → orphan (needs judgment)` and counts each in `stale=`: `origin/bug/pr-and-issue-reads-still-use`, `origin/feature/a-merged-pending-check-is-asked-again`, `origin/feature/one-pr-reader-per-machine-and`. Each is the only branch of a slice carrying `<!-- deferred: <date>, <reason> -->`, each plan says the ref stays, and each plan sits in `docs/plans/delivered/`. The sweep asks a person for a judgment that has one answer. `loose-delete` already refuses the same branches as `named`. Your fix is the one that makes those three rows disappear from `stale=` and appear under a `kept` sub-heading with the plan and the date.

The mechanism, on top of what exists: `branchGivenUp(branch, plans)` in `packages/domain/src/rules/branch-given-up.ts` already answers "did the plans give this branch up", and `reap.ts` (`branchGivenUpByPlans`, `claimDisposition`) already asks it over every plan under the plan directory. Section 3 does not ask it: its own `claim_disposition` (`plot-reconcile-scan.sh:820-832`) greps `$ACTIVE_DIR/*.md` only, first matching line per plan, so a delivered plan is never read. Build five things, in this order:

1. In `branch-given-up.ts`, add an arrow export that returns the line that gave the branch up (plan `file` and `deferred_reason`) or `null`. `branchGivenUp` stays and becomes `!== null` over it, so `reap.ts` does not change. The export reads a leading `YYYY-MM-DD` from the reason as the date and answers `null` for the date when the reason opens with none. `PlanBranchLines` today carries neither `file` nor `reason`: extend the type with optional fields rather than breaking `reap.ts`'s caller, and confirm against `plot-plan-meta.sh` output that `waves[].branches[]` carries `deferred_reason`.
2. Add the entry `packages/board/src/server/entry/given-up.ts`, built to `skills/plot/scripts/board/plot-given-up.mjs` by `packages/board/build.mjs`, copying the `plot-slice-chain.mjs` block (lines 710-730). It reads `plot-plan-meta.sh` JSON lines on stdin and the Active index directory as its argument, and prints one tab-separated row per given-up branch: branch, plan file, date or `undated`.
3. In the scan, call the bundle once before the section-3 loop with `plan_json` on stdin (`plan_json` is parsed once at line 662). A missing bundle or missing `node` leaves the answer empty, so every branch keeps today's classification.
4. Replace `claim_disposition` with a lookup into that answer. A claim deferred only in a delivered plan then reads `abandoned claim` with a delete command, as `reap.ts` already answers.
5. In the unmerged arm, after the Bitbucket ask and before the orphan line (`:1397`), list a given-up branch under `-- kept by a deferred or moved slice (a plan keeps this ref; not stale) --` and `continue` without incrementing `n_stale`. The row reads `origin/<branch> — kept by <plan file> (deferred <date>) → not stale` and prints no `fix:` command.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The rule is `branchGivenUp`'s, not "any live line in any plan".** A live slice blocks the answer only when its plan is in the Active index. A branch a delivered plan names live and another plan defers reads as given up. Jan Wloka decided this on 2026-11-16 so the sweep and the reaper give one answer. A delivered plan's live branch normally merged, and the merged arm (`:1346`) decides it before the deferred read.

**No `jq` filter over `plan_json`.** It is a third reading of a rule the domain already holds, and the shell-lines ratchet charges its lines. `docs/shell-and-domain.md` allows one `node` start per operator command, and section 7 already pays one for `plot-slice-chain.mjs` (`:1566`). The domain rule is what makes this a declared reading rather than a new duplicate.

**The order of checks does not change.** An open PR (`:1320`), an empty claim (`:1329`), a merge (`:1346`), containment in an open PR (`:1371`) and the Bitbucket merge ask (`:1385`) each decide before the deferred marker is read. The kept arm sits last, immediately before the orphan line. Do not move it earlier: a merged deferred branch must still read as a deletion candidate.

**The sub-heading is `kept by a deferred or moved slice`.** The parser folds `moved:` into `deferred`, so one heading covers both. A branch moved to an Active plan stays an orphan through that plan's live line; a branch moved to a delivered plan reads as kept.

**The footer gets no `kept=` key.** `test/reconcile/reaper.test.mjs:106` and others assert the footer contract, and it stays unchanged.

**The claim arm reads delivered plans in this slice.** This is a behaviour change (it makes some claims `abandoned claim` that read as unresolved), decided by Jan Wloka 2026-11-16.

**Carried-over rules.** Absent is not false: a missing bundle, missing `node`, or a plan that fails to parse leaves the answer empty and the branch keeps today's classification, never "not given up" asserted. Read the bundle's exit code and rows, not the emptiness of its stdout alone. The decision lives in the domain; the shell holds no new rule.

### Done when

The plan's `## Slices` section and its contract-test list are the specification. Lifted assertions a naive implementation would pass without:

- The kept branch prints no `→ orphan (needs judgment)` line **and** no `git push origin --delete` line naming it. Catches an implementation that adds the kept row but leaves the orphan row printing as well.
- The footer reads `stale=1` with one orphan and one kept branch. Catches a kept arm that forgot `continue` and still increments `n_stale`.
- A branch deferred in one plan and named without deferral in an Active-index plan prints `orphan (needs judgment)`. Catches a rule that ignores the Active index.
- An empty claim deferred only in a delivered plan prints `abandoned claim`. Catches a bundle call wired to the kept arm but not to the claim arm.
- `test/reconcile/reaper.test.mjs` passes unchanged. Catches a change to the claim arm that breaks the Active-plan case.

Plus the repo gates. Add the new contract test `test/reconcile/deferred-keeps-branch.test.mjs` (modelled on `reaper.test.mjs`: bare origin, clone, plans under `plans/` with `active/` and `delivered/` indexes, `plot-reconcile-scan.sh --offline`). Add the `plot-given-up.mjs` row to `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh` gates it). Update `skills/plot-reconcile/SKILL.md` in two places: the section-3 item (line 87) names the kept class, and a new `### Kept by a deferred slice (inside section 3)` beside `### Claims (inside section 3)` (line 114) states the rule, its source in `branch-given-up.ts` and the order of the checks; the Claims table says the disposition reads every plan. Add a changeset for `plot` with `plot-reconcile: minor`, description first and `bumps:` block last. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`.

Shell gate: `scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-reconcile-scan.sh`, so growth is paid for in the same change. `claim_disposition` (13 lines) goes out and one bundle call, one lookup and one output block come in, for a net of zero or less. The gate counts commands, not lines, so joining statements with `;` or `&&`, or folding `fi` or `done` onto the previous line, is not a payment. If the new block runs over, merge the printing of the `contained` and `kept` sub-headings (`:1418-1422` and the new block) into one loop over both. The gate stores no number and has no override.

Generated bundles: `plot-given-up.mjs` is generated. Run `pnpm build:board` to test locally, but do not commit the shipped bundle diff; `scripts/check-no-bundle-diff.sh` refuses it and `main` builds its own after merge. The contract test needs the built bundle locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Commit style: `plot-reconcile: <description>`.

### Scope guard

This branch owns: `packages/domain/src/rules/branch-given-up.ts` and its test, `packages/board/src/server/entry/given-up.ts`, the `build.mjs` block for the new bundle, `skills/plot/scripts/plot-reconcile-scan.sh` (section 3 and `claim_disposition` only), `skills/plot/scripts/README.md`, `skills/plot-reconcile/SKILL.md`, `test/reconcile/deferred-keeps-branch.test.mjs`, and the changeset. Do not change `reap.ts` behaviour, the summary footer, or any other section of the scan. This is the only slice of the plan, so no sibling branch of it is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
