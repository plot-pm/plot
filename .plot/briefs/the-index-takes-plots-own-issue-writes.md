## Implementation brief — the-ticket-index-updates-incrementally-and (wave 3: Write-through)

- **Plan (canonical):** [docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md](../../docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md) on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1857 merged
- **Branch:** `feature/the-index-takes-plots-own-issue-writes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review; CI must pass

Wave 3 of 3, last. Waves 1 (`feature/the-ticket-index-rows-carry-updated-at`, #1915 — `updatedAt` and `foldIssueRows`) and 2 (`feature/the-issue-pass-reads-since-its-last-answer`, #1938 — `issueListChanged` and the incremental fold in `refreshIssueIndex`) are merged on `main`. Nothing else waits on this branch.

### What to build

A row Plot writes itself reaches the board only on the next issue pass. `Tracker` has two writes: `issueOpen` (`packages/domain/src/ports/tracker.ts:299`) and `statusWrite` (`:274`). Their callers are one-shot board-process entries, not fleetd: `review.ts:202` and `verify.ts:600` call `issueOpen` to file a follow-up issue; `issue-status.ts:96` (`writeStatuses`) calls `statusWrite` once per owed delivered/released status, against an `issue`, despite the field name `prUrl` on the write — read `writeStatuses` before assuming otherwise, it is an issue status write. Each returns, and `issues.json` keeps the old row until `refreshIssueIndex` reads again, which under wave 2's incremental cadence can now be minutes away rather than the next whole read. A fix is right only if the board shows the changed row within seconds, without forcing a tracker read.

1. **A successful write hands its changed row to the one writer.** After `issueOpen` answers `opened`, or `statusWrite` answers `written`, the caller passes the row (key, `status`, `statusCategory`, `updatedAt` where known) into the path step 2 builds. A refused or failed write hands nothing — only a confirmed write is a fact worth recording.
2. **The writer folds it by key.** Read the held index; where it is absent, of another `source`/`connector`, or `answer` is not `'answered'`, there is nothing to fold into — write nothing and let the next fleetd pass catch it on its full read (the same `sameHeld` guard `refreshIssueIndex` already uses at `issue-refresh.ts:395`). Where it matches, fold the one row in with `foldIssueRows` (wave 1's newer-`updatedAt` rule — do not write a second comparison). A row whose `statusCategory` is closed leaves `rows` and enters `closed.rows`; `foldChangedIssueRows` already makes exactly that open/closed split for a batch of changed rows, so call it with a one-element array rather than re-deriving the split by hand.
3. **The write moves no cadence field.** `at`, `nextAt`, `backoffUntil`, `answer` and `fullReadAt` stay byte-equal to held — it is not a read of the tracker, so it must not look like one. `requests` gains exactly 1 per write-through call, on the tracker's own connector and account, so `issueIntervalMs` and `issueGateOf` count it; this is spend already paid for by the `issueOpen`/`statusWrite` call itself, recorded locally, not a second tracker call.
4. **`issueWriteThrough` is the named result.** The plan's `builds:` annotation on the slice line promises that name for whatever you export.

### Decisions the plan settles — do not re-derive them

- **One writer.** `refreshIssueIndex` in `packages/fleet/src/shared/issue-refresh.ts` stays the only caller that writes `issues.json`; `one-issue-index-writer.test.ts` must pass unmodified, in particular its assertion that **zero** board source writes the store or hands it to a world (`one-issue-index-writer.test.ts:126`). That test only greps for `.write(`/`issueStore` handoffs in board files — it says nothing about whether a board entry may *import and call* a function `issue-refresh.ts` exports that performs the write internally. Passing the grep is necessary, not sufficient: see the open question below for what else decides the shape.
- **The write-through is not a read.** Moving `at` on a write would make the next incremental read start after changes Plot never saw, and would make a write look like a confirmed tracker read it is not. Catches: a naive fold that sets `at = now`.
- **The index holds answers, never verdicts** (CLAUDE.md, "A Decision Reads The Index"). The row is what the tracker answered to the write Plot made; the fold derives no lifecycle decision from it.
- **No new port write and no new tracker read.** The port has no assign or edit; a future write joins this path rather than adding one. The write-through must not call `issueListChanged` or any other read to "confirm" the row — `issueOpen`/`statusWrite` already reached the tracker.
- **`v` stays 1** and `foldIssueRows`/`foldChangedIssueRows` semantics do not change; reuse them, don't fork them.

### Open question this slice decides, not defers

The plan's one unchecked question: where does the write-through caller live, given the callers are board-side one-shot processes and the one writer is fleetd's `refreshIssueIndex`? The grep-based test constrains the *text* of the write to stay inside `fleet/src/shared/issue-refresh.ts`, but that alone does not settle whether a board process can safely call into it synchronously — the board has no live `IssueState`/cadence context, and a board-triggered write racing a concurrent fleetd pass's read-modify-write is a real concern a grep cannot catch. Decide it, record the answer in the plan's Open Questions in the same PR, with a test proving the chosen shape avoids the race rather than merely passing the existing grep. Starting points, measured against "one writer, no missed concurrent write" rather than ranked:
  (a) the board caller appends the row to a small spool file beside `issues.json` that the next fleetd tick drains through `refreshIssueIndex` before its read — one writer stays literal, cost is up to one tick rather than one full issue-pass interval; a spool file declares its bound per `every-file-plot-writes-declares-its-bound`.
  (b) the board caller calls a fleetd-exposed endpoint that runs the fold-and-write itself — needs fleetd reachable from the board process and must refuse by name, not silently, where it is not (absent is not false: a missing fleetd is not a landed write).
  (c) an exported fold-and-write function in `issue-refresh.ts` that both processes import directly — passes the grep, but only safe if you can show the board and fleetd never race on the same file (e.g. an atomic read-modify-write via the store's existing rename-based write at `issue-index-file.ts`, and no window where a concurrent fleetd pass's write is dropped).
  Pick one with a test proving the race property, not just the happy path; do not ship more than one path.

### Done when

The plan has no `## Done when` list; the specification is the Approach section's Write-through paragraph. Assertions a naive implementation passes without:

- A write-through leaves `at`, `nextAt` and `backoffUntil` byte-equal to the held index (catches treating a write as a read).
- A write-through call against a held index of a *different* source or connector writes nothing and changes no file (catches cross-tracker contamination after a reconfiguration).
- A write-through call against no held index, or one with `answer` other than `'answered'`, writes nothing (catches synthesizing a fresh index from one row).
- A status write to a closed state moves the row from `rows` to `closed.rows`, reusing the same split `foldChangedIssueRows` makes for a batch (catches a fold that only ever inserts into `rows`).
- A row written through with an older, or absent, `updatedAt` than the held row does not replace it (catches last-write-wins and catches skipping wave 1's comparison).
- `requests` rises by exactly 1 per write on the write's own connector and account, and by 0 for another connector (catches `issueGateOf` over- or under-counting).
- Whatever shape the open question above settles on has a test proving a concurrent fleetd pass does not silently drop the write-through row, or vice versa — not just a happy-path "one write lands" test.
- `one-issue-index-writer.test.ts` passes unmodified, including its board-source assertion (`:126`) — the test most likely to fail first if the write-through is built in the wrong file.

Plus the repo gates: a changeset (`plot` package; description first, `bumps:` block last — see `.changeset/the-issue-pass-reads-since-its-last-answer.md` for the sibling slice's shape); run `./scripts/check-changeset-packages.sh`. Domain TSDoc stated as fact, not history; arrow functions for every function you write (CLAUDE.md, "The Domain Package"). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites under `CI suites` run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base — if this slice touches a `.sh` file, pay for growth in the same change. The PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

You own: `packages/fleet/src/shared/issue-refresh.ts` (the write-through path), `packages/board/src/server/entry/review.ts`, `verify.ts`, `issue-status.ts` (the call after a successful write only), the write-through path and its tests, and the plan's Open Questions line. You do not touch `packages/domain/src/rules/fold-issue-rows.ts`'s merged semantics — reuse `foldIssueRows`/`foldChangedIssueRows` as they stand; if the fold genuinely cannot express what write-through needs, report that rather than changing wave 1's or wave 2's merged behaviour. Wave 2 is merged; do not change `issueListChanged`, `dueForFullRead` or the full-read floor. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
