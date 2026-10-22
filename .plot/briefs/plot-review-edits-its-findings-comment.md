## Implementation brief — plot-review-posts-a-new-findings

- **Plan (canonical):** [docs/plans/2026-10-22-plot-review-posts-a-new-findings.md](../../docs/plans/2026-10-22-plot-review-posts-a-new-findings.md) on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2350 merged
- **Branch:** `bug/plot-review-edits-its-findings-comment` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plan declares `Review: pr`

This is the plan's only slice — no wave ordering to track.

### What to build

`plot-review` can already comment on a PR's follow-up issue, but it has no way to comment on the **PR itself**. #2343 (`bug/plot-review-publishes-findings-on-the-pr`) adds that: when the follow-up issue cannot be opened, the review posts its findings as a PR comment, and it posts a new one on every run. This slice closes the gap #2343 opens: key that PR comment by the run marker, so a second review of the same PR **edits** the earlier comment instead of stacking a duplicate.

The mechanism already exists for issues — `plot-host.sh issue-comment <number> <marker> <body>` (`skills/plot/scripts/plot-host.sh:5318-5336`) reads the issue's comments, finds the one containing `<marker>`, PATCHes it if found, else posts. This slice builds the same shape for PRs: read, find-by-marker, edit-or-post — and wires the host port and TypeScript adapters behind it.

### The decisions the plan settles — do not re-derive them

**Add a new op; do not overload `issue-comment`.** The plan's Open Point asks whether a PR comment can go through `issue-comment` (GitHub treats a PR as an issue under the hood) or needs its own `pr-comment` op. Bitbucket has no issue/PR unification — a PR comment and an issue comment are different endpoints there (`pullrequests/<id>/comments` vs. the Jira-only issue path) — so a shared name across backends only works if it is named for what both backends can do: comment on a PR. Use `pr-comment` as the shell op name and `prComment` as the `Host` port method name. This keeps the two backends' operation names equal and avoids the GitHub-only shortcut the plan flagged as unlikely to survive Bitbucket parity.

**This lives on the `Host` port, not `Tracker`.** The plan is explicit: "the review controller calls the domain, the domain calls the port, and only the adapter reaches `plot-host.sh`" — and names it as a **host** connector operation, not a tracker one. `issueComment` is a `Tracker` port method (`packages/domain/src/ports/tracker.ts:419`) because an issue belongs to whichever tracker is configured (GitHub issues, Jira, none). A PR always belongs to the git host, so `prComment` belongs next to `prCreate`, `prReview`, `commitStatus` on `packages/domain/src/ports/host.ts` (currently 13 methods, none of them comment-shaped) and its adapters: `packages/domain/src/adapters/host/host-shell.ts` (the real shell-calling implementation) and `host-fixture.ts` (the test double).

**Marker keys the comment, not the PR.** Per the plan's first Open Point, the run marker names one reviewed head (`run <ISO-timestamp>`, see `followUpIssue` in `packages/board/src/server/entry/review.ts:171-187` and the `run` value at `review.ts:427`, `deps.now()`). The plan resolves this explicitly in its Changelog line: "a repeated review of the same PR edits the earlier comment, found by its run marker" — meaning the **marker that keys the lookup is NOT the run's own marker** (that always differs between runs) but a fixed per-PR marker the body still carries the run's own marker inside, the same way `issue-comment`'s `<marker>` argument is passed once and reused by every call site that wants "the one true comment" for that subject. Concretely: pass a stable marker (e.g. a fixed string like `plot-review-findings` or similar, not `run ${run}`) as the lookup key, and keep embedding `run ${run}` inside the comment body for human matching against the status description — exactly as `issue-comment`'s existing shape separates "what finds the comment" from "what the comment says." Confirm this reading against the plan's phrase "found by its run marker" before diverging — if misread, the fallback is a PR-scoped marker computed from `pr.number` alone (equivalent in effect, since one PR has one such comment either way).

**The failed-edit fallback is still an Open Point — the plan does not decide it.** "A failed edit: fall back to a new comment, or report and change nothing?" is unresolved, and the plan says a fallback "re-creates the stacking this plan removes." Default to **report and change nothing** (mirror `issue-comment`'s own error handling, which has no fallback path either — a failed `gh api -X PATCH` call is a `gh_fail`, full stop). Record this choice in the branch's own notes if it differs from the final call, since no other document will.

**`#2343` dependency — unmet on `main` as of this writing.** The plan says "`#2343` must be merged first: the posting code this plan changes lives in that slice," and both #2343 and its sibling #2344 are still open, unmerged PRs. `packages/board/src/server/entry/review.ts` on current `main` has neither the by-PR-number issue lookup (#2344) nor any PR-comment-on-failure code (#2343) — `openFollowUp` still does the pre-#2343 issue-only flow. **Check `main` again before writing code**: if #2343 merged in the meantime, the PR-comment call site it adds is what this slice's `prComment` op gets wired into. If it has not merged, there is no call site yet to edit — in that case, build the `pr-comment` op and its tests in isolation (host port, shell op, adapters) and leave the call-site wiring as a noted follow-up rather than inventing where #2343's code will land.

### Done when

The plan's `## Done when` is implicit in the slice line — restated: a marker-keyed PR comment operation (read, edit, else post) exists on `plot-host.sh` and the `Host` port, implemented on both GitHub and Bitbucket, and the findings-comment call site (once #2343 lands) uses it.

Tests to lift, because a naive implementation passes without them:
- **A second run on the same PR edits the first comment** — not a second comment. Assert comment count stays at 1 after two calls with the same marker.
- **A run with no earlier comment posts one.** The zero-comments case must not be mistaken for an edit of something that doesn't exist.
- **Bitbucket comment edit needs the comment id.** Confirm (or name the gap, per the plan's Open Point) that `bb api` can PUT/PATCH an existing PR comment — if it cannot, the Bitbucket arm may need to fall back to list-then-delete-then-post, or the gap must be named rather than silently only-implemented-for-GitHub.
- **A fixture/shell test for the marker-not-found path** — confirms it posts rather than silently doing nothing.

Plus the repo's gates: changeset required (`plot` package, bump level per `## Versioning` in CLAUDE.md), and run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push — run what it prints. The suites in `CI suites` run in CI; a failure there comes back as a correction. List no full suite here.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. Adding the `pr-comment` case to `plot-host.sh` (mirroring `issue-comment`'s ~18 lines) grows the shell — pay for it in the same change, either by trimming shell elsewhere or by keeping the new case as compact as `issue-comment`'s existing one rather than a more elaborate rewrite.

### Bookkeeping

Open the PR through the controller once a real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Do not run `gh pr create` — it reads the plan and brief automatically; the title comes from the plan's single slice, not the last commit subject.

Once opened, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-22-plot-review-posts-a-new-findings.md`), and set the PR to "Ready" on the project board if one is configured for this repo — push the first real commit as soon as it exists.

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-host.sh` (new `pr-comment` case)
- `packages/domain/src/ports/host.ts` (new `prComment` method + types)
- `packages/domain/src/adapters/host/host-shell.ts` and `host-fixture.ts` (implementation + test double)
- `packages/board/src/server/entry/review.ts` (wiring the findings-comment call site to the new op — only once #2343's call site exists on `main`; if it does not yet exist, confine this branch to the port/adapter/shell layers and name the wiring as a follow-up)
- Tests under the corresponding `*.test.ts` files for the above, and any `test/reconcile/*.test.mjs` exercising `plot-host.sh pr-comment` directly

No other branch is in flight on this plan (single-slice plan). The two sibling plans this one depends on (`bug/plot-review-publishes-findings-on-the-pr` #2343, `bug/plot-review-looks-up-its-issue-by-pr` #2344) are separate PRs from a separate, earlier plan (`plot-review-cannot-open-its-follow`) — watch their merge status; merging ahead of them risks a call-site conflict in `review.ts` since both slices touch `openFollowUp`/the findings-posting path.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
