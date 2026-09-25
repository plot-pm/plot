## Implementation brief — a-supervisor-that-stopped-ticking-is-not-running (wave 1: The status says when it last ticked)

- **Plan (canonical):** `docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-status-says-when-it-last-ticked` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This slice builds on wave 2, which was built first.** `bug/the-board-shows-the-tick-age` is open as PR #976 (checked 2026-09-25: open, CI pending). It adds the `tick_age_seconds()` helper to `plot-fleetctl.sh` that this slice calls. Start only after #976 is merged on `origin/main`: run `git grep -n tick_age_seconds origin/main -- skills/plot/scripts/plot-fleetctl.sh` first. If it returns nothing, #976 has not landed. Write `PLOT-BLOCKED.md` that names #976, and stop. Do not copy the helper into this branch, and do not cut the branch from `origin/bug/the-board-shows-the-tick-age`.

### What to build

On 2026-09-23, `plot-fleetctl.sh --status` printed `supervisor: running (pid 3260)` while `.plot/logs/registryd.log` had not been written for 25 hours. The last tick recorded `cost=2478705ms` (41 minutes, against a normal 13–49 s). The running arm checks two facts: the label is loaded, and a pid exists. It never reads the log.

After #976, a machine can see the age: the running `summary:` line carries `tick_age=<N>`. A person still cannot. The human-readable lines of the running arm show only `supervisor: running (pid …)`. The plan's first `Done when` item is still open.

Add this line to the `running` arm (on main at dispatch: `skills/plot/scripts/plot-fleetctl.sh:355-357`), directly after `supervisor: running (pid $sup_pid) — $LABEL`:

```
  last tick: <N>s ago (evidence, not the verdict — a busy tick writes at most every 60s)
```

The text must be byte-identical to the line in the `LOADED, NOT RUNNING` arm. Take `<N>` from `tick_age_seconds`, and print nothing when it returns empty. The loaded-not-running arm after #976 already shows the pattern:

```sh
tick_age=$(tick_age_seconds)
if [ -n "$tick_age" ]; then
  echo "  last tick: ${tick_age}s ago (evidence, not the verdict — a busy tick writes at most every 60s)"
fi
```

Expect a diff of about five lines of shell, plus tests and a changeset. The plan is canonical. This brief is orientation.

### Decisions already settled — do not re-derive them

**Reuse `tick_age_seconds`, and never call `stat` in this arm.** #976 measured the reason on 2026-09-25. On GNU, `stat -f` means `--file-system` and exits 0, so a BSD-first `stat -f %m … || stat -c %Y …` never reaches its fallback on Linux. `touched` then holds a filesystem report, the arithmetic fails, and the line disappears on CI while it passes on macOS. The helper asks GNU first (`-c` is unambiguous because BSD rejects it). A second copy of the `stat` call reintroduces the bug that commit `5dc8996c7` fixed.

**The line is evidence and never a verdict.** Print no threshold, no warning word and no `STALE`. A healthy supervisor between ticks has not written for up to 60 s, and this repo has measured 49 s ticks. A threshold that calls 90 s dead is wrong on a busy estate. A threshold generous enough to be safe would not catch 25 hours sooner than a person who reads the number. The staleness judgement belongs to `packages/domain/src/rules/supervisor-reading.ts`, which #976 owns.

**`summary:` stays exactly as #976 leaves it.** The value remains `supervisor=up install=running tick_age=<N>` for a running supervisor with a log, and without `tick_age=` when there is no log. The exit code stays 0. The state word answers *is a process behind the label*, and that was true. If liveness folds into it, one word answers two questions, and the three-state split removed exactly that defect. This slice adds a line for people and changes no field that a machine reads.

**No heartbeat file.** A heartbeat file duplicates what the log already holds. `packages/board/src/server/supervisor.ts:49` rejects a memo that outlives the tick, because the daemon then holds state. The log's mtime costs nothing and needs no contract.

**No restart, no repair.** `--status` starts nothing. That property is what lets it report an absence at all.

**The first draft's causal story is refuted. Do not rebuild it.** The idle agents were free and had no claimable work: 547 ticks read `idle=3`, and `no-free-agent=0` held on 986 of 987 ticks. Keep comments and the changeset to the measured fact: `running` over a 25-hour-old log.

Rules carried over from related work:

- **Absent is not zero.** No log, or an unreadable mtime, prints no `last tick:` line. It never prints `0s ago`. The helper returns empty for both cases, so test `-n` and do not add a default.
- The exit code is the contract. Prose is not.

### Done when

The plan's `### Done when` list is the specification. #976 already covers two items (`summary:` keeps `supervisor=up`, and a missing log yields no field). This slice closes the other two for the human line. These assertions exist because a naive implementation passes without them:

- **A stale log in the running arm prints `last tick:` with a large age.** Backdate the log with `fs.utimesSync` by about 25 hours and assert that the number in the line is `>= 90000`. A fresh-log test passes even when the value is wrong.
- **The same stale run still matches `^summary:.*supervisor=up install=running tick_age=\d+$` and exits 0.** This catches a fix that downgrades the state because the tick is old.
- **No log prints no `last tick:` line in the running arm.** This catches `0s ago`.
- **The running arm's `last tick:` line is byte-identical to the loaded-not-running arm's line, apart from the number.** Assert the caveat text in both. This catches two arms that drift in wording.

Put the tests in `test/reconcile/fleetctl.test.mjs`, beside #976's `--status carries the tick age on the running summary line` case. Extend that case or add one next to it. Reuse its seams: `sandbox`, `fakeHome(box, { unit: true, label })`, `stubPlatform(box, { loaded: true })` (emits pid 4242), `run`, and a log at `<root>/.plot/logs/registryd.log`. These cases run on Linux CI through the `PATH` seam, so a macOS-only pass does not count.

Plus the repo gates:

- `nvm use` (Node 24), and `corepack pnpm` if homebrew pnpm crashes
- `pnpm test`
- `pnpm run test:contracts` (includes `fleetctl.test.mjs`)
- no board artifact rebuild, because this slice touches no `packages/` source
- **not** `pnpm run test:e2e`, which is CI's gate
- a changeset: `'plot': patch`, the description first, then a block with `plan: docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md` and `bumps: skills: plot-fleet: patch` last

`skills/plot-fleet/SKILL.md:39` describes `--status` in one table row. Add a clause only if the row stops being true. It says "is the supervisor alive", and the new line is evidence for that question, so no change is likely.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do **not** use `gh pr create`.
- When the PR exists, annotate this slice's wave heading in the plan on `main`: `(Branch: bug/the-status-says-when-it-last-ticked, PR: #N)`. That is the form wave 2's heading already uses. Make the edit from a detached scratch worktree on `origin/main`, not in the shared main checkout.
- No project board is configured, so set no board status.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh`: the `--status` running arm only
- `test/reconcile/fleetctl.test.mjs`: new or extended `--status` running-arm cases
- one `.changeset/*.md`

This branch does not touch `tick_age_seconds`, the `summary:` line, `packages/board/**` or `packages/domain/**`. #976 owns them.

In flight, checked against every `origin/*` ref on 2026-09-25:

- `bug/the-board-shows-the-tick-age` (#976, open) changes the same two files. This slice starts only after #976 merges, so the collision is resolved by that ordering and not at merge time.
- `changeset-release/main` also differs in these paths. It is the release PR and owns version lines, not this code.
- `bug/the-unload-is-verified-to-a-bound` (the `--stop` arm) merged as #977 and is on `main`.

Out of scope, named in the plan: `--once` printing the previous tick's age (an open question for a later caller), the cause of the 41-minute tick, and the agent bound.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
