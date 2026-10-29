# Panel moderation: fleetd-reviews-every-slice-pr-in

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: the `CHECKS_OF` fold run on sample rollups (layering, seams); a concurrency probe running two `reviewPr` on one head (safety); a read of the live PR index, v5, 1023 rows (testability); per-commit history of sprint `follow-ups-2-29-1` (layering, safety); board `review.test.ts` 56/56 and domain baselines.

## Agreed by all four

1. **The PR index holds no review record, and its CI colour already contains the review.** `PrIndexRow.review` is GitHub's `reviewDecision` (`entities/pr-index.ts:39`), empty on all 1023 live rows. `plot/review` is a status context folded into `checks` (`plot-host.sh:706`): a HIGH reads `checks: failing`, and "no review" and "review success" both read green. So the rule cannot tell CI red from HIGH, nor unreviewed from clean. This plan must build the record: a review-state column with its SHA and a CI colour without `plot/review` (a `PR_INDEX_VERSION` bump through `pr-refresh.ts`, the one writer), or a reader over the local `reviews/<pr>-<sha>` records. A per-PR `prReview` host call per tick breaks *A Decision Reads The Index*. #2902 and #2903 wait on this choice.
2. **The reviewer must start as `plot-review.mjs`, detached, not through bare `agentRun`.** Only `reviewPr` writes the `plot/review` status, it waits up to 3600 s, and it lives in a board entry the fleet package cannot import. Start it the way auto-verify's `startBoardRun` does, with an in-flight record, a concurrency bound and an on/off key (`verifyStart`, `auto-verify-in-flight.json` are the pattern).
3. **A HIGH still opens an issue at review time** (`review.ts:483-488`; the plan cites the docstring at `:58-66`). No plan removes it, so a HIGH gets a ticket before the fix is tried. This plan removes it for every severity; #2903 opens the ticket only after the attempts. The severity decision moves into `rules/review-issue.ts`.
4. **Slice order: Tickets → Scope → Rule.** The rule wired first reviews every green open PR at opus price, including the 10 open `idea/*` plan PRs, and opens MEDIUM/LOW issues at fleet volume.

## Executed findings that raise the stakes

- **Two concurrent reviews of one head corrupt the first** (safety, executed): the second deleted the first's diff and verdict files (`review.ts:424-425`) before its worktree add refused (`:430-431`); the first reviewer then had no diff — any diff over 98,304 bytes lives only there — and can still write `success`. The status is last-writer-wins per SHA (`host.ts:117-120`), so a later run can overwrite a HIGH `failure` with `success`, which #2902 merges. Amendment: an in-flight mark every machine sees (`plot/review=pending`), and no unattended run overwrites a `failure`.
- **A run that writes no status loops a full opus review every pass** (failed write, refused verdict, leftover worktree). The rule needs a per-head budget and backoff (safety).
- **Main's ruleset has two `always` bypass actors**: the admin role and integration 5173644 (safety, read-only `gh api`). "No bypass rights" depends on which token fleetd uses.
- `allow_auto_merge` is on for the repo; an armed auto-merge would bypass one-merge-in-flight (safety).

## Disagreement for the person

- **When the scope freezes.** Sprint `follow-ups-2-29-1` held 2 plans at its `sprint: start` commit and 11 at close, added by `sprint: scope change` commits a person made. A literal freeze at start would have kept 2 of 11 (testability: 9 delivered plans would have had no fleet review and could not merge). Jurors agree on the mechanism — read the sprint file from git, no state file, drop struck items — and disagree on the point: the start commit (seams) or HEAD, re-frozen by each person's scope change (layering, safety).

## Smaller amendments

- Scope also has to admit the main-repair, revert and release PRs (#2904, #2907), or the ruleset blocks them (seams).
- `prComment` exits 4 on Bitbucket (`plot-host.sh:6061`), so MEDIUM/LOW findings reach nobody there; name the Bitbucket route (layering, safety).
- `plot-review-status.sh` becomes an undeclared shell duplicate of the review arm: make it a launcher or declare it with a corpus test (layering).
- The plan lists #2899 and never uses it; the run log is the natural in-flight guard (seams, testability).
- `sprintFrom` lives in the board package; the scope reader needs a domain home (testability).
- Open question 2 is answered: `findingsMarker` + `prComment` edit one comment per PR in place (`review.ts:358`, covered at `review.test.ts:608`).

## Shared blind spot

All four treat the review as one opus run per head. None priced it: a sprint of 30 slices with two pushes each is 60 opus reviews, before re-reviews after fixes.
