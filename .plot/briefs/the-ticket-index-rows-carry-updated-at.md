## Implementation brief — the-ticket-index-updates-incrementally-and (wave 1: Rows)

- **Plan (canonical):** `docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1857 merged
- **Branch:** `feature/the-ticket-index-rows-carry-updated-at` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI must pass

Wave 1 of 3. `feature/the-issue-pass-reads-since-its-last-answer` (wave 2) and `feature/the-index-takes-plots-own-issue-writes` (wave 3) build on the rule this branch adds and are not yours. Wave 2 does not start until this branch merges.

### What to build

The issue index fills its open rows by replacing them whole on every pass (`refreshIssueIndex`, `packages/fleet/src/shared/issue-refresh.ts`). Measured 2026-10-16: the board showed #1756 open minutes after it closed, and the index held 140 open rows against 30 open issues on GitHub. Waves 2 and 3 fold single rows into the held rows, and they need two things that do not exist yet. This branch adds both and changes no pass behaviour.

1. `IssueIndexRow` gains an optional `updatedAt` (ISO-8601, present only where the tracker gave it). `IssueIndexRowSchema` (`packages/domain/src/entities/issue-index.ts:36`) is `.strict()` with no `.default()`; keep both. `issueIndexRowOf` (`issue-refresh.ts:68`) fills the field with the same conditional-spread idiom as its neighbours.
2. `foldIssueRows`, a pure domain rule in `packages/domain/src/rules/`, folds issue rows by key (`number`). Where two readings of one key disagree, the row with the newer `updatedAt` wins; a row with no `updatedAt` loses to one that has it; on an equal `updatedAt`, or when neither has one, the incoming row replaces the held one.

`Issue` (`packages/domain/src/entities/issue.ts:33`) has no `updatedAt` today, so the row cannot be filled from it. Add `updatedAt?: string` to `Issue`, absent where the tracker states none. Fill it in the GitHub and Jira connectors only where the field is already in the payload they parse (GitHub `updated_at`, Jira `fields.updated`). Do not add a request or a field to a query to get it. If a connector would need a new request, leave it absent and report it.

The plan is canonical; this is orientation.

### Settled — do not re-derive

- **One writer stays.** `refreshIssueIndex` remains the only caller that writes `issues.json`; `one-issue-index-writer.test.ts` holds it. `foldIssueRows` is a pure function and writes nothing. Do not import it into a second module that writes the file.
- **The fold is a domain rule over values.** It takes rows and returns rows, with no port and no clock (CLAUDE.md, The Layering Rule: readings as values). Arrow function, TSDoc stating behaviour only, no argument in the comments (CLAUDE.md, The Domain Package).
- **Answers, never verdicts.** The fold decides which of two bought answers is newer. It derives no lifecycle decision and persists no verdict.
- **Absent is not older.** A row with no `updatedAt` is not read as "oldest possible, replace silently": it loses to a row that has one and replaces an equal one. A test for each of the four arms (newer, older, equal, one side absent) is the contract.
- **Do not change pass behaviour.** `refreshIssueIndex` still reads whole and replaces whole in this branch. Use of the fold is wave 2's.

### Open question this branch must answer, not defer

The plan asks whether `ISSUE_INDEX_VERSION` moves from 1 to 2 (`issue-index.ts:12`). The row schema is `.strict()`, so a reader built before this branch fails to parse a row carrying `updatedAt` and, per the store's contract, reads "ask again". That fallback is safe. A version bump is the heavier option: every reader (`topics.ts`, `fleet.ts`, `waiting-tickets.ts`) reads the old file as absent until the next pass. Pick one, state it in the PR body with that reasoning, and amend the plan's Open Questions line in the same change. Do not leave it for wave 2.

### Done when

The plan states no `## Done when` list; the slice line is the specification: `IssueIndexRow` gains `updatedAt`, `issueIndexRowOf` fills it, and a fold-by-key rule in the domain applies the newer-`updatedAt` rule. Concretely:

- A row round-trips through `IssueIndexSchema` with and without `updatedAt`, and a cold store stays byte-identical to no store (catches an accidental `.default()`).
- `issueIndexRowOf` omits `updatedAt` for an `Issue` that has none, rather than writing `undefined` or `''` (catches the spread idiom copied wrongly).
- `foldIssueRows` tests cover the four arms above, plus a key present on one side only, and the input arrays are not mutated.
- The fold is order-independent for rows with distinct `updatedAt` (catches a "last one wins" implementation that passes the simple tests).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. A new rule file under `packages/domain/src/` is covered by the domain checks it prints (`vitest related`, `tsc --noEmit`). Add a changeset (`plot` package; description first, `bumps:` block last). This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

You own: `packages/domain/src/entities/issue.ts`, `packages/domain/src/entities/issue-index.ts`, a new rule file in `packages/domain/src/rules/` with its test, the row mapping in `packages/fleet/src/shared/issue-refresh.ts`, and the GitHub and Jira connector parsing of one existing field. In flight elsewhere: waves 2 and 3 of this plan (not started; they edit `issue-refresh.ts` and the `Tracker` port after you merge). If you find something the plan did not anticipate, report it rather than improvising outside scope.
