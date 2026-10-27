## Implementation brief — read-merged-prs-from-the-merge (wave 3: Delivery Lookup By Name)

- **Plan (canonical):** `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2419 merged
- **Branch:** `bug/impl-status-asks-merged-prs-by-branch` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 3 of 3. Wave 1 (`bug/a-bitbucket-listing-reads-every-page`) merged as PR #2730; wave 2 (`bug/the-merge-walk-reads-the-whole-log`) merged as PR #2749. Both prior waves are merged, so this wave is eligible, and it depends on neither — it only touches `plot-impl-status.sh` and the deliver skill doc.

### What to build

`/plot-deliver` step 4 (`plot-impl-status.sh`) resolves each un-annotated branch the PR index could not answer by matching it against one blind listing call: `pr-list --state merged --limit 500` (`plot-impl-status.sh:269-271`), then scanning the returned heads for a match (`merged_pr_for_branch`, `:277-281`). On GitHub that one listing is cheap and usually wide enough. On Bitbucket, before wave 1, it returned one page of 50 rows sorted by `updated_on` descending — so a merged PR older than the 50 most recently updated PRs of its state read as "no PR", which is the delivery half of this plan's bug. Wave 1 already fixed the general listing (`bb_state_listing` now pages), but step 4's call still asks the blind listing instead of naming its branches, so it still costs one listing of up to 500 rows per `/plot-deliver` run regardless of how many branches actually need resolving.

The fix: pass every un-annotated, index-unresolved branch as a repeated `--branch BR` argument to the *same* `pr-list --state merged --limit 500` call, instead of asking a nameless listing and matching heads locally. `plot-host.sh` already supports repeated `--branch` on `pr-list` (`plot-host.sh:4531`, collected into `branches` and expanded as `--branch "$_b"` per entry at `:4626`/`:4633`) — on GitHub several branches keep the listing path; on Bitbucket, naming branches routes to `bb_branch_sweep` (`plot-host.sh:1258`, called at `:4879`), which runs one `bb_branch_query` per branch, each already following `next` since #2573. The helper still makes exactly one `pr-list` call per plan — only what's inside that call changes.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**One `pr-list` call, not one call per branch.** The slice passes every unresolved branch as repeated `--branch` arguments to the single existing call — it does not loop `pr-state` or `pr-list` per branch at this layer. `bb_branch_sweep` is what fans out per-branch on Bitbucket, inside that one shell invocation; step 4's own request count stays at 1 call (the per-branch request cost moves into that call on Bitbucket, named in Cost below).

**Header's "constant in branch count" claim becomes false — say so, don't hide it.** `plot-impl-status.sh:253-254`'s existing comment advertises the merged-head fetch as "constant in branch count ... an annotated-only plan pays nothing." That remains true for the *call count* (still 1), but on Bitbucket the *request count* inside that call is no longer constant — it scales with the number of unresolved branches, since `bb_branch_sweep` runs one `bb_branch_query` per name. Rewrite the comment to state this plainly rather than leaving a claim the new code falsifies.

**A failing branch empties the whole call, by design — do not add partial-recovery logic.** On Bitbucket, `bb_branch_sweep` returns the first failing branch's exit code and prints no rows at all on failure (`plot-host.sh:1261-1262` — one bad branch fails the whole sweep). Step 4's existing `2>/dev/null || true` (`plot-impl-status.sh:269-270`) swallows that failure and leaves `MERGED_HEADS` (or its by-name equivalent) empty, so *every* branch in the plan stays unresolved in step 4's report for that run. This is not a regression this slice introduces — today, one throttled blind listing already produces the same empty-result behavior for the same reason. Do not add retry-without-the-failing-branch or per-branch fallback calls; that is new scope, not this slice's fix. The one thing that does *not* get worse: the deliver controller's gate (`deliverabilityOf`) does not read step 4's output, so a false "unresolved" report here does not block a merge-ready delivery — it only misinforms the report a human reads.

**`skills/plot-deliver/SKILL.md:139` names the new shape.** It currently reads "a single bundled `pr-list --state merged` for the whole plan, then a per-PR...". Rewrite it to say the call names the plan's unresolved branches by `--branch`, rather than describing an unscoped bundled listing.

**Rules carried over unchanged:** this slice adds no index row, no new host adapter method, and no ancestry-decision call — it only changes which arguments the existing `pr-list --state merged --limit 500` call carries. The index-first short-circuit above it (`index_answered`, `plot-impl-status.sh:244-250`) is untouched: a branch the PR index already answered never reaches this call at all, annotated branches resolve by number as before, and an absent answer is never fabricated as merged — a miss still reports nothing, never a false negative turned positive.

**Out of scope:** the deliver controller's own by-name lookup (`deliverabilityOf` → `Host.prMerged`, see the plan's *Deliver Gate Overlap* section) — that's a separate, already-correct code path this slice does not touch or deduplicate against; the duplicate host cost between step 4 and the controller is accepted and counted in the plan's Cost table, not eliminated. Also out of scope: the reused-branch-name question (plan Open Points — which merged PR a by-name query should prefer when a name was reused) and the squash/merge-walk question — both are explicitly deferred in the plan and belong to neither this slice nor this plan's remaining scope.

### Done when

The plan's slice line is the specification: `plot-impl-status.sh` passes every un-annotated, index-unresolved branch as repeated `--branch` to its one `pr-list --state merged --limit 500` call, and the header comment at `plot-impl-status.sh:253-254` is rewritten to drop the now-false "constant in branch count" claim. `skills/plot-deliver/SKILL.md:139` is rewritten to describe the by-name shape. Tests the plan names, each catching a naive pass:

- `test/reconcile/impl-status-index.test.mjs` — with a Bitbucket stub whose merged listing holds 50 newer rows, a branch merged *outside* those 50 resolves through the by-name query in one `pr-list` call (catches: a naive implementation that still asks the blind listing and silently drops the old PR, reproducing this plan's whole bug).
- Same test file — a branch with no merged PR stays unresolved, and delivery refuses it (catches: a resolver that fabricates a match for an unresolved branch).
- Same test file — a fully merged plan that the PR index already answers makes **zero** host calls (catches: a change that moves the fetch earlier or makes it unconditional, defeating the existing index-first short-circuit this slice must not disturb).

Plus: add a changeset (description first, `bumps:` block last — the order is load-bearing, a `bumps:` block written first becomes the published description). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally — it is CI's gate, not a local one.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The plan's *Shell Lines* section states this slice replaces the early-exit loop at `plot-impl-status.sh:245-251` with a loop that collects `--branch` arguments and drops its `break` — net 0 or fewer commands added, so no offset needs to be paid elsewhere.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Delivery Lookup By Name` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned:
- `skills/plot/scripts/plot-impl-status.sh` (the `UNRESOLVED_UNANNOTATED` collection loop at `:245-251`, the `MERGED_HEADS` fetch and its header comment at `:253-274`, and `merged_pr_for_branch`/its callers as needed to keep the by-name result shape consistent)
- `skills/plot-deliver/SKILL.md:139` (the sentence describing step 4's call shape)
- `test/reconcile/impl-status-index.test.mjs` (the three cases above)

Not yours: `skills/plot/scripts/plot-host.sh` (its `--branch` flag, `bb_branch_sweep`, and `bb_branch_query`'s `next`-following all already exist and ship since wave 1 / #2573 — read them, don't modify them), `skills/plot/scripts/plot-fleet-scan.sh` and `packages/fleet/src/server/entry/registryd-main.ts`'s `MERGE_WALK_LIMIT` (wave 2's territory, already merged), `packages/board/src/server/controllers/deliverability.ts` (the deliver controller's own by-name lookup — explicitly left duplicated by design, see *Deliver Gate Overlap*), and anything about the Bitbucket state listing itself (wave 1's territory, already merged).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
