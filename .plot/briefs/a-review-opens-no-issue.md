## Implementation brief — fleetd-reviews-every-slice-pr-in (wave 1: Findings comment)

- **Plan (canonical):** `docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md` on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Branch:** `feature/a-review-opens-no-issue` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status (required on `main` since 2026-10-15), then merge per the repo convention

This is the first wave. Every later slice of the plan (`the-index-records-the-review`, `the-scope-is-read-from-git`, `the-review-run-is-locked`, `fleetd-reviews-slice-prs`) waits on nothing here at the code level, but the plan orders it first so that no review opens an issue at fleet volume.

### What to build

`plot-review` opens a follow-up issue for every finding, HIGH included. The decision is `if (findings !== 0)` at `packages/board/src/server/entry/review.ts:486`, where `findings` is HIGH + MEDIUM + LOW. The writer is `openFollowUp` (`review.ts:269`). On 2026-10-29 this left 22 findings issues open. When fleetd starts reviews on every green slice PR, the count grows with every PR and head.

After this slice, `reviewPr` opens no issue for any severity. Every finding goes into the one marked PR comment: `findingsMarker(pr)` (`review.ts:358`) with `Host.prComment(pr, body, marker)` edits one comment per PR in place, so a second head edits the first head's comment. The comment body names the head and the run. The status is unchanged: `failure` with the HIGH count when HIGH > 0, else `success` with `no HIGH findings`. The 22 existing issues stay open; this slice closes none.

The decision "which findings open an issue" moves into `packages/domain/src/rules/review-issue.ts` as a pure function `reviewIssue(counts: ReviewCounts)` that answers `none` for every count. The file's other exports (`reviewIssueTitle`, `findOpenReviewIssue`, `REVIEW_ISSUE_LABEL`) stay for #2903's ticket and get no new caller in this slice.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **No issue for HIGH either.** The design (`DESIGN-delivery-loop.md`) says a HIGH ticket exists only after the fixer's attempts fail. That is #2903's. Between this slice and #2903, a HIGH holds the PR at `plot/review=failure` with no ticket, which is the safe side (decision D2). Do not keep a HIGH-only issue as a stopgap.
- **One comment per PR, edited per head** (open question 2, settled): reuse `findingsMarker` and `prComment`; write no second marker and no comment per head. `host.ts:376-397` documents the edit-in-place behaviour and `review.test.ts:608` already covers it.
- **Bitbucket keeps the findings in the verdict file.** `pr-comment` exits 4 on Bitbucket (`plot-host.sh:6061`), and `prComment` answers `unaskable` (`host-shell.ts:505-512`). Do not add a Bitbucket comment write or a tracker fallback here; both are open questions in the plan. On `unaskable` the output line (today `review.ts:506`) names the verdict file, and the status description says the findings were not posted.
- **Exit code 4 (`EXIT.issueNotOpened`) now means only "findings not posted".** It no longer means "issue not opened". Keep the number, since callers read it; change the TSDoc at `review.ts:57-93` to say what it means now.
- **No path this slice adds writes `failure` for anything but a HIGH** (`review.ts:494`). A failed comment post does not turn a clean review into a failure.
- **A recorded `<pr>-<sha>.issue` from an earlier run gets no further comment.** Read nothing from that file; write nothing to it. Delete `openFollowUp`, `openIssueOfPr`, `followUpIssue`'s issue-only parts and the tracker dependency from `ReviewDeps` only where nothing else uses them. Check each with a grep before removing; `reviewTracker` and `ISSUE_MAY_EXIST` may have other callers (`plot-verify`).
- **Carried-over invariants:** a refusal writes no status and exits non-zero; the status is written on the reviewed head even when the head moved; the status description stays within the host's 140-character cap (`review.test.ts:171` pins the worst case; update its expectation, keep the cap).
- **This slice does not touch** the lock, the run id, `pending`, the index, the scope or `Auto-review`. Those are the later slices. If you see a race between two runs of one head, report it; `the-review-run-is-locked` owns it.

### Done when

The plan's slice line is the specification: `review.ts` opens no follow-up issue for any severity; every finding goes to the one marked PR comment; `reviewIssue` in `rules/review-issue.ts` answers none for every count; Bitbucket keeps the findings in the verdict file and says so.

Tests the naive change would pass without:

- **Board unit `packages/board/test/unit/review.test.ts` with `host-fixture`:** HIGH 1 and MEDIUM 2 open no issue (`r.issues` empty), post exactly one marked comment, write `failure`. A review with HIGH 0 and MEDIUM/LOW findings opens no issue, posts the comment and writes `success`. A second head edits the same comment (same marker) and posts no second. A review with no finding at all posts no comment. This catches an implementation that removes the issue but still posts one comment per run.
- **Bitbucket case:** `prComment` answers `unaskable` → the status is still written, the output names the verdict file, the exit code is 4, and the status description says the findings were not posted. This catches the `unaskable` path being swallowed.
- **Domain unit `packages/domain/test/review-issue.test.ts`:** `reviewIssue` answers `none` for HIGH 1, MEDIUM 1, LOW 1, a mix, and all zeros.
- **Remove or rewrite** the existing issue tests (`review.test.ts:144-249`, `:351`): they assert the old behaviour and must not survive as passing tests of a deleted path. Delete the ones that test only `openFollowUp`; rewrite the ones that assert status, exit code and description.

Plus the repo gates. Run `node <plot scripts>/board/plot-local-checks.mjs` (resolve the path from the plot skill directory, `skills/plot/scripts/board/plot-local-checks.mjs`) before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction; list no full suite. Run `nvm use` first (Node 24). `skills/plot/scripts/board/plot-review.mjs` is a generated bundle: do not commit a rebuild (`scripts/check-no-bundle-diff.sh`). Add a changeset (`plot: patch`, description first, `bumps:` block last, `./scripts/check-changeset-packages.sh` to check it). This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply; if it comes to need one, growth is paid for in the same change.

New functions are arrows (`export const reviewIssue = (...) => ...`). TSDoc states what the function does, its parameters, return and failure; the history goes in the commit message.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Commit subject: `plot-review: a review opens no follow-up issue`.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts`, `packages/board/test/unit/review.test.ts`, `packages/domain/src/rules/review-issue.ts`, `packages/domain/test/review-issue.test.ts`, the `plot-review` TSDoc and docs that describe the follow-up issue (grep `follow-up issue` under `skills/plot-*` and `docs/`), and one changeset.

Other slices of this plan: `the-index-records-the-review` owns `pr-index.ts` and `pr-refresh.ts`; `the-review-run-is-locked` also edits `review.ts` (the lock, `pending`, the run id) and `Host.prReview`; `fleetd-reviews-slice-prs` owns `rules/slice-pr-next.ts`. Expect `the-review-run-is-locked` to collide with this slice in `review.ts`, which is why the plan orders this slice first. Sibling plans in the sprint (#2898 reviewer role and runner inside `review.ts`, #2899 run log) also touch `review.ts`; rebase on `origin/main` before pushing.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
