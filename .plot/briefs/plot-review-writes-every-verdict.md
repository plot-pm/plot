## Implementation brief — a-second-review-of-the-same (wave 1: Verdict per run)

- **Plan (canonical):** docs/plans/2026-10-19-a-second-review-of-the-same.md on main
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2126 merged
- **Branch:** `bug/plot-review-writes-every-verdict` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This is the plan's only wave. No other branch waits on it or touches `review.ts`.

### What to build

A second `plot-review` run on a head that already has a recorded issue sets `plot/review` and writes no verdict. PR #2104, head `7fe19d70`, was reviewed twice on 2026-10-19: run 1 (16:32:17 UTC) wrote success and `HIGH 0, MEDIUM 2, LOW 4` into #2113; run 2 (16:44:37 UTC) wrote a failure status for "1 HIGH finding" and left #2113 with 0 comments. A failure status blocks the merge, and no artefact names its HIGH.

The cause is in `openFollowUp` (`packages/board/src/server/entry/review.ts:~223`). Both write branches (`issueComment` on an existing issue, `issueOpen`) sit inside `if (issueId === '')`. A non-empty `recorded` id skips them and returns the URL. The fix: when `recorded` holds an issue id, call `deps.tracker.issueComment(recorded, followUp.body)` before building the URL. Build `followUp` before the `pending` check or hoist it, so both paths share one body. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **The recorded id is where to write, not proof the verdict is written.** Do not add a lookup (`openIssueOfPr`) on this path: the id is already known, and `issueListLabelled` costs a request budget for nothing.
- **A refused comment has the existing shape.** Return `{ ok: false, why }` with the same `could not comment on issue <id>: <reason>` text the existing-issue branch builds, so `reviewPr` still writes the status and exits `EXIT.issueNotOpened`. Do NOT `removeFile(issueFile)` on this path: the recorded id is still the right issue, and removing it would make the next run look up or open another. Test it.
- **`pending` is unchanged.** A recorded `pending` still returns `ISSUE_MAY_EXIST` and comments nothing.
- **Opening is unchanged.** A second run opens no second issue. Update the TSDoc on `review.ts` (line ~63, "a second run against the same head reuses the recorded issue and opens none") and on `openFollowUp` to say the run also writes its verdict.
- **No new tracker port operation.** `issueComment` already exists on the port and is what the first-run branch calls.
- **No `handOffIssueWrite` on the comment.** That hand-off runs after `issueOpen` only (the index needs the new issue). A comment adds no issue to the index. Keep it that way; `refreshIssueIndex` stays the one writer of `issues.json`.
- **Cost accepted:** a repeated run with an unchanged verdict adds a second comment with the same counts. The issue (#2115) asks for every review to write its verdict.

### Open questions — close each with a stated reason, in the plan's checkboxes, in this PR

- **Run marker.** Recommendation: the verdict timestamp (UTC, to the second), because it needs no new state. A per-head counter needs a file beside the issue file and a read-modify-write that two concurrent runs can lose. `ReviewDeps` has no clock today (`review.ts` uses `Date.now` only for the agent run, ~line 501): add one to `ReviewDeps` so the test can fix it. Put the marker in the comment body and in the status description, identically, so a reader matches status to comment.
- **Description length.** GitHub caps a commit-status description at 140 characters. Worst case today: `<n> HIGH findings; follow-up issue not opened; run 2026-10-19T16:44:37Z`, about 75 characters. Assert the longest realistic description is under 140, so a later suffix cannot overflow silently.
- **Unchanged verdict on the second run.** Recommendation: comment anyway. Skipping needs a comparison against the last comment, which is a read the path does not make today, and the issue states the first behaviour.

### Done when

The plan's slice line is the specification. Lift these assertions, each of which a naive implementation would pass without:

- **The existing test pins the bug.** `review.test.ts` *"a second run on an unchanged head files no second issue"* (line ~138) asserts only `issues` has length 1 and the two statuses share a `targetUrl`. Keep it, and add the missing half: the second run adds exactly one comment. A fix that opens a second issue fails the first; a fix that comments nothing fails the second.
- **The status and the last comment agree.** Assert the last comment body carries the same run marker as the last status description. A test that counts comments alone passes with the marker missing from one side.
- ***"a second run on the same head makes no lookup and no comment"*** (line ~570) asserts `commented` has length 1 over two runs. Its name states the behaviour this plan reverses; change the expectation and the name together. Keep the `lookups` assertion: the second run still makes no lookup.
- **A failed comment on a recorded id** exits `EXIT.issueNotOpened`, names the reason, and leaves the issue file in place.
- **A recorded `pending` still comments nothing.**

Plus: `plot-review.mjs` is built from `review.ts`. Do not commit the bundle (`scripts/check-no-bundle-diff.sh`); `main` builds it. Add a changeset (`'@plot-pm/board': patch`, description first, `bumps:` block last, `plan:` line inside it). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses growth in shipped shell; this slice touches no `.sh` file.

Run the board's tests with `pnpm --filter @plot-pm/board exec vitest related --run <changed>`, not `test:board`, which takes the operator's board down.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts`, `packages/board/test/unit/review.test.ts`, the plan's Open Questions, and one changeset. `review-bypass.ts` and `approve.ts` read the status this command writes; do not change them. The tracker port (`packages/domain/src/ports/tracker.ts`) and its connectors stay untouched.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
