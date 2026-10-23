## Implementation brief — board-shows-no-tickets-offline-without

- **Plan (canonical):** `docs/plans/2026-10-23-board-shows-no-tickets-offline-without.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2371 merged
- **Branch:** `bug/board-shows-no-tickets-offline-without` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

Issue #2369: a board with no fleet and an unreachable host shows an empty inbox while `.plot/state/index/issues.json` holds the last open-issue list. `maybeRefreshPrs` (`packages/board/src/server/fleet.ts:2251`) calls `readIssuesFromStore` only inside the `fleetOwnsPrs` branch. Otherwise it calls `refreshIssues` (`:1937`), whose failure arm (`:1985-2020`) keeps `entry.issues` as they were. A board started after the outage has none, so the inbox is empty and the file is never read.

The change: in that failure arm, when the board holds no rows, load them from `issues.json` through the reader `readIssuesFromStore` already uses (`issueStoreFor(...).read()`, `:2105`). Show the rows with the failure line and the index's age. Write nothing.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**No new reader.** `issueIndexFile` (`packages/domain/src/adapters/issue-index/issue-index-file.ts`) and `readIssuesFromStore` exist. Extract what both paths share (source match, `setsOf`, `inboxOf` over `ticketPlansOf`) rather than copy it.

**The board never writes the file.** `refreshIssueIndex` is the one writer (`one-issue-index-writer.test.ts` holds it, CLAUDE.md *A Decision Reads The Index*). A second writer races on read-fold-write.

**`issueAnswer` stays `failed`.** The rows are a stale answer, not a live one. A caller that reads `answered` stops showing the failure line, and the next poll would skip the host.

**Only a matching source counts.** Use the file only when `index.source === issueSource(...).ask`. A missing, unparseable, other-version or other-source file leaves the inbox as it is today and shows no age. The index never says no: an absent file is *ask the host*, not *no issues*.

**Memory beats the file.** When `entry.issues` already holds rows from a successful read, keep them (plan Open Question 1, proposal). The file's `at` is no newer unless another process wrote it.

**Open — decide and record in the plan:** which field carries the age, the file's `at` or the last successful `askedAt` (plan Open Question 2). Pick one, state why in the PR, and amend the plan's Open Questions.

**Domain rule first.** The choice between memory rows, index rows and none is a domain property, tested without a browser (CLAUDE.md, *The Domain Package*). Write it as an arrow function in `packages/domain/src/rules/`, with TSDoc stating behaviour only. Do not add to the `Wave`-for-`Slice` naming defect. A browser test proves one thing: the badge shows the age.

### Done when

The plan states no `## Done when` list; the assertions below are the specification. Each exists because a naive implementation would pass without it.

- A board with no in-memory rows, a failed issue read and a valid same-source `issues.json` shows the file's rows. Catches: the current empty inbox.
- The same board shows the failure line and the age. Catches: rows shown as if live.
- `issueAnswer` is `failed` afterwards and the next poll asks the host. Catches: a fallback that settles the read.
- A board holding rows keeps them over an older file. Catches: the file overwriting fresher memory.
- A missing, unparseable, other-version and other-source file each leave the inbox empty with no age. Catches: a fallback that invents rows or an age.
- `issues.json` is byte-identical after the failed read. Catches: a second writer.

Plus: a changeset for `@plot-pm/board` (description first, `bumps:` block last), and `pnpm build:board` only to test locally — do not commit the bundle. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. List no full suite. Do not run board tests while an operator's board is open on this machine.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/fleet.ts`, a new rule and test under `packages/domain/src/rules/`, the inbox's staleness line in `packages/board/src/app/`, and its changeset. It touches no helper script, no plan format and no template. No other branch of this plan exists. Verified 2026-10-23: no other branch named `board-shows-no-*` exists locally or on origin.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
