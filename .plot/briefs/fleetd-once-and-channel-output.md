## Implementation brief — fleetd-tick-stop-and-escalation-defects (wave 3: output and channel)

- **Plan (canonical):** `docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/fleetd-once-and-channel-output` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub, gated by the `plot-review` app

Third wave of six. Nothing in this plan waits on it, and it waits on nothing: it shares `registryd-main.ts` with waves 1 and 2 but touches different functions (`writersFor`, the channel-bind/retry region, `fleet-clock.ts`'s `warn` calls) — coordinate on conflicts, not on sequencing.

### What to build

Seven defects, all in `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/fleet-clock.ts` and `test/reconcile/log-rotation.test.mjs`, closing the still-open bullets of #1539 and #1526 (both closed as issues, folded into tracking issue #1846, which restates both as fully open — "(OPEN): all three bullets" / "(OPEN): all four bullets"):

**#1539, bullet 1 — `--once` can cut its own output on a macOS pipe.** `writersFor` (`registryd-main.ts:2593-2605`) returns, for `--once`, `(text) => void stdio.stdout.write(text)` — the `void` discards `write`'s return value, so a caller never learns the OS buffer is full. `startDaemon(...).then((code) => process.exit(code))` at `:2624` then exits as soon as the promise resolves, with no wait for any pending write to drain. On a pipe (`fleetd --once | wc -c`), a write that returns `false` (backpressure) can still be in flight when `process.exit` runs — write it, then set `process.exitCode = code` and let the event loop drain naturally instead of exiting from inside the `.then`.

**#1539, bullet 2 — the `--once` doc names one failure line, not both.** `skills/plot-fleet/SKILL.md` documents the `held=`/`incomplete` status line but not the `tick failed` stderr line a throwing tick also writes (`fleet-clock.ts:90`, `` warn(`plot-fleetd: ${name} failed: ...`) ``, reached via the loop's own catch, separately from an `incomplete` status). Broaden the doc to name both outcomes a reader of `--once` output can see.

**#1539, bullet 3 — a duplicated test assertion.** `test/reconcile/log-rotation.test.mjs:269` and `:274` both assert `assert.match(registryd, /= processLog,/, ...)` — verbatim duplicates, differing only in their message string. Delete the copy at `:274`.

**#1526, bullet 1 — a clock warning with no trailing newline.** `fleet-clock.ts`'s `warn()` call sites (e.g. `:90`, `:149`, `:175`) build template strings with no `\n`, and nothing downstream adds one — `fleetd.err` runs the next line on. Add the newline at the call site, matching the pattern already used elsewhere in this file for lines meant to be read one-per-line.

**#1526, bullet 2 — the stop path doesn't wait for an in-flight bind retry.** The stop branch (`registryd-main.ts:2219-2221`) runs `scanClock?.stop()`, `await scanClock?.idle()`, `await slot.channel?.stop()` — in order, nothing else. `retryBind` (`:2172-2174`) is wired into `prsBeat` at `:2199` and can still be running when `stop()` is read true; it resolves later, writes into `slot.channel`, and a channel that a retry just bound after `slot.channel?.stop()` already ran is never stopped before `process.exit`. Give the retry a way to observe the stop (a flag it checks before writing `slot.channel`, or an await the stop path adds) — the shape fleetd already uses elsewhere for "a result that arrives after stop is read is discarded, not acted on."

**#1526, bullet 3 — a successful late bind writes nothing to the log.** The channel-bind/retry region (`bindChannelSlot` at `:1776`, wired through `retryBind` at `:2172-2174`) logs the initial failure but nothing on a retry that later succeeds — only the early warning persists in `fleetd.log`, so a reader can't tell a channel is now bound. Add a line (`plot-fleetd: channel bound`, or similar) on the success path.

**#1526, bullet 4 — `indexMonitorOver` and `deskRelayOver` are untested.** Both are defined (`:1905`, `:1941`) and wired (`:2162-2163`), but `packages/fleet/test/unit/registryd-wiring.test.ts` exercises the wiring structurally, not either function's own `over()` behavior — the case where the monitored thing has in fact gone idle/ended and the function must report it. Add direct tests for both.

### The decisions the plan settles — do not re-derive them

**Both issues are closed, and that is a tracker artifact, not evidence either is fixed.** #1539 and #1526 were closed in favour of #1846 on 2026-10-16; #1846's own text re-states both as "(OPEN): all three bullets" and "(OPEN): all four bullets" respectively. Read #1846 as the live checklist — the closed issues are pointers into it, not separate trackers to re-verify against.

**Line numbers above are current against `main` at the time this brief was written (2026-10-17) and will drift as waves 1 and 2 land first.** Re-locate each site by the function/variable name given, not by line number, if either sibling branch has merged by the time you start.

**The `void stdio.stdout.write(text)` pattern is the whole bug for #1539/1 — don't widen the fix.** The fix is about `--once`'s own writer losing backpressure signal before exit; it is not a reason to rewrite `writersFor`'s log-file branch (`out`/`err` opened via `processLog`), which already owns its own file descriptor and isn't subject to pipe backpressure in the same way.

**Rules carried over unchanged.** Absent is not false, and a result arriving after a stop is read is discarded rather than acted on — the same shape `rules/supervisor-reading.ts` and the stop path already use elsewhere in this plan's other slices; the bullet-2 fix here should look like that, not invent a second mechanism.

### Done when

The plan's Changelog is the spec for this slice:

- `fleetd --once` writes its whole output when stdout is a macOS pipe.

Lift this and the other six bullets into tests that fail before the fix: a test that simulates a `write` returning `false` (backpressure) from the `--once` writer and asserts the daemon does not exit before that write is observed to complete — proving the fix actually waits rather than coincidentally working on a fast pipe. A test asserting `fleet-clock.ts`'s `warn` lines end in `\n`. A test exercising the stop-race — a retry bind that resolves after `stop()` is read true — asserting the channel it binds is still stopped before the process would exit. A test asserting a successful late bind writes a log line. Direct tests for `indexMonitorOver` and `deskRelayOver` covering their "has gone over" case. Deleting the duplicate assertion in `log-rotation.test.mjs` needs no new test — just confirm the file still has one copy and the suite still passes.

Plus: build artifacts untouched (`skills/plot/scripts/board/board-server.mjs` is generated — do not hand-edit or commit a rebuild of it; see `docs/definition-of-done.md` if you touch anything near it). A changeset under `.changeset/` naming the fix, `plot: patch` (bug fix, no changeset-named section touched). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run the full suite list yourself.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice touches `skills/plot-fleet/SKILL.md` (prose, not shell) and no `.sh` file is expected — if one needs editing, that growth is paid for in the same change.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, once there's a real commit
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists — don't hold it until the slice is done.

### Scope guard

This branch owns `packages/fleet/src/server/entry/registryd-main.ts` (the `writersFor`/exit region and the channel-bind/retry region — not the tick-guard or stop-path regions waves 1 and 2 own), `packages/fleet/src/shared/fleet-clock.ts`, `test/reconcile/log-rotation.test.mjs`, `packages/fleet/test/unit/registryd-wiring.test.ts`, and `skills/plot-fleet/SKILL.md`.

The other five branches in this plan: `bug/fleetd-tick-guard-and-escalations` (tick guard, escalations, `Checks wait` read count — same file, different functions), `bug/fleetd-stop-starts-no-agent` (stop path — the scan after-step, `wt_root` resolution, stop-race tests at the scan level, not the channel level this slice owns), `bug/fleetd-unit-harness-findings` (#1589 review findings), `bug/fleetd-retries-usage-limit-brief` (usage-limit retry), `bug/refused-hold-names-its-reason` (domain + fleetd + board, #1642). As of this brief, only `bug/fleetd-tick-guard-and-escalations` is claimed (`Started:` recorded 2026-10-17); verify the rest at dispatch time, not from this list.

If you find something the plan did not anticipate, report it rather than improvising scope.
