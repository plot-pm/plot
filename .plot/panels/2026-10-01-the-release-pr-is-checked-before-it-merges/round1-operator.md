# Round 1 — operator who cuts releases

Executed (read-only): `git fetch`; read the plan, `ci.yml`, `release.yml`, `plot-release/SKILL.md` on origin/main; `gh issue view 1040`; `gh pr list --head changeset-release/main`; Actions runs API (100 runs on the branch); check-suites for `83df5e92`; the required-status-checks API.

Position: amend

## 1. Does it fix the issue?

Yes in mechanism. The issue asks for a reporting check and a corrected comment; both are covered. It misses run cost: on 2026-10-01 the branch regenerated five times between 22:23 and 22:39. `ci.yml` has no `concurrency:` block, so each regeneration would start a full `validate` (25-minute ceiling) that nothing cancels.

## 2. Claims checked

- "0 runs with `event=push`": true. 100 of 100 runs are `pull_request`.
- `ci.yml:21` lists `changeset-release/main` under `push`: true.
- `ci.yml:960-961` *Check for changeset* is `if: github.event_name == 'pull_request'`: true, and it is the only event-gated step,.
- `release.yml:101-108` pushes with `secrets.GITHUB_TOKEN`: true.
- Required check is `validate`, `app_id 15368` (GitHub Actions), `strict: false`. A dispatched Actions run on the head SHA can satisfy it, and a behind-main branch does not block.
- The brief's premise that `/plot-release` merges with `--admin` is false. `SKILL.md` step 4 hands off and merges nothing. `/plot-release` needs no change.

## 3. Done-when

Item 3 (the test) and item 2 fail today and pass after. Item 1 is verifiable only after merge, as the Notes admit. Item 4 ("does not merge with a comment that claims it works") therefore cannot execute: the slice must merge before the measurement exists.

## 4. Operator walk-through, and what is left to guess

Each main push leads to release.yml (serialised per ref): changesets pushes the branch, then the dispatch resolves `--ref` to the new head. A later regeneration orphans the old run's SHA; harmless, but the run keeps going. The operator must wait for `validate` on the current head, and any main push in between restarts the wait.

If the run fails, the release job stays green because the dispatch is fire-and-forget. The operator sees a red `validate` on the PR and nothing else, and nothing tells them not to fall back to `--admin`.

## Required changes

1. Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'workflow_dispatch' }} }`, or an equivalent, so a regeneration cancels the superseded release-branch run. Do not cancel `main` push runs.
2. Rewrite Done-when item 4 as a post-merge action: if the first release PR after the merge shows no `validate`, or shows one held at `action_required`, record the measured run state in the plan and reopen #1040.
3. State the release step in one place: the `ci.yml` comment, or `/plot-release` step 4's hand-off line. Wait for `validate` on the PR's current head and merge without `--admin`. On red, fix the cause, or re-run with `gh workflow run ci.yml --ref changeset-release/main`. `--admin` stays a named, recorded exception.
4. Name the dispatch step's env (`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`). Have it echo the dispatched head SHA so the release log links to the run it started.
