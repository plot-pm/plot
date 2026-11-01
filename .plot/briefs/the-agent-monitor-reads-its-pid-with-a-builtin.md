## Implementation brief — the-agent-reporter-starts-a-sleep (slice 2: AgentMonitor read)

- **Plan (canonical):** docs/plans/2026-11-01-the-agent-reporter-starts-a-sleep.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3025 merged
- **Branch:** `bug/the-agent-monitor-reads-its-pid-with-a-builtin` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status, per repo convention (Review: pr)

Slice 1 (`bug/the-agent-reporter-waits-without-a-poll`, → #3027) shares no file with this slice. Neither waits on the other; either can merge first.

### What to build

Every agent gets an AgentMonitor (`plot-agent-monitor.sh:565`), and its per-second check in `plot_monitor_subject` (`skills/plot/scripts/plot-monitor-subject.sh:131`) reads the pid file with `pid=$(cat "$pid_file" 2>/dev/null | tr -d ' \n')` — one `cat` and one `tr` start per call — and resolves the pid file's directory with `$(dirname "$pid_file")`, used twice in the same function (the half-written-pid arm and the no-pid-file arm). Measured by the seams juror with `PATH` shims against a live pid for 5 s: 5 `sleep`, 5 `cat`, 5 `tr` — three starts per second per agent, independent of load, because `plot_monitor_wait`'s nap is fixed at 1 s. With 6 agents that is 18 process starts per second from this loop alone; a continued agent also runs slice 1's reporter loop. Replace the `cat | tr` pipeline with the shell's own `read` builtin, and `dirname` with parameter expansion, so the same 1 s cadence costs one process start instead of three. The plan is canonical; this brief orients.

### Settled decisions — do not re-derive

- **The nap stays at 1 s.** No builtin wait with a bound exists in `dash` or bash 3.2 (`read -t` is absent from `dash`; bash 3.2 has no `sleep` builtin) — the same finding slice 1 relied on. One start per second per agent is the floor this slice reaches; a wake-up from the agent's end is an explicit follow-up in the plan's Notes, not in scope here.
- **Read the pid with `read -r pid < "$pid_file"`, not a subshell.** `pid` is already declared in the function's `local pid_file="${1:-}" pid` line, so a failed read (missing file, permission error) leaves it empty and the existing `'' | *[!0-9]*)` case arm answers `starting` or `gone` exactly as it does today for a half-written pid. Do not add a new empty check — the existing case arm already covers it.
- **Replace `$(dirname "$pid_file")` with `${pid_file%/*}` at both call sites** in `plot_monitor_subject` (the no-pid-file directory check and the half-written-pid exit-file check). `${pid_file%/*}` is a pure shell builtin with no process start; `dirname` would start one process per call otherwise, defeating the point of dropping `cat`/`tr`. A `pid_file` with no `/` (never produced by this codebase — it is always a path under a worktree) would make `${pid_file%/*}` return the whole string rather than `dirname`'s `.`; this is an existing-behavior risk accepted by the plan, not something to guard against newly.
- **`plot_watched_desk` is untouched.** The reporter (slice 1) sources it; `packages/domain/corpus/desk-manifest.corpus.test.ts` holds it to `watchedDesk`. This slice touches only `plot_monitor_subject`.
- **No shipped-shell growth.** `scripts/check-shell-lines.sh pr` reads zero or fewer added lines for this slice's diff — do not join lines with `;` to dodge it; the gate counts commands, not lines, and there is no joining needed here since this is a net-shrink (two external starts removed per call, no new lines added).
- **Carried rule:** read exit codes and explicit case arms, never emptiness alone, for the half-written-pid window — this function's existing pattern, kept as-is.

### Done when

The plan's `## Done when` table is the specification for slice 2's four rows, in `test/reconcile/agentmonitor.test.mjs`:

- **The AgentMonitor starts one process per second.** Shim log of `sleep`, `cat`, `tr`, `dirname` against a live pid for 5 s: expect 5 `sleep` lines and zero `cat`, `tr` or `dirname` lines (on `origin/main` today: 5 of each, three starts per second). This is the row that proves the fix — a shim for `sleep` alone would pass the unfixed loop too.
- **A pid file with no trailing newline reads correctly.** `printf "%s" 123` (no `\n`) into the pid file, against a live and then a dead pid: expect `alive` then `gone`. Catches a `read` that depends on IFS/newline handling differently from `cat | tr -d ' \n'`.
- **A half-written or missing pid file keeps its existing answers.** Empty file with desk present → `starting`; desk directory removed → `gone`; exit file present beside an empty pid file → `gone`. Covered in `agentmonitor.test.mjs` and `moved-worker-pid.test.mjs`. This is the regression guard for the case-arm logic this slice must not disturb.
- **The shipped shell does not grow.** `scripts/check-shell-lines.sh pr` passes on this slice's diff with no joined lines.

**Mutation check:** restore `cat | tr` in place of the `read`, and the start-count row must fail (showing `cat`/`tr` lines again). Run it, and commit before mutating.

Plus: a changeset for package `plot` (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the `CI suites`, and a failure there returns as a correction. Do not run `test:e2e` locally. Use Node 26.13.0 (`env -u PLOT_REPO_ROOT -u PLOT_UNATTENDED`).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-monitor-subject.sh` and `test/reconcile/agentmonitor.test.mjs`, plus one changeset. The in-flight sibling, `bug/the-agent-reporter-waits-without-a-poll` (→ #3027), owns `packages/fleet/src/shared/continuation.ts`, `packages/fleet/test/unit/continuation.test.ts` and `.gitignore`. Do not touch those. The board's request path (#3017) and `host_slot_take` are separate plans.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
