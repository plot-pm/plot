## Implementation brief — an-unanswered-question-escalates (wave 1: A question is listed as waiting on you)

- **Plan (canonical):** `docs/plans/2026-10-05-an-unanswered-question-escalates.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `feature/a-question-is-listed-as-waiting-on-you` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

Slice 2 (`feature/a-question-notifies-as-it-ages`) waits on this slice: it reads the marker's age through the reading built here. On 2026-10-05 the open PRs are #1282 (`infra/the-loop-writes-through-ports`) and the release PR #1278; neither touches the files this slice owns.

### What to build

The board half of the plan: a desk that holds a `PLOT-BLOCKED*` marker is listed under WAITING ON YOU with the question and its age, whatever the agent's loop is doing.

The failure, measured 2026-10-05: the agent on slice 2 of `the-worker-loop-runs-in-js` wrote a question at 13:36 and nobody answered it until 18:20. The board showed it in one place, the agent row under WORKING, reading "waiting on you · idle 4h". A loop that ended on its wait bound read "worker crashed — exited 124" (#1250).

The parts:

- **A question reading per desk.** The marker's first line (bounded by `QUESTION_MAX`) and its modification time. The first line already comes from `markerIn` in `packages/board/src/server/worker-question.ts`; the modification time is new. Read both from the one `stat`, so the line and the age describe the same file.
- **`question: { firstLine, askedAt } | null` on the fleet row**, in `packages/board/src/contract/schema.ts` (`BranchSchema`), with `askedAt` as an ISO-8601 string. `null` means no marker. A marker that exists but whose content will not read is `{ firstLine: '', askedAt }`, a stated unknown, never `null`.
- **The placement rule.** In `classify` (`packages/board/src/server/fleet.ts`, the `worker === 'waiting'` arm near `:5238`), a row with a question goes to `waiting-on-you` before the worker-state arms. For each worker state (`running`, `waiting`, `failed`, `finished`) the note reads "waiting on you: <first line>", with the age. For `failed`, the exit code stays in the note as evidence.
- **The read must widen.** `workerQuestions` reads only the branches that `waitingWorktrees` returns, which keeps `b.worker === 'waiting'` (`worker-question.ts:144`). A live loop with a marker is `running`, and the reading skips it. Read every branch with a local worktree that the scan reports a marker for. Keep the early return that makes a fleet with no questions spawn nothing.

The plan is canonical. This is orientation.

### Decisions the plan settles — do not re-derive them

**The marker is the reading, not the loop's process state.** A live free loop, a dead loop and an ended loop with the same marker give the same row. A rule that reads `worker === 'waiting'` first is the defect: `supervise` (`rules/supervision.ts:269`) answers `leave` for any live loop before it reads anything else, and `registryd.log` counted `person=0` on all 10,521 ticks on 2026-10-05. Do not branch on worker state to decide whether a question exists. Branch on it only to decide what else the note says.

**The question's age is the marker file's modification time.** Not the worker's last commit, not the desk's idle time, not the log. Commit idle time says nothing about liveness (memory: *Commit idle time is not liveness*), and a worker that keeps committing beside its question would reset any age taken from it. A new marker file has a new modification time and starts a new age.

**The `PLOT-BLOCKED*` scan is by file name at the desk root, and it stays so.** `markerIn` documents why: a content search matched the marker token in a brief and surfaced a documentation example as a question (#342). Use the same directory listing and prefix match. Do not add a `git grep`.

**An unreadable marker is a stated unknown.** The scan found the file, so a failed read renders "reason unavailable, look in its worktree" and stays in WAITING ON YOU. It is never `null` and never a guessed question.

**The decision is a domain property.** CLAUDE.md › The Domain Package and *Every rendered state is a domain property*: the rule that sends a row with a question to WAITING ON YOU, and the wording of its note, are asserted in a unit test, not by rendering. Put the pure part (`question` and worker state in, group and note out) where a test needs no board server and no filesystem. `classify` is a pure function called for every branch on every poll; it must not read a file. The read belongs to the scan's timer, as `workerQuestions` already is (`fleet.ts:3676`).

**New parameters go last.** `classify` takes its inputs positionally, and `workerQuestion` carries a comment that inserting a parameter mid-list shifts every spread-tuple caller in the suite silently past the compiler. Add yours after the last one.

**What this slice does not do.** No notification, no `Question escalation` key, no `Notify command`, no `escalations.tsv`, no change to the registry tick. All of it is slice 2. No release of a slice whose question stays open: that needs a controller that releases a claim (#1276).

**Rules carried over unchanged.** Absent is not false: a `question` that could not be read is `unknown`, and `null` is only for a desk the scan found no marker on. Read the exit code, not the emptiness. A function you write is an arrow (`export const f = (…) => …`), in the board too; the unit is the function, and every function in a new file is yours. Do not rewrite `markerIn` or its neighbours into arrows to touch them.

### Done when

The plan's slice 1 line is the specification: the desk's marker and its age as a reading, the `question` field in the fleet payload, and the placement rule for every worker state.

Assertions that exist because a naive implementation passes without them:

- **A `running` row with a marker lands in WAITING ON YOU.** This is the 2026-10-05 case. A rule that only widens the `waiting` arm passes the other three states and misses this one.
- **A `failed` row with a marker keeps its exit code** and lands in WAITING ON YOU, not in the "worker crashed" note alone. The fixture needs an exit code that is not 0 (use 124, the wait bound), so the assertion cannot pass on an empty string.
- **A row with no marker is unchanged for every worker state.** Assert the group and the note of each of the four states against the values on `main`, so a placement rule that sends every row to WAITING ON YOU fails.
- **The age comes from the file, not the clock of the test.** Set the marker's modification time with `utimes` to a fixed instant and assert `askedAt` equals it. Replacing the file gives a later `askedAt`.
- **A fleet with no marker spawns and reads nothing.** Keep the existing test of the early return, and extend it to a `running` branch with a local worktree and no marker.
- **An unreadable marker gives `{ firstLine: '', askedAt }`**, not `null`. Make the marker a directory or remove its read permission, then assert the row is in WAITING ON YOU with "reason unavailable".
- **One browser test proves the row renders in WAITING ON YOU** with the question and its age. It is the only browser test; every other assertion is a unit test.

Plus the repo gates. Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints: the tests that name a changed file, `vitest related` and the typecheck of the board and the domain, the gate tests and the `scripts/check-*.sh` gates. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`. Never run board tests while the operator's board is open on this machine.

A change to `schema.ts` changes the contract: grep the board app for every consumer of `BranchSchema`, and run `pnpm run typecheck`, which does not cover the domain package (`pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`). Do not commit a rebuilt `board-server.mjs`; `scripts/check-no-bundle-diff.sh` refuses a PR that carries one, and `main` builds its own.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice adds no `.sh` file and changes none. If a change makes you edit one, remove at least as many lines elsewhere in the same change; the gate has no override.

Add a changeset with package `@plot-pm/board`, description first, and `plan: docs/plans/2026-10-05-an-unanswered-question-escalates.md` in the trailing comment block. Copy the format from `.changeset/` and from `git log -p -- .changeset`. `./scripts/check-changeset-packages.sh` refuses a description under 20 characters and a `bumps:` block written first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `feature/a-question-is-listed-as-waiting-on-you` line under `## Slices` in the plan, on `main`.
- The PR body states the issue it addresses: #1283, and the board half of #1250.

### Scope guard

This branch owns:
- `packages/board/src/server/worker-question.ts` and its tests
- the `worker === 'waiting'` arm and its neighbours in `classify`, and the scan's `workerQuestions` call, in `packages/board/src/server/fleet.ts`
- the `question` field in `packages/board/src/contract/schema.ts`, and the component that renders a WAITING ON YOU row's note, in `packages/board/src/app/`
- a new pure rule and its test, in `packages/domain/src/rules/` if the placement is extracted
- the changeset

It does not touch:
- `packages/domain/src/entry/**`, `rules/supervision.ts` and `workflows/supervise.ts`: the registry tick and `supervise` are slice 2's concern, and the plan reads them without changing `supervise`
- `packages/domain/src/ports/notifier.ts` and any notification code: slice 2
- `skills/plot/scripts/**` and `plot-worker-state.sh`: the scan's `waiting` state stays as it is; this slice reads the marker beside it
- the files `infra/the-loop-writes-through-ports` (#1282) owns: `entry/loop-writes.ts`, the `desk` and `boundedRun` ports, `refs.remoteTip`

If you find something the plan did not anticipate, report it with `PLOT-BLOCKED` rather than improvising outside scope.
