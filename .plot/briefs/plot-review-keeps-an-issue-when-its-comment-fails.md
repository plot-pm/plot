## Implementation brief — plot-review-loses-an-existing-issue (wave 1: Issue and status)

- **Plan (canonical):** docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2542 merged
- **Branch:** `bug/plot-review-keeps-an-issue-when-its-comment-fails` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** `plot-review` on the PR, per the repo's required review

Waves 2 (`bug/plot-host-pr-comment-reads-only-the-apps-comments`) and 3 (`bug/plot-host-title-has-has-tests`) wait on this branch's merge. Wave 3 documents `review.ts:227`; do not touch that comment here.

### What to build

`openFollowUp` in `packages/board/src/server/entry/review.ts` (lines 270–338) loses a follow-up issue that exists. When the issue is found by label lookup (`openIssueOfPr`, line 293) and `deps.tracker.issueComment` refuses, line 300 calls `deps.removeFile(issueFile)` and line 304 returns `{ ok: false }`. The run reports "the follow-up issue was not opened" while the issue exists, and the next run finds no recorded id and opens against a missing record. Separately, when the tracker answers `unaskable` for the comment, `failed` is false, so the status description has no suffix and no marker, the exit code is 0, and `target_url` points at an issue that holds an older verdict. The first run's description (line 511) carries no run marker because `commented` is false on the open path, while the issue body it opened carries one.

Three changes, all in `review.ts`:

1. **Found issue, failed comment:** keep `issueFile` (write the found id, as the success path does at line 307), set `issueId`, and return `{ ok: true, url, commented: false, uncommented: { why, failed } }` — the shape the recorded-id arm already builds at lines 285–288. `failed` follows the same rule: `commented.why !== 'unaskable'`.
2. **Unaskable comment:** the status description names the uncommented verdict, and `target_url` is the PR (`pr.url`), not the issue. Today only `uncommented.failed === true` gets the `; verdict not commented` suffix (line 511); extend it to the unaskable case.
3. **First run's marker:** the description of a run that opened a new issue carries `; run <run>`, the id the issue body carries.

### Decisions the plan settles — do not re-derive them

- **A failed comment is a failure of the verdict's delivery, not of the issue's existence.** Reporting "not opened" for an existing issue is the defect. Do not remove the file to force a retry: the record is what stops the duplicate.
- **Reuse the `uncommented` path.** It already exists for the recorded-id arm and a newly opened issue. Do not add a second field for the found-issue arm.
- **The exit code follows the existing rule, not a new one.** The plan's open question asks whether a failed comment on a found issue exits non-zero. Read the code before answering: line 520 already exits `EXIT.issueNotOpened` when `uncommented.failed` is true and 0 when the comment is `unaskable`. The found-issue arm takes the same branch, and the plan's open question stays unchecked until you confirm that in the PR description. Do not invent a third behaviour.
- **`pending` handling is unchanged.** The `pending` sentinel (line 273) still refuses; `ISSUE_MAY_EXIST` still keeps the file on an open that may have created an issue (line 315).
- Carried-over rules: an absent answer is not a false one (`unaskable` is not `failed`); read the exit code, not the emptiness; the status description is the only text a reader of the commit status sees.

### Done when

The plan's `## Slices` entry for this branch is the specification: the issue record survives a failed comment, the run reports the issue as opened, an unaskable comment is named in the status with `target_url` on the PR, and the first run's description carries the run marker. Assertions a naive implementation passes without:

- **The second run must reach the host.** The test at `packages/board/test/unit/review.test.ts:608` uses a fixed `RUN`, so both bodies match and it passes with the second call never made. Make the run id differ between the two runs and assert the second body differs. Mutate the production code (restore the `removeFile`) and confirm the new test fails.
- **A stub that filters titles proves nothing.** The 250-row test at line 663 belongs to wave 3; leave it.
- **The file is kept, not rewritten to the same text.** Assert `deps.readText(issueFile)` holds the issue id after the failed comment.

Plus: this slice edits TypeScript only; it adds no shell, so `scripts/check-shell-lines.sh` is unaffected. Write any helper you add as an arrow function. Add a changeset for `@plot-pm/board` (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI. Do not run `test:e2e`, and do not run board tests while an operator's board is open.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts` and `packages/board/test/unit/review.test.ts` (the second-run test only). The `pr-comment` arm of `skills/plot/scripts/plot-host.sh` and the port's marker doc belong to wave 2; the `--title-has` shell tests, the `review.ts:227` comment and the 250-row test belong to wave 3. If you find something the plan did not anticipate, report it rather than improvising outside scope.
