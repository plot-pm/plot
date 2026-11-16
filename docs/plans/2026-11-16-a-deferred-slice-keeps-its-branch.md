# A deferred slice keeps its branch out of the stale list

> `plot-reconcile-scan.sh` section 3 lists an unmerged branch that a plan gave up on purpose under its own sub-heading, asks the domain's `branchGivenUp` rule for that answer, and stops counting the branch toward `stale=`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3465 merged

## Changelog

- `/plot-reconcile` section 3 no longer reports a branch as an orphan when every plan that schedules it has deferred its slice. The branch appears under `-- kept by a deferred or moved slice --` with the plan and the deferral date, gets no delete command, and does not count toward `stale=`.

<!-- Board impact: no change to the plan format, the template or the docs/plans layout. The slice adds one bundle under skills/plot/scripts/board/, built by packages/board/build.mjs like plot-slice-chain.mjs. -->

## Motivation

On 2026-11-16, section 3 reports three branches as `ahead of main, no open PR → orphan (needs judgment)`: `origin/bug/pr-and-issue-reads-still-use`, `origin/feature/a-merged-pending-check-is-asked-again` and `origin/feature/one-pr-reader-per-machine-and`.

Each branch is the only branch of a slice that carries a `<!-- deferred: <date>, <reason> -->` marker, and each plan states that the ref stays:

- `docs/plans/2026-11-09-pr-and-issue-reads-still-use.md:89` defers the slice on 2026-11-15, and line 93 says the branch "stays as a reference and is not merged".
- `docs/plans/2026-10-09-a-merged-pr-s-checks-freeze.md:81` defers the slice on 2026-10-09 and names closed PR #1425.
- `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md:199` defers the slice on 2026-10-25, and line 218 says "origin keeps its ref at `f0b1a2fa7`".

The host closed each branch's PR unmerged. All three plans live in `docs/plans/delivered/`, not in the Active index.

The `loose-delete` controller refuses each of these branches as `named` (`packages/domain/src/rules/loose-delete.ts:103`), because a plan's slice names it. So the sweep asks a person for a judgment that has one answer: keep the ref. Three false rows of this kind teach a reader to skip the section.

## Design

### Current behaviour

- `skills/plot/scripts/plot-reconcile-scan.sh:1284` opens section 3, and the loop at lines 1302–1401 classifies each remote branch from `all_branches` (line 425).
- Lines 1325–1345 handle an empty claim first. `claim_disposition` (lines 817–829) answers `abandoned` when a plan line that names the branch carries `<!-- deferred:` or `<!-- moved:`.
- `claim_disposition` greps only `$ACTIVE_DIR/*.md` (line 819), and only the first line per plan that names the branch (line 821). A plan in `delivered/` is never read.
- Lines 1346–1352 print a merged branch as a deletion candidate. Lines 1371–1374 list a branch contained in an open PR under its own sub-heading, and it skips `n_stale`.
- Lines 1385–1396 ask the Bitbucket host about one branch when the merged list was cut.
- Line 1397 prints every remaining unmerged branch as `orphan (needs judgment)`, and line 1400 counts it in `n_stale`. No step before line 1397 reads a deferred marker for a branch with work.
- Line 662 parses every plan under `$PLAN_DIR` once into `plan_json`. Each row carries `waves[].branches[]` with `branch`, `deferred` and `deferred_reason`, so section 3 has the annotations in hand and needs no second parse.

### Existing domain rule

- `packages/domain/src/rules/branch-given-up.ts:23` exports `branchGivenUp(branch, plans)`. It returns `true` when at least one plan marks the branch deferred and no Active-index plan schedules it as a live slice. The parser reports `deferred` for both `deferred:` and `moved:` (lines 14–15).
- `packages/domain/test/branch-given-up.test.ts` holds its unit tests.
- `packages/board/src/server/entry/reap.ts:1375` (`branchGivenUpByPlans`) asks it over every plan under the plan directory, delivered and released ones included. `reap.ts:1413` uses it as the reaper's claim disposition, and `reap.ts:908` uses it to lift the merge gate for a desk.
- The shell's `claim_disposition` answers the same question as `reap.ts:1413` with a different reading: it reads the Active index only. No corpus test declares that pair, so it is an undeclared duplicate in the sense of `docs/shell-and-domain.md`.

### Approach

Ask `branchGivenUp` through a bundle once per reconcile pass, and let section 3 read the answer for both the claim arm and the orphan arm.

1. Extend `branch-given-up.ts` with an arrow export that returns the line that gave the branch up — the plan `file` and the `deferred_reason` — or `null`. `branchGivenUp` stays and becomes `!== null` over it, so `reap.ts` does not change. The export also reads a leading `YYYY-MM-DD` from the reason as the deferral date, and answers `null` for the date when the reason opens with none.
2. Add the entry `packages/board/src/server/entry/given-up.ts`, built to `skills/plot/scripts/board/plot-given-up.mjs` by `packages/board/build.mjs` in the same way as `plot-slice-chain.mjs` (lines 710–720). It reads the `plot-plan-meta.sh` JSON lines on stdin and the Active index directory as an argument. It prints one tab-separated row per given-up branch: branch, plan file, date or `undated`.
3. In `plot-reconcile-scan.sh`, call the bundle once before the section-3 loop, with `plan_json` on stdin. A missing bundle or `node` leaves the answer empty, so every branch keeps today's classification.
4. Replace `claim_disposition` (lines 817–829) with a lookup into that answer. The claim arm then reads delivered plans too, which is what `reap.ts:1413` already does.
5. In the unmerged arm, after the Bitbucket ask (line 1396) and before the orphan line (line 1397), list a given-up branch under `-- kept by a deferred or moved slice (a plan keeps this ref; not stale) --` and `continue` without `n_stale`. The row reads `origin/<branch> — kept by <plan file> (deferred <date>) → not stale`. It prints no `fix:` command.

The order keeps the stronger facts first. An open PR (line 1320), an empty claim (line 1329), a merge (line 1346), containment in an open PR (line 1371) and a merge that the Bitbucket ask finds (line 1385) each decide before the deferred marker is read.

### Shell-lines ratchet

`scripts/check-shell-lines.sh pr` refuses a change that grows the commands under `skills/`. The slice removes `claim_disposition` (lines 817–829) and adds one bundle call, one lookup and one output block. The decision itself lives in the domain, so the shell holds no new rule. The slice must pass `check-shell-lines.sh pr` with a net count of zero or less. If the new lines exceed the removed ones, merge the printing of the `contained` and `kept` sub-headings (lines 1418–1422 and the new block) into one loop over both.

### Rejected alternative

A `jq` filter over `plan_json` in section 3 could test `deferred` per branch with no `node` start. It writes a third reading of a rule that `branch-given-up.ts` already holds, and it adds lines that the ratchet charges. `docs/shell-and-domain.md` allows a `node` start once per operator command, and section 7 already pays one for `plot-slice-chain.mjs` (line 1566).

### Open Questions

- [x] `branchGivenUp` lets a live slice block the answer only when the plan is in the Active index (`branch-given-up.ts:30`). A branch that a delivered plan names live and another plan defers therefore reads as given up. Confirm that this rule, not "any live line in any plan", decides section 3. A delivered plan's live branch normally merged, and the merged arm at line 1346 decides it before the deferred read. **Decided 2026-11-16, Jan Wloka: `branchGivenUp`'s rule decides section 3, so the sweep and the reaper give one answer.**
- [x] The parser folds `moved:` into `deferred` (`branch-given-up.ts:14`). A branch whose slice moved to an Active plan stays an orphan through that plan's live line. A branch moved to a delivered plan reads as kept. Confirm the sub-heading wording covers `moved:`, or name it `kept by a deferred or moved slice`. **Decided 2026-11-16, Jan Wloka: the sub-heading reads `kept by a deferred or moved slice`.**
- [x] The claim arm then reads delivered plans, so a claim deferred only in a delivered plan becomes an `abandoned claim` with a delete command. `reap.ts:1413` already answers so. Confirm that change belongs in this slice. **Decided 2026-11-16, Jan Wloka: the change belongs in this slice; a claim deferred only in a delivered plan reads `abandoned claim`, as `reap.ts:1413` answers.**
- [x] The summary footer gets no new count for kept branches. Decide whether a `kept=` key is worth the footer contract change that `test/reconcile/reaper.test.mjs:106` and others assert. **Decided 2026-11-16, Jan Wloka: the footer gets no `kept=` key, and its contract stays unchanged.**

## Slices

### Deferred branches kept

- `bug/a-deferred-slice-keeps-its-branch` — the given-up line export in `packages/domain/src/rules/branch-given-up.ts` with unit cases in `packages/domain/test/branch-given-up.test.ts`; the entry `packages/board/src/server/entry/given-up.ts` and its bundle `skills/plot/scripts/board/plot-given-up.mjs` with a row in `skills/plot/scripts/README.md`; section 3 of `skills/plot/scripts/plot-reconcile-scan.sh` reads the bundle for the claim arm and the new kept arm, and `claim_disposition` is removed; a new contract test `test/reconcile/deferred-keeps-branch.test.mjs`; the section-3 text in `skills/plot-reconcile/SKILL.md`; a changeset for `plot` with `plot-reconcile: minor` <!-- builds: plot-given-up.mjs, section 3's kept-by-a-deferred-slice arm over branchGivenUp -->

The contract test follows `test/reconcile/reaper.test.mjs`: a bare origin, a clone, plans under `plans/` with `active/` and `delivered/` indexes, and `plot-reconcile-scan.sh --offline`. It asserts:

- A branch with one work commit, named only by a deferred slice of a plan linked in `delivered/`, appears under `-- kept by a deferred or moved slice` with the plan file and the date. The test asserts that no `→ orphan (needs judgment)` line and no `git push origin --delete` line names it.
- A branch with one work commit, deferred in one plan and named without deferral in an Active-index plan, prints `→ orphan (needs judgment)`.
- The footer reads `stale=1`: the orphan counts and the kept branch does not.
- An empty claim deferred only in a delivered plan prints `abandoned claim`.

The existing `test/reconcile/reaper.test.mjs` cases must pass unchanged.

The `skills/plot-reconcile/SKILL.md` text changes in two places: the section-3 item (line 87) names the kept class, and a new `### Kept by a deferred slice (inside section 3)` beside `### Claims (inside section 3)` (line 114) states the rule, its source in `branch-given-up.ts`, and the order of the checks. The Claims table states that the disposition reads every plan, not the Active index only.

## Notes

- Measured 2026-11-16 on `main` at `f12d831ed`. `plot-plan-meta.sh` reads all three plans' slices as `deferred: true`, with a `deferred_reason` that opens with the date.
- `plot-deliverable-search.sh` on 2026-11-16: `branchGivenUp` hits `packages/domain/src/rules/branch-given-up.ts:1,23` and `packages/board/src/server/entry/reap.ts:15,1409`, which this plan reuses. `kept by a deferred or moved slice` and `givenUpBranches` hit no deliverable; the search returned only the section headings at `plot-reconcile-scan.sh:1284` and `:1935` and unrelated `deferred` lines in `packages/fleet/src/server/entry/registryd-main.ts`.
- `gh issue list --repo plot-pm/plot --search "reconcile orphan"` on 2026-11-16 returned five open `plot-review: findings` issues and none about section 3, so the plan names no issue.
