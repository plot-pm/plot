## Implementation brief — bitbucket-and-github-listings-read-one (wave 1: Bitbucket paging)

- **Plan (canonical):** `docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2522 merged
- **Branch:** `bug/bitbucket-listings-follow-next` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + plot-review)

Wave 1 of 3. Waves 2 (`bug/github-open-lookup-asks-per-branch`) and 3 (`bug/bitbucket-stubs-and-listing-plan`) wait on it. Wave 3 fixes the `host.test.mjs` Bitbucket stubs and amends `plot-host-bitbucket-pr-list-reads`; do neither here.

### What to build

Issue #2484: `bb_branch_query` (`skills/plot/scripts/plot-host.sh:1044`) asks `pagelen=50`, never follows `next`, and `pr-merged-heads` (`:4054`), `pr-merged` (`:3937`) and `pr-merge-commit`/`pr-merge-dest` (`:4010`) treat that page as the whole answer. The only guard is `bb_full_page_lacks` (`:1084`), which fires on 50 rows that all lack the field. The query already filters on `MERGED`, so that case cannot occur: a branch with 51 merged PRs returns 50 rows, each with a head, the guard stays silent and `pr-merged-heads` exits 0 with a truncated list. The `pr-review` arm (`:4069`) has the same defect: `statuses?pagelen=50` and `comments?pagelen=100` are read once, so a `review-bypass:` comment on a later page is missed.

Make `bb_branch_query` and the `pr-review` reads follow the response's `next` link until it is absent, bounded by a page cap. When the cap stops the walk, print `possibly truncated` on stderr with the row count, in the wording of `plot-host.sh:3049`, and exit non-zero so no caller reads a prefix as the whole.

### Settled decisions — do not re-derive them

**Do not use `bb`'s own paginator.** `bb:203` stops at 10 pages and exits 0 with no marker, which is a silent prefix (header at `plot-host.sh:967`). Walk `next` yourself through `bb api`. Keep the leading `/` on the path: `bb api` concatenates `${BB_API}${path}` and a missing slash yields a 403 that reads as a missing scope (`:950`).

**Do not page the repository-wide listing.** The `bb_branch_sweep` header (`:940`–`:970`) measured that: 18 merged pages cost about 21 requests a refresh and stretch the fleet cadence from 240 s to 1260 s, and the cost grows with PR history. This change pages the per-branch filtered query, whose second page is fetched only when the first is full. Cost stays proportional to what the caller tracks. State this in the commit message.

**Following `next` and reporting truncation are both required, in that order.** The plan's first open question asks which one. Follow first: reporting alone leaves `pr-merged-heads` answering "unknown" for a branch with 51 PRs forever. Report only when the cap stops the walk. Re-check the cap's value in the existing code and reuse it; do not invent a second one.

**A refused page ends the walk as a failure.** The first page's exit code and stderr travel out of `bb_branch_query` unclassified, because `pr_list_call` classifies once (`:1030`–`:1043`; a `429` read as "said nothing" when classified twice). A failure on page 2 follows the same path: return the raw code, print no partial array.

**Fix the dead guards, not just add paging.** After paging, `bb_full_page_lacks` at `:3944`, `:4012` and `:4056` tests a case that cannot occur. Either delete it or replace it with the truncation signal from the walk. Correct the `pr-state` usage header at `plot-host.sh:53`: it promises exit 3 on a full page without a match, which the arm does not do. Document only exits the arm produces.

**Carried-over rules.** Absent is not false: an empty `values` on every page is an honest absence (`[]`, exit 0), a refused call is never one. Read the exit code, not the emptiness. `plot-host.sh` stays the one place that talks to the host CLI (`scripts/check-host-cli-callers.sh`). `pr-merged` reads the host's answer, never ancestry.

### Done when

The plan's `## Slices` entry for this branch is the specification: `bb_branch_query`, `pr-merged-heads` and the `pr-review` arm follow `next` or report truncation, and the dead full-page guards and the `pr-state` usage header are corrected. Tests in `test/reconcile/host.test.mjs`, which name what a naive implementation passes without:

- A branch with 51 merged PRs across two pages: `pr-merged-heads` prints 51 heads. A single-page implementation prints 50 and exits 0.
- A walk that reaches the page cap: `possibly truncated` on stderr and a non-zero exit. An implementation that returns the prefix exits 0.
- A second page that fails (HTTP 429 or 500): raw exit code, no partial heads on stdout.
- `pr-review` with a `review-bypass:` comment only on page 2 of comments: `bypass` is true. A single-page read reports false.
- A last page with exactly 50 rows and no `next`: complete, no truncation message (a size-only guard gets this wrong).

Do not extend the existing Bitbucket stubs beyond what these tests need; wave 3 owns the stub fixes (`makeBbOnlyStub` emits invalid bash without `mergedBranch` and encodes with `encodeURIComponent`, which differs from `url_encode`). If a stub blocks a test here, say so in the PR rather than fixing it.

Plus: a changeset (`'plot': patch`, description first, `bumps:` block last, run `./scripts/check-changeset-packages.sh`), and the shell gate. `scripts/check-shell-lines.sh` refuses a PR whose shipped shell is longer than at its merge base, with no override. This change adds shell, so remove an equal number of lines in the same change: the dead `bb_full_page_lacks` guards and their comments are the first candidates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. List no full suite; CI runs them. Run only the host tests you touch, by name — a whole-file `host.test.mjs` run stalls under load.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (the `bb_branch_query`, `pr-merged`, `pr-merge-commit`/`pr-merge-dest`, `pr-merged-heads`, `pr-review` and `pr-state` usage-header regions), the matching tests in `test/reconcile/host.test.mjs`, and a changeset. Wave 2 owns `plot-pr-merged.sh`; wave 3 owns the stubs and the `plot-host-bitbucket-pr-list-reads` plan. Related approved work in flight touches the same file: `jenkins-sha-lookups-in-plot-host` and `bitbucket-pr-rows-run-per-row` — rebase on main before the PR and expect conflicts in `plot-host.sh` near `:4069`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
