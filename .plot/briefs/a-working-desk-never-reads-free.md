## Implementation brief — no-controller-resumes-a-claimed-slice (wave 1: A working desk never reads free)

- **Plan (canonical):** `docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `bug/a-working-desk-never-reads-free` (base: `main`) — not claimed; the supervisor hands it to a free agent
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave comes first. `feature/a-time-out-writes-its-ending` and `feature/a-timed-out-slice-gets-a-fresh-agent` wait on it: they are the fallback for a time-out that this wave does not prevent. Do not start their work here.

### What to build

A loop whose agent works a slice must never read itself free, and its free-wait bound must never end a working agent (#1409, #1420). Measured 2026-10-09 on `feature/the-fleet-package-exists` at `.worktrees/free-1c9c57a0`: the desk held commit `2e7c4fa07` (the claim), then `dec27bb26` and 50 uncommitted files, and the `WorkerMonitor` file names the branch. The loop's own log (`.plot-worker.log`, 8 lines) holds only `free on ? — nothing handed over yet` and one restart line `keeping the free wait from 2026-10-09T00:17:17.000Z`. The `AgentMonitor` records `"branch":""`. The process that exited 124 is pid 42407, the restarted loop, at 08:49:30Z.

So the loop read `assignedBranch === ''` for the whole span while the world named a branch. `worker-loop.ts:1610` ends the loop with 124 only on `assignedBranch === ''` and `waitedSeconds >= boundSeconds`, which is the plan's answered Open Question. Your job is to find **why the loop read empty**, prove it with a failing test, and fix that cause.

**The root cause is not yet measured. Do not assume it.** What is measured:

- `readPass` (`packages/fleet/src/server/entry/worker-loop.ts:~723`) takes `assignedBranch` from `readManifestFields(manifestFile).branch`, and nothing else.
- The hand-over already exists. `performerShell.assignSlice` (`packages/domain/src/adapters/performer/performer-shell.ts:50`) writes `manifest.branch` and `manifest.slug`, and `continueOnDesk` writes it through `assignEmptyManifestBranch` (`packages/fleet/src/shared/manifest-stamp.ts:357`). So the plan title's *"the hand-over sets the loop's assigned branch"* is not a missing write. Do not rebuild the hand-over.
- `writeHop` does not clear `branch` (`worker-loop.ts:543`). Do not chase it.
- This desk's loop log shows `slug` as `?`, and its manifest is gone now (the exit trap removes it), so the manifest cannot be re-read.

Candidates to separate by test, in the order the evidence favours them. Name the one you prove in the commit message.

1. **A lost update.** `assignSlice` writes the manifest in place with `writeFileSync`. The loop's writers (`stampManifestLoopJs` at startup, `raiseSliceRuns`, `writeHop`) read the whole object, then `rename` a tmp file over it. A hand-over landing between a writer's read and its rename is overwritten with `branch: ''`. The restart at 2026-10-09 re-ran `stampManifestLoopJs` at startup. A test that interleaves the two writes and asserts the branch survives fails today if this is the cause.
2. **A second process at the desk.** The monitor files name the branch, so the process that started them knew it (`PLOT_BRANCH`), while the loop read its manifest as empty. A dispatch or a continue that starts a worker beside a live free loop gives two processes and two manifests for one desk. `deskManifestFor` (`manifest-stamp.ts`) matches a manifest to a desk by `worktree`, and `continueTarget` refuses `several`. Check whether any start path skips that check for a desk whose free loop is alive.
3. **`clearAssignment` runs while the agent works.** `agents-fs.ts:391` reads the manifest, sets `branch = ''` and renames it back; `loop-writes.ts:196` is its only production caller. It is a writer of `branch: ''` by design, so find which loop write reaches it and when. The same read-then-rename shape as candidate 1 applies: a clear based on a stale read also drops a hand-over that landed in between.
4. **A restart that loses the manifest path.** `checkRestart` re-execs with `deps.env`, which should hold `PLOT_MANIFEST_FILE` (`worker-loop.ts:2270`). Confirm it does, in a test that restarts and then reads the manifest.

### Decisions the plan settles — do not re-derive them

**The free-wait clock is not the defect.** `PLOT_WAIT_STARTED` carries the wait's start over a restart on purpose, so a free agent does not extend its wait by restarting. Resetting it on restart would hide the cause and leave the loop reading empty. The wait bound stays at `Worker bound` (28800 s), unchanged — the plan's first open question keeps it.

**A time-out is not handled here.** The `bound` ending, the `endingAction` rows and the fresh agent are waves 2 and 3. This wave removes one cause of exit 124. A loop that times out for any other reason still needs them.

**Out of scope, report only:** the loop in #1409 ran under Node 26 against the pinned Node 24, and #1408 has two LOW review findings. Do not fix them here. Do not edit `packages/domain/src/workflows/agent-loop.ts` or `packages/domain/src/rules/ending-action.ts`; wave 2 and 3 own them.

**Absent is not false.** An unreadable manifest and a manifest with `branch: ''` are different readings: `readManifestFields` returns `EMPTY_MANIFEST` for both today (`worker-loop.ts:489-511`). Whatever you change, a loop that cannot read its manifest must not count that as a free wait toward the bound. If you find that one reading is the cause, give the two their own answers and say so in the TSDoc.

**Duplication is held by tests, not authority.** `plot-agent-manifest.sh` and `manifest-stamp.ts` both write manifests. If your fix touches one writer, run the other's tests and say in the commit message whether the same race exists there. The shell adds lines only if you remove an equal number elsewhere.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; the reasoning goes in the commit message. A function you write or rewrite elsewhere is an arrow too.
- A controller calls the domain and never spawns. A write to a manifest stays in the adapter or the shared module that owns it.
- Read the exit code, not the emptiness: a loop's `124` is a measurement of the wait bound, not of the agent.

### Done when

The plan's `## Done when` list has **no line for this wave**. It names only waves 2 and 3. Add the wave's own line to the plan in this PR, as an amendment under `## Done when`, naming the cause you proved.

The assertions that exist because a naive implementation would pass without them:

- **The reproduction fails on `origin/main` first.** Run it against an unmodified checkout and paste the failing output in the PR. A test that passes before the fix proves nothing. If you cannot reproduce the 2026-10-09 case, say so and stop with a report — do not ship a fix for a cause you did not see.
- **A loop whose manifest names a branch does not end on the free-wait bound.** Drive `agentLoop` with `assignedBranch` non-empty and `waitedSeconds >= boundSeconds`, and assert no `exit 124`. This catches a fix that only changes the log line.
- **The hand-over survives a concurrent loop write** (candidate 1), or **one desk never holds two live manifests** (candidate 2), or **a restart keeps the manifest path** (candidate 3) — whichever you proved. A test for a candidate you did not prove is not a substitute.
- **The manifest holds the branch for the whole run of the agent, not only at the first pass.** This catches a fix that sets the branch once and lets a later `clearAssignment` blank it.
- **A loop with no manifest still reads free** (`EMPTY_MANIFEST`). This catches a fix that treats `''` as an error.
- **The free loop still ends.** A loop with no assignment and `waitedSeconds >= boundSeconds` still ends 124. This catches a fix that disables the bound.

Plus: a changeset for `plot`, level `patch`, with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). The PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally, then restore the generated paths. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the fix touches a `.sh` file, pay for any growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name #1409 and #1420 in the PR body.

### Scope guard

This branch owns `packages/fleet/src/server/entry/worker-loop.ts`, `packages/fleet/src/shared/manifest-stamp.ts`, `packages/domain/src/adapters/performer/performer-shell.ts`, `packages/domain/src/adapters/agents/agents-fs.ts`, `packages/fleet/src/server/entry/loop-writes.ts`, their tests, and the amended `## Done when` of the plan. Touch `skills/plot/scripts/plot-dispatch.sh` or `plot-agent-manifest.sh` only if a proven cause lives there.

Verified at dispatch (2026-10-09, `git diff origin/main...origin/<branch>` over `worker-loop`, `manifest-stamp`, `performer-shell`, `registryd-main`, `plot-dispatch`, `agent-loop`, `plot-agent-manifest`): no branch in flight touches these files. In flight: `feature/the-supervisor-is-plot-fleetd`, `feature/the-brief-ask-names-its-branch`, `feature/a-merged-pending-check-is-asked-again`, `feature/the-reaper-becomes-a-command`. The first one is in the same package, so rebase before the PR if it merges first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
