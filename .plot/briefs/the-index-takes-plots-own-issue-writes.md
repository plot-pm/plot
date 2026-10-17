## Implementation brief — the-ticket-index-updates-incrementally-and (wave 3: Write-through)

- **Plan (canonical):** [docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md](../../docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md) on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1857 merged
- **Branch:** `feature/the-index-takes-plots-own-issue-writes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review

Wave 3 of 3, the last. Waves 1 (#1915, `updatedAt` and `foldIssueRows`) and 2 (#1938, `issueListChanged` and the incremental fold in `refreshIssueIndex`) are merged on `main`. Nothing waits on this branch.

### What to build

A row Plot writes itself reaches the board only on the next issue pass. `Tracker` has two writes, `issueOpen` (`packages/domain/src/ports/tracker.ts:299`) and `statusWrite` (`:274`). Their callers are one-shot board entries: `entry/review.ts:202`, `entry/verify.ts:600` (`issueOpen`) and `entry/issue-status.ts:95` (`statusWrite`). Each returns, and the index keeps the old row until `refreshIssueIndex` reads again, spaced by `issueIntervalMs(requests)`. A fix is right only if the board shows the changed row within seconds, without a tracker read.

1. **A successful write hands its changed row to the one writer.** After `issueOpen` answers `opened`, or `statusWrite` answers `written`, the caller passes the row (key, `status`, `statusCategory`, `updatedAt` where the tracker gave it) to the path below. A refused or failed write hands nothing.
2. **The writer folds it by key** with `foldIssueRows` (newer `updatedAt` wins; no `updatedAt` loses to one that has it and replaces an equal one). A row whose `statusCategory` is closed leaves `rows` and enters `closed.rows`.
3. **The write moves no cadence field.** `at`, `nextAt`, `backoffUntil`, `answer` and `fullReadAt` stay as held. `requests` gains 1 per write-through call, on the tracker's own connector and account, so `issueIntervalMs` and `issueGateOf` count it.
4. **`issueWriteThrough` is the named result.** The plan's `builds:` annotation promises that name.

### Decisions the plan settles — do not re-derive them

- **One writer.** `refreshIssueIndex` in `packages/fleet/src/shared/issue-refresh.ts` stays the only caller that writes `issues.json`; `one-issue-index-writer.test.ts` must pass unmodified. A board entry that opens the file and writes it is the failure this test exists to catch.
- **The write-through is not a read.** Moving `at` on a write would make the next incremental read start after changes Plot never saw. Catches: a naive fold that sets `at = now`.
- **The index holds answers, never verdicts** (CLAUDE.md, "A Decision Reads The Index"). The row is what the tracker answered to the write; the fold derives no lifecycle decision.
- **No new port write.** The port has no assign or edit; a future write joins this path. Do not add one here.
- **`v` stays 1** and `foldIssueRows` semantics do not change.

### Open question this slice decides

The plan's one unchecked question: where does the write-through caller live, given that the callers are board-side one-shot processes and the writer is fleetd's? Decide it, record the answer in the plan's Open Questions in the same PR. Constraint: the path adds no second writer of `issues.json`. Starting points, measured against the constraint rather than ranked: (a) the caller appends the row to a small spool beside `issues.json` that the next fleetd tick drains through `refreshIssueIndex` before its read, which keeps one writer and costs up to one tick, not one issue pass, so check it meets "within seconds"; (b) the caller calls a fleetd endpoint that runs the writer, which needs fleetd running and must refuse by name where it is not (absent is not false: a missing fleetd is not a landed write). A spool file declares its bound under `every-file-plot-writes-declares-its-bound`. Pick one with a test; do not ship both.

### Done when

The plan has no `## Done when` list; the specification is the Approach section's Write-through paragraph. Assertions a naive implementation passes without:

- A write-through leaves `at`, `nextAt` and `backoffUntil` byte-equal to the held index (catches treating a write as a read).
- A status write to a closed state moves the row from `rows` to `closed.rows` (catches a fold that only updates in place).
- A refused or failed write changes nothing in the index (catches writing the intended row before the answer).
- A row written through with an older `updatedAt` than the held row does not replace it (catches last-write-wins).
- With no held index, the write-through does not invent one (catches a first write creating an index that then reads as `answered` and skips the full read).
- `requests` rises by exactly 1 per write on the write's connector and account, and by 0 for another connector (catches `issueGateOf` over-counting).

Plus the repo gates: a changeset with `bumps:` last, run `./scripts/check-changeset-packages.sh`; domain TSDoc stated as fact, not history; arrow functions for every function you write. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites under `CI suites` run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the slice touches a `.sh` file, pay for growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. The PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/issue-refresh.ts`, `packages/board/src/server/entry/{review,verify,issue-status}.ts` (the call after a successful write only), the write-through path and its tests, and the plan's Open Questions line. Wave 2 is merged; do not change `issueListChanged`, `dueForFullRead` or the full-read floor. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
