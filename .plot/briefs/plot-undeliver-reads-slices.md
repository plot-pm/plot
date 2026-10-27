## Implementation brief — plot-undeliver-never-refuses-refs-swept (wave 1: Refusal)

- **Plan (canonical):** `docs/plans/2026-10-27-plot-undeliver-never-refuses-refs-swept.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2787 merged
- **Branch:** `bug/plot-undeliver-reads-slices` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **Issue:** #2764

Wave 2 (`bug/plot-reject-calls-plot-undeliver`) waits on this branch. It removes the `--unowned` receipt and the hand edits from `skills/plot-reject/SKILL.md`, and it can only do that once this branch's script records its own receipt and moves the index entry.

### What to build

`plot-undeliver.sh` finds a plan's branches with `grep -oE '\(Branch: [^,)]+'` (line 79). That reads the heading form `### Name (Branch: x)` and nothing else. 53 of 54 Delivered plans use the list form `` - `branch` — … `` under `## Slices`, so `swept` is empty on them and the script decides `→ Approved` without looking at a ref. On the heading form it refuses `refs-swept` for every branch whose ref is gone, and this repository deletes a branch when its PR merges (`delete_branch_on_merge: true`): 54 of 55 Delivered plans have every non-deferred ref gone. The refusal fires on merged work.

This branch changes five things, all in the plan's Design › Approach 1–6:

1. **Branches** come from `plot-plan-meta.sh` `waves[].branches[]`, with `deferred: true` entries dropped. No second parser.
2. **The shell supplies one reading line per branch**: branch, ref (`present` | `absent` | `unknown`), merge answer from `pr_merged` in `plot-pr-merged.sh` (`merged` | `not-merged` | `unknown`), closed-unmerged-PR (`yes` | `no` | `unknown`) from `plot-host.sh pr-list --state closed --branch <b>`. `ls-remote` exit 0 is `present`, exit 2 is `absent`, anything else is `unknown`. The host is asked only for a branch whose ref is `absent`.
3. **The domain decides.** `undeliver` in `packages/domain/src/transitions/plan.ts` takes the per-branch readings in place of the pre-decided `refs` precondition. Ref `unknown`, or an `absent` ref with an `unknown` host answer, refuses `refs-unknown`. `absent` + `not-merged` + closed unmerged PR refuses `refs-swept`. Every other branch passes.
4. **Slug.** The shell puts the slug in the bundle's header line and `entry/plan-undeliver.ts` stops reading a `Slug:` field no plan carries. Today every refusal prints `plan ''`.
5. **Receipt, owner, index.** The script calls `record_state_receipt "$file" Approved` after its `mv`, as `plot-sprint-state.sh:169` does. `owningCommand` (`packages/domain/src/rules/state-transition.ts:132`) takes the from-state, so Delivered → Approved names `/plot-reject`. The script moves `docs/plans/delivered/<slug>.md` to `docs/plans/active/<slug>.md` in the same write.

### Decisions the plan settles — do not re-derive them

- **Do not just add the list form to the regex.** A reader that only widens the format would refuse nearly every rejection, including the "branches unbuilt" case `/plot-reject` exists for: 54 of 55 Delivered plans have every ref gone. The refusal rule changes, not only the reader. Panel round 1 measured this.
- **`refs-swept` means lost work, and nothing else.** A ref that is gone is not evidence of loss. A host `mergedAt` is the evidence the work landed (`## One Answer To "Did This Land"` in CLAUDE.md): read `pr_merged`, never ancestry, because squash-merge rewrote the commits and `merge-base --is-ancestor` disagreed with the host on ten of ten.
- **A closed-unmerged PR proves the branch existed.** A never-pushed branch (absent, not merged, no PR) passes: nothing was lost. This is Decision 2.
- **`git ls-remote --exit-code` returns 2 for a missing ref and 128 for an unreachable remote.** Line 81 treats every non-zero as missing, so an unreachable origin reads as "already deleted". Absent is not false: `unknown` refuses `refs-unknown`, and its text must not contain "deleted".
- **The rule lives in the domain; the shell collects.** `plot-undeliver.sh` runs once per operator command, which `docs/shell-and-domain.md` permits to call the domain. Do not decide `swept` in shell. That is the duplicate-rule shape CLAUDE.md `## A Shell Script Asks The Domain` forbids without a corpus test.
- **The motivating case was correct.** The #2400 plan at `b2df79eaf` (ref `bug/plot-host-bitbucket-pr-list-reads` gone, PR #2422 merged 2026-10-26T14:19:47Z) rightly decided `→ Approved`. A fixture of that shape must keep deciding it.
- **Controller tier.** Script, domain decision and receipt. No `undeliver` board endpoint and no HTTP route in this plan.
- **Out of scope:** a Bitbucket run (tests use GitHub fixtures only), and `skills/plot-reject/SKILL.md` (wave 2).

Rules carried over from related work: read the exit code, not the emptiness; `pr_merged` answers `unknown` when the host does not answer, and that is not `not-merged`.

### Done when

The plan's `## Done when` list is the specification. Three assertions exist because a naive implementation passes without them:

- **The host stub records no call for a branch whose ref is `present`.** Catches a script that asks the host for every branch (cost: two calls per branch on every rejection).
- **An unreachable origin URL exits 1 with `refs-unknown`.** Catches the `ls-remote` exit-128 case read as `absent`.
- **After a successful run, `plot-state-gate.sh` accepts the commit with no `--unowned` receipt, and `delivered/<slug>.md` is gone while `active/<slug>.md` exists.** Catches a script that decides correctly and writes a state the gate then refuses.

Both slice formats need a fixture: the same merged-and-deleted plan in list form and heading form must each decide `→ Approved`. A deferred branch with no ref must not affect the decision.

Existing tests change with the rule: `packages/domain/test/transitions.test.ts` (the `refs-swept` case near line 815) and `test/reconcile/undeliver-two-format-scan.test.mjs`. Add the new script cases in `test/reconcile/` (throwaway repo, local bare origin, stub host).

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base: the new receipt, symlink and host-reading lines are paid for in the same change, first by the removed regex and verdict loop. The gate stores no number and has no override. Add a changeset (description first, `bumps:` block last, `plan:` line inside the block). `skills/plot/scripts/board/plot-plan-undeliver.mjs` is generated: rebuild it locally to test, and do not commit the rebuild (`scripts/check-no-bundle-diff.sh`). Update the `plot-undeliver.sh` row in `skills/plot/scripts/README.md`. New domain functions are arrows, and TSDoc states behaviour, not history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-undeliver.sh`, `packages/board/src/server/entry/plan-undeliver.ts`, `packages/domain/src/transitions/plan.ts`, `packages/domain/src/rules/state-transition.ts` (`owningCommand` and its callers), their tests, the README row and the changeset. `skills/plot-reject/SKILL.md` and `skills/plot-reject/README.md` belong to `bug/plot-reject-calls-plot-undeliver`. Do not touch them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
