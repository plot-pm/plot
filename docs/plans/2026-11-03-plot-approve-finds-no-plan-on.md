# plot-approve finds no plan on an open Bitbucket PR

> `plot-approve` reports `plan-not-found` for a plan that exists only on its open Bitbucket plan PR, because the plain `pr-list` row carries no `headSha`; its draft-clearing call also uses a `bb` subcommand that does not exist.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3089
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-approve` and the board's Approve button find a plan that exists only on its open plan PR on Bitbucket, and take that PR out of draft.

<!-- Board impact: none to the plan format or layout. The approve controller (`board/plot-approve.mjs`) changes behaviour on Bitbucket; rebuild the board artifact only if its source changes. -->

## Motivation

Issue #3089, measured 2026-11-03 on Plot 2.30.0 with `Git host: bitbucket`: approving `mat-spiel-auf-der-404` fails with `no plan found ... on the heads of the open PRs`, although `git ls-tree origin/idea/mat-spiel-auf-der-404 docs/plans/` lists the file and `plot-host.sh pr-list` lists PR #975. A `Review: pr` plan lives only on its plan PR until approval, so on Bitbucket no such plan can be approved from the default-branch checkout. The workaround is to run the command from the plan branch.

Two defects in `skills/plot/scripts/plot-host.sh` cause it:

1. The plain Bitbucket `pr-list` arm (no `--rich`, no Jenkins) emits `{number,title,state,head,author}`. The other Bitbucket arms emit `headSha` from `.source.commit.hash`. The open-PR lookup in `board/plot-approve.mjs` filters on `(n.headSha ?? "") !== ""`, so it drops every row of the plain arm before `changedFiles(headSha)` runs.
2. `pr-ready` on `bb` runs `bb pr update <n> --ready`. `bb --help` lists `pr edit <id> ... --ready/--draft` and no `pr update`. This matches the second finding in the issue: `plot-approve: could not take PR #975 out of draft`, while `bb pr edit 975 --ready` succeeds. The cause is read from the script and the CLI help; the failing call has not been run.

## Design

### Approach

- **Emit `headSha` on every Bitbucket `pr-list` arm.** Add `headSha:(.source.commit.hash // "")` to the plain arm. The value is Bitbucket's short hash, as in the other arms. The consumers that already read it (`pr-merge --match-head`, `jenkins_sha_runs`) prefix-match it.
- **Make the lookup accept a short sha, or fall back to the fetched ref.** Check that `changedFiles(headSha)` works with a 12-character hash. Where a row has no `headSha`, read `origin/<head>`, which the fetch already brings in, instead of dropping the PR silently. Which of the two the lookup uses is an open question below.
- **Correct the `pr-ready` call** to `bb pr edit <n> --ready` and check it against the installed `bb`.
- **Contract test.** Every backend's `pr-list` row carries the fields the open-PR lookup filters on (`head`, `headSha`). The test runs the Bitbucket plain arm against a stubbed `bb` and fails when a field is missing. A second test covers `pr-ready` on `bb`. The GitHub backend already carries the fields, which is why the gap showed only on Bitbucket.
- **Layering.** `plot-host.sh` stays the one place that talks to the host CLI. The lookup stays in the approve controller and calls the domain. No new script is added.

### Open Questions

- [ ] Does `changedFiles` accept a short sha, or must the adapter `rev-parse` it to the full sha?
- [ ] Should the lookup also fall back to `origin/<head>` when `headSha` is absent, or is emitting it on every arm enough?
- [ ] Does any other consumer assume the plain Bitbucket row has no `headSha`?
- [ ] Does `bb pr edit --ready` exist in the older `bb` versions the caveat list near the top of `plot-host.sh` mentions?

## Slices

### Fix

- `bug/plot-approve-finds-no-plan-on` — emit `headSha` on the plain Bitbucket `pr-list` arm, correct `pr-ready` to `bb pr edit --ready`, make the open-PR lookup handle a short or absent sha, and add the contract tests <!-- builds: headSha on the plain Bitbucket pr-list arm -->

## Notes

- Created from tracker issue #3089 by `/plot-idea`; the issue is the only link and no write went to the tracker.
- The issue's suggested fix lists four steps; they map to the approach above one to one.
