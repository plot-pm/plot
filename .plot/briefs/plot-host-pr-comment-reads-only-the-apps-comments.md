## Implementation brief — plot-review-loses-an-existing-issue (wave 2: Marker lookup)

- **Plan (canonical):** docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2542 merged
- **Branch:** `bug/plot-host-pr-comment-reads-only-the-apps-comments` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** `plot-review` on the PR, per the repo's required review

Wave 1 (`bug/plot-review-keeps-an-issue-when-its-comment-fails`, merged as #2567) is in. Wave 3 (`bug/plot-host-title-has-has-tests`) waits on nothing here and may run concurrently — it owns `review.ts:227` and the 250-row test, neither of which this branch touches.

### What to build

`skills/plot/scripts/plot-host.sh`'s `pr-comment` arm (around line 5839, numbers drift — search for `pr-comment)` under the case statement) finds the comment holding a marker with:

```sh
cid="$(gh api --paginate "repos/{owner}/{repo}/issues/$num/comments" 2>"$HOST_ERR" | jq -rs --arg m "$3" '[.[][] | select(.body | contains($m))][0].id // empty')"
```

This matches on body text alone, from any author. A marker is a substring (e.g. `<!-- plot-review:verdict -->`); if a PR participant pastes that same string into their own comment, this lookup finds their comment first (the list is chronological) and either edits a human's comment with the verdict body, or — if the human's comment is later — leaves the bot's own prior comment live and double-posts. The `issue-comment` arm (around line 5532, the `issue-comment)` case inside `issue-label|issue-comment|issue-close)`) runs the identical line, copied, for the tracker's own issue comments.

Three changes, all in `plot-host.sh` plus the port doc:

1. **Filter by author.** Add `.author.login` (or `.user.login` — check which field `gh api .../comments` actually returns; the PR-list arms elsewhere in this file read `.author.login` from `gh pr list --json`, but the REST comments endpoint may name the field `user.login` instead — verify against a real `gh api` response or existing fixtures before picking the jq path) to the `select`, scoped to whichever login is configured for this write. Read `## Plot Config`'s `Review app` key the way `plot-github-app.mjs`'s `resolveApp` does, to decide which identity's comments count — `pr-comment` posts through the signed-in `gh` CLI identity (`host.ts:358`), not a minted App token, so confirm at implementation time whether "the review App's login" means the App's bot identity or the `gh`-authenticated account that actually posts these comments (the plan's own open question, still unchecked — name the source you used in the PR description before you check it).
2. **Share one lookup.** Extract the `jq -rs --arg m ... | ... .id // empty` line (plus whatever author filter you add) into one shell function both `pr-comment` and `issue-comment` call, parameterized by the GitHub comments endpoint (`issues/$num/comments` is actually the same REST path for both PR and issue comments on GitHub — PRs are issues under the hood — so the function likely needs only the number and the marker, not a separate endpoint per caller; confirm this before assuming a parameter is needed).
3. **Extend the port doc.** `packages/domain/src/ports/host.ts:367`'s `@param marker` doc on `prComment` says a failed edit fails and posts nothing; it says nothing about a failed *listing* (the `gh api --paginate` call itself erroring). Name that case: what happens when the comment list can't be read at all (today: `gh_fail` on the shell side, which should map to `failed`, not silently posting a duplicate).

### Decisions the plan settles — do not re-derive them

- **This is a duplicate-lookup problem, not a new mechanism.** Both arms already exist and already share the exact same jq expression by copy-paste (`pr-comment` at the `pr-comment)` case, `issue-comment` nested in `issue-label|issue-comment|issue-close)`). The fix is narrowing the `select` and then collapsing the copy into one function — not introducing a new comment-matching strategy.
- **GitHub only.** Both arms already refuse Bitbucket (`pr-comment` exits 4 outright; `issue-comment` is gated earlier by `issue_source`). Do not add Bitbucket marker-lookup logic here.
- **The REST comments endpoint, not GraphQL.** `gh api --paginate "repos/{owner}/{repo}/issues/$num/comments"` is the existing call; keep it. Changing to GraphQL to get author data is unnecessary — REST's `comments` list already includes an author object per comment.
- Carried-over rule: an absent answer is not a false one — a `gh_fail` on the listing call is `failed`, never silently treated as "no marker found, so post a new comment."

### Done when

The plan's `## Slices` entry for this branch is the specification: the `pr-comment` marker lookup is scoped to one author, the lookup logic is shared with `issue-comment` rather than duplicated, a failed listing has a test, and the port doc names that failure mode. Assertions a naive implementation passes without:

- **A marker in a non-App comment must not match.** Extend `test/reconcile/host-pr-comment.test.mjs`'s `listing()` helper (or add a sibling) to return comments from more than one author, with the marker in a comment from someone other than the configured identity, and assert `gh pr comment` (a new post) runs rather than `PATCH` (an edit) on that foreign comment.
- **A failed listing must not fall through to "no marker, post new."** The existing `listing()` stub always returns 0 from `gh api --paginate`; add a case where that call itself fails (non-zero exit, like the "failed edit" test already does for the PATCH step) and assert the command exits non-zero rather than posting.
- **The shared function must not silently change `issue-comment`'s existing passing tests.** Run whatever test file covers `issue-comment`'s marker lookup (grep `test/reconcile/` for `issue-comment`) before and after extracting the function; it must still pass unchanged — this slice does not change `issue-comment`'s observable behavior, only `pr-comment`'s.

Plus: this slice touches `.sh` under `skills/`, so `scripts/check-shell-lines.sh` ratchets the shipped shell's line count against its merge base — a new shared function adds lines; collapsing two copies into one call site should net it close to zero, but if it grows, remove shell elsewhere in the same change rather than asking for an exemption (there is none). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI. Do not run `test:e2e`, and do not run board tests while an operator's board is open.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `pr-comment` and `issue-comment` arms of `skills/plot/scripts/plot-host.sh`, `test/reconcile/host-pr-comment.test.mjs`, and the `@param marker` doc on `prComment` in `packages/domain/src/ports/host.ts`. `review.ts` and its tests belong to wave 1 (merged); `review.ts:227`'s comment, the `--title-has` shell tests and the 250-row backlog test belong to wave 3. If you find something the plan did not anticipate, report it rather than improvising outside scope.
