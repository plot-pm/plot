## Implementation brief — plot-review-status-sh-reports-only

- **Plan (canonical):** [docs/plans/2026-10-22-plot-review-status-sh-reports-only.md](../../docs/plans/2026-10-22-plot-review-status-sh-reports-only.md) on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2349 merged
- **Branch:** `bug/plot-review-status-sh-reports-only` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plan declares `Review: pr`

This is the plan's only slice — no wave ordering to track.

### What to build

`skills/plot/scripts/plot-review-status.sh:46` extracts the PR with `grep -oE 'pr: #[0-9]+' | grep -oE '[0-9]+'`. The pattern needs the literal `pr: #` before each number, so for `<!-- pr: #3645, #3649 -->` only `3645` can match and `3649` is dropped. Observed on ewz-kus-portal (issue #2346): `"pr":"3645"` and `"pr":"3646"` for two items that each name two PRs. The fix reads the whole `pr:` field and extracts every `#<number>` in it. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The field ends at the next `key:` or the comment end.** Extract the `pr:` value first, then the numbers from that value only. A global `grep -oE '#[0-9]+'` over the annotation would also pick up numbers that appear in other fields (`branch:`, `review_sha:`, `reviewed_at:`), so the two-step read is required, not stylistic.

**The grep no-match trap applies to the new code too.** Under `set -euo pipefail` a `grep` with no match exits 1 and ends the script inside `$(...)`. The existing lines guard with `|| echo ""` / `|| true`; the single-PR and `none` paths (an annotation with no `pr:`) must keep working. `review-status-slug-match.test.mjs` pins the earlier instance of this (#2303).

**Output shape is the one open question, and the evidence favours adding a `prs` array.** `pr` is a JSON string today (`"3645"` or `"none"`). Measured by grep over `skills`, `packages`, `test`, `scripts` and `docs/sprints`: no code reads the `pr` field. The only consumer text is `skills/plot-sprint/SKILL.md:308`, which names the script and no field. A change to `pr`'s shape therefore breaks no reader in this repo, but external projects may parse it. Recommended: keep `pr` as the first number (or `"none"`) so existing consumers see no change, and add `prs` as an array of strings for all numbers. Record the choice in the PR description and in `skills/plot/scripts/README.md`'s row for this script if its description names the fields.

**Spellings to accept:** `pr: #1, #2`, `pr: #1,#2`, `pr: #1 #2`. A repeated `pr:` key: take every number from every occurrence, de-duplicated, in order of appearance. Say which you chose in the test names.

### Done when

The plan's `Done when` is the specification: a contract test in `test/reconcile/` with a two-PR item and a single-PR item. Lift these assertions, each of which a naive fix would pass without:

- **A comma list followed by other keys** (`<!-- pr: #1, #2, branch: feature/x, review_sha: abc123 -->`): reports exactly `1` and `2`. Catches a global `#[0-9]+` grep that leaks numbers from other fields.
- **No `pr:` key**: still `"none"` (and an empty `prs`). Catches a `set -e` abort or an empty-string regression.
- **A plain line before the item** and a later item that must still appear: catches a loop that silently stops early (the pattern in `review-status-slug-match.test.mjs`).
- Run the test against the unfixed script first and show it fails, so a revert is caught.

Plus: a changeset (`plot: patch`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits a `.sh` file, so net growth is paid for in the same change: keep the extraction to a few lines, or remove shell elsewhere. The gate stores no number and has no override. Mutation-test the new test by reverting the script change in place before believing it.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-review-status.sh`, its new test under `test/reconcile/`, the script's `README.md` row if the output shape changes, and one changeset. Related, both Delivered and not to be reopened: `plot-review-status-sh-exits-1` (#2303) and `plot-review-status-sh-reads-the` (#2323). Touch the annotation parse only; leave the `status:` removal, the branch/SHA logic and the board untouched. Other branches in flight on `plot-review-*` plans (#2343, #2344) edit `packages/board/src/server/entry/review.ts` and the host port, not this script.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
