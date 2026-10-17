## Implementation brief — a-planned-issue-shows-its-plan (wave 1: Connector and inbox)

- **Plan (canonical):** `docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1985 merged
- **Branch:** `feature/issue-plan-state-write` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention
- **Answers:** GitHub issue #1979 (in part)

`feature/issue-plan-state-commands` waits on this branch: it calls the `planStateWrite` method this slice adds. `feature/issue-plan-state-inbox` is independent and touches `packages/board/src/server/fleet.ts` only.

### What to build

A tracker port method, `planStateWrite`, that sets a `plan:*` label on an issue, posts one comment linking the plan, and closes the issue at release. Measured 2026-10-17: 16 open issues had a plan in review, approved or delivered and none showed it; on a GitHub tracker every `issue-status` write answers `no-target` today. This slice builds the write only. It wires no lifecycle command; the commands slice does that.

Pieces:

- `packages/domain/src/rules/issue-status.ts`: `issueStatusWrites` gains the `draft` and `approved` phases. `IssueStatusWords` gains an `approved` word (`Tracker approved status`); draft owes no Jira status word.
- `packages/domain/src/ports/tracker.ts`: new method `planStateWrite` beside `statusWrite` and `issueOpen`. Arguments: the issue, the phase, the plan link and, for `released`, the release version.
- `trackerGitHost` (`adapters/tracker/tracker-github.ts`) implements it over three new `plot-host.sh` operations: `issue-label`, `issue-comment`, `issue-close`. `plot-host.sh` has no issue write beside `issue-open` and `issue-status` (`plot-host.sh:5004`, `:5050`).
- `trackerNone` (`tracker-none.ts`) answers `unaskable`. The Jira connector (`tracker-jira.ts`) keeps `statusWrite` and answers `no-target` to `planStateWrite`.
- `tracker-fixture.ts` and `notifier-fixture.ts` implement the new method, or the type check fails.
- `plot-issue-status.sh` stays the shell entry and gains the `Tracker approved status` read.
- Amend the doc comments at `tracker.ts:51-53` and `:149-152` and `entities/issue.ts:21-29` to name `planStateWrite` as the third write and to state that no rule reads a `plan:*` label.

### Settled decisions — do not re-derive them

**The write is one-way.** Plot writes the label and the comment and no Plot code reads them back. The plan amends three recorded refusals (`tracker.ts:51-53,149-152`, `issue.ts:21-29`, `MANIFESTO.md:17`) in substance only because of that. Do not add `labels` to the `Issue` entity or to `IssueIndexRow`, and do not read a `plan:*` label anywhere. Git stays the source of truth for the phase. `issues.json` keeps its version.

**`StatusWrite` stays unchanged.** A label is not a status. Do not extend `statusWrite` to carry it: that is the mirror `tracker.ts:51-53` refuses, and one method cannot answer both `no-target` for a Jira label and `written` for its status.

**All GitHub calls go through `plot-host.sh`.** `scripts/check-host-cli-callers.sh` bans a second `gh` caller. The three new operations dispatch on `issue_source` like `issue-open` (`plot-host.sh:5050`), never on `tracker_scheme`, and exit 4 with the reason for a source that cannot be asked.

**A label write replaces the previous `plan:*` label**, so an issue carries one. The labels `plan:draft`, `plan:approved`, `plan:delivered` and `plan:released` exist on plot-pm/plot. The plan names the first three only in its table; read the changelog line for the fourth.

**Jira gets a status and nothing else**: no label, no comment, no draft status.

**A repository with no tracker answers `unaskable`, never `written`** (`tracker.ts:264`): a silent success reports a write that never left the machine.

**Open questions in the plan, resolved here for this slice:**

- Failure: a failed write is reported and never raised, as for the delivered and released writes. Return the outcome; do not throw.
- Idempotence: a re-run must not post a second comment. The comment carries a marker the connector finds (for example an HTML comment holding the plan slug), and the second write edits the existing comment instead of posting. Test it: two calls, one comment.

### Done when

The plan's `## Slices` line for this branch is the specification. Beyond it, assertions a naive implementation would pass without:

- Two `approved` writes leave one comment and the link now points at the plan file on the default branch (catches a second comment per run).
- A `delivered` write after `approved` leaves exactly one `plan:*` label (catches an additive label).
- `trackerNone` answers `unaskable` on `planStateWrite` including `released` (catches a silent success).
- A `released` write on a Jira tracker closes nothing and comments nothing.
- `issueStatusWrites` with an empty `approved` word returns an empty list, and no word stands in for another.

Plus: a changeset (`plot: minor` with a `bumps:` block last, description first). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: the three new `plot-host.sh` operations add lines, so remove shell elsewhere in the same change, or keep each operation to the `gh` call and put the rule in the domain. The gate stores no number and has no override. Domain code uses arrow functions, and a TSDoc block states behaviour, not history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned by this branch: `packages/domain/src/rules/issue-status.ts`, `packages/domain/src/ports/tracker.ts`, `packages/domain/src/entities/issue.ts` (doc comment only), `packages/domain/src/adapters/tracker/*`, `notifier-fixture.ts`, the tracker tests under `packages/domain/test/`, `skills/plot/scripts/plot-host.sh`, `plot-issue-status.sh`, and the changeset.

Not owned: `packages/board/src/server/fleet.ts` (`feature/issue-plan-state-inbox`); `plot-idea`, `plot-approve`, `plot-deliver`, `plot-release` skills and `plot-reconcile-scan.sh` (`feature/issue-plan-state-commands`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
