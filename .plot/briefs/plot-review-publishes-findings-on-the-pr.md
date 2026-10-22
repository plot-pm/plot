## Implementation brief — plot-review-cannot-open-its-follow-up-issue (`bug/plot-review-publishes-findings-on-the-pr`)

- **Plan (canonical):** [docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md](../../docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md) on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2337 merged
- **Branch:** `bug/plot-review-publishes-findings-on-the-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch sits in the plan's single `### Implementation` slice list, not a wave with a `###` subheading — it is a sibling of `bug/plot-review-looks-up-its-issue-by-pr`, not downstream of it. As of this writing that sibling branch exists on origin but carries no merged commits into `main`: `packages/board/src/server/entry/review.ts` still has `LOOKUP_LIMIT = 200` unchanged, and no PR has been opened for it. You do not need its change to land first — this slice's own trigger (`openFollowUp` returning `ok: false`) fires today exactly as it will after that lookup is rewritten; only the *reason* it fires changes (today: the 200-issue read stalls; after: rarer, genuine tracker failures). Both branches touch `review.ts`, so expect a merge-order conflict at delivery — not a build dependency.

### What to build

On 2026-10-22, `plot-review.mjs 2335` found 1 HIGH on PR #2335, could not look up its follow-up issue (the 200-issue read stalled), and exited 4 — the commit status named the failure, but the actual findings (the HIGH/MEDIUM/LOW counts and the reviewer's verdict text) existed only in `<git-common-dir>/plot/state/reviews/<pr>-<sha>.md` on the machine that ran the review. Nobody reading the PR on GitHub or Bitbucket could see what was found.

`review.ts:427` already branches on this outcome: `if (followUp?.ok === false) lines.push(...)` — that line only reaches the run's own stdout, not the PR. Your job is to add a second effect in that branch: post the findings as a PR comment through the host connector, using the same `{ title, body }` the issue path already builds via `followUpIssue()` (`review.ts:171-187`) — its `body` already carries the HIGH/MEDIUM/LOW counts, the full verdict text, and `run ${run}`, the same marker the commit-status description uses. A failed comment is reported in the output lines; it does not change the exit code (still `EXIT.issueNotOpened`, 4 — the issue is still missing, which is what the exit code means).

### The decisions the plan settles — do not re-derive them

**The comment goes through the host connector, not the tracker — and that operation does not exist yet.** The plan's own Open Points name this as unconfirmed; it is now confirmed absent. `packages/domain/src/ports/host.ts`'s `Host` interface has no PR-comment write — `backend()`, `account()`, `prState()`, `prMerged()`, `commitStatus()` and friends exist, but nothing posts a comment. The *read* side exists for a different reason: `PrReviewReading.bypass` already reads whether any PR comment starts with `review-bypass:` (`host.ts:148`), proving the adapter touches PR comments today, just not for writing. `skills/plot/scripts/plot-host.sh` has no `pr-comment` verb either — its operation list runs `pr-state`, `pr-merged`, `pr-create`, `pr-merge`, `pr-ready`, `pr-list`, `issue-open`, `issue-status`, `commit-status`, and stops there. You are adding this operation, both the port method and its two backend arms (GitHub, Bitbucket) in `plot-host.sh`, following the same shape `commit-status` already uses for a single required text payload against a SHA — except a PR comment keys off the PR number, not a commit.

**Reuse `followUpIssue()`'s body, do not build a second comment template.** `review.ts:171` already composes `{ title, body }` from the same inputs (`pr`, `sha`, `prUrl`, `counts`, `verdictText`, `run`) your new call site has in scope at `review.ts:427` — `pr`, `sha`, `counts`, `verdictText` and `run` are all already local variables there. Call `followUpIssue(pr.number, sha, pr.url, counts, verdictText, run).body` for the comment text; do not re-derive the HIGH/MEDIUM/LOW line or the run marker a second way. The title is for the issue tracker and has no PR-comment equivalent — comments don't have titles — so only `body` crosses over.

**Comment size is an open question the plan flagged and did not settle — decide it in this slice, with a measurement.** GitHub and Bitbucket both cap comment body length (GitHub: 65536 characters). `verdictText` is the reviewer agent's full final answer and is unbounded in practice. Measure an actual verdict file under `<git-common-dir>/plot/state/reviews/*.md` for a typical size before deciding whether to truncate, and if you truncate, say what you cut and point at the local file path (already written to `verdictFile` before this code runs) so a reader can get the rest. Whatever you decide, write the reasoning as a comment on the function, because the plan explicitly left this for the implementer.

**A failed comment is reported, never escalated.** `review.ts`'s own doc comment already states the target behaviour for the *recorded-issue* comment path: *"A comment on a recorded issue that the tracker does not take (`unaskable`) keeps the issue as `target_url` and exits `EXIT.ok`; one that fails... exits `EXIT.issueNotOpened`."* Your new PR-comment-on-failed-follow-up path is simpler: there is no issue URL to keep as `target_url` (none was opened), so on a failed comment you only add one line to `lines` naming the failure — mirror the existing `uncommented` pattern's wording (`could not comment on issue ${id}: ${why}` → something like `could not post findings as a PR comment: ${why}`) rather than inventing new phrasing. The exit code was already `EXIT.issueNotOpened` from the `followUp.ok === false` branch; a failed PR comment does not make it worse, and `unaskable` (a tracker/host combination that cannot take PR comments at all) is not a failure either — report it the same way `uncommented`'s `unaskable` case does elsewhere in this file, as informational, not as a reason to change the exit path.

**Where in the code this lands.** The insertion point is `review.ts:427`, inside `if (followUp?.ok === false) lines.push(...)` — add the host call right after that line, inside the same branch, using the host connector already present as `deps.host` (the `ReviewDeps` interface at the top of the file). Do not add a new field to `ReviewDeps` for this — `host` is already there.

### Done when

The plan's `## Done when` is implicit in its Design section (the plan has no explicit `## Done when` heading): a failed follow-up issue still leaves the findings visible on the PR, with the same run marker the status description carries, and the exit code is unchanged (still 4). Concretely:

- A test exercising `openFollowUp` returning `ok: false` (reuse `review.test.ts`'s existing fixture pattern for forcing `LOOKUP_LIMIT`-style truncation, or stub the tracker to answer a generic `ok: false`) asserts the host's new PR-comment call was made with a body containing the HIGH/MEDIUM/LOW counts and `run ${run}` — catches the naive bug of posting the status description instead of the full findings.
- A test where the PR-comment call itself fails asserts the run still exits `EXIT.issueNotOpened` (not a new exit code) and `lines` names the comment failure — catches silently swallowing a second failure on top of the first.
- A test where the host answers `unaskable` for PR comments asserts no failure is reported as such — catches treating "this host cannot do this" the same as "this host tried and failed."

Plus: the repo's gates — `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base with no equal-sized removal elsewhere; since this slice adds a `pr-comment` verb to `plot-host.sh`, budget for that by trimming elsewhere in the same file if you can, or be deliberate that the growth is paid for. A changeset is required (`bumps:` naming `@plot-pm/board`, since the change is under `packages/board/src/server/entry/review.ts`, plus `plot` if `plot-host.sh` counts as a skill-level change — check `./scripts/check-changeset-packages.sh` locally). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` (plot config) run in CI, not here — a failure there comes back as a correction.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads the plan, names the wave heading as the PR title, and refuses a branch with no commit its base lacks. When the PR number exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts` (the `openFollowUp`/`followUpIssue` region), `packages/domain/src/ports/host.ts` (adding the PR-comment method to `Host`), the host adapter(s) implementing it, and `skills/plot/scripts/plot-host.sh` (new `pr-comment` verb). Test file: `packages/board/test/unit/review.test.ts`.

The sibling branch `bug/plot-review-looks-up-its-issue-by-pr` owns `openIssueOfPr` and `LOOKUP_LIMIT` in the same file — a different function in the same region. Expect a textual merge conflict at delivery if both branches edit near each other; neither branch depends on the other's *behaviour*, only on git resolving the same file twice. If you find the sibling branch has merged by the time you finish, rebase onto the result rather than resolving blind — `openIssueOfPr`'s replacement may change what `followUp.why` says, which your new comment body quotes indirectly through `followUpIssue()`.

If you find something the plan did not anticipate — e.g. the host adapter has no clean way to key a comment write off a PR number alone — report it rather than improvising outside scope.
