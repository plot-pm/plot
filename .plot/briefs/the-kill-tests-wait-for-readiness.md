## Implementation brief — the-tests-and-gates-close-their-review-findings (wave Kill test readiness)

- **Plan (canonical):** `docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md` on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1495 merged
- **Branch:** `bug/the-kill-tests-wait-for-readiness` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Third wave of eight. "Group signal after exit" (#1511) and "Board test
signals" (#1536) are both merged, but this slice touches none of their
files — `test/reconcile/own-process.mjs`, `workerloop.test.mjs`,
`restart.test.mjs`, `workerstate.test.mjs`, and the board/e2e kill sites —
so it has no dependency on either. Nothing in the plan waits on this slice.

### What to build

Closes issue #1461's M1, M2 and L1 findings, all against
`packages/domain/test/run-script.test.ts`'s `describe('a timeout sends TERM
before KILL', …)` block (`:184-289`). Every finding is a race between a
fixed sleep or a fixed timeout and work a shell child does asynchronously —
not a defect in `killGroup` or `runProcess` (`packages/domain/src/adapters/run-script.ts`)
themselves. This is test-only: no changeset.

**M1 — two tests sleep 200ms and assume `trap` already ran.**

- `'sends KILL to a child that ignores TERM after its leader exited on TERM (#1084)'` (`:225-245`) spawns a leader that backgrounds `sh -c 'trap "" TERM; sleep 30'`, captures the straggler's pid from stdout, then `await new Promise((r) => setTimeout(r, 200))` before calling `killGroup`. If `sh` hasn't reached `trap ""` by the 200ms mark, the TERM that `killGroup` sends arrives before the trap is installed, the straggler dies on TERM instead of surviving to need KILL, and `alive(straggler)` reads false where the test expects true — the assertion the finding is about.
- `'sends KILL to a group that ignores TERM once the grace has passed'` (`:247-254`) has the identical shape: `spawn('sh', ['-c', 'trap "" TERM; sleep 30'], …)` then the same fixed 200ms sleep before `killGroup`.

**M2 — the temp-path test assumes `plot_tmpdir` echoes within 1 second.**
`'lets a timed-out script remove the temp paths it registered'` (`:269-288`) sources `plot-tmp.sh`, calls `plot_tmpdir work probe`, and echoes `"$$ $work"` — all inside a `timeoutMs: 1_000` run. If bash hasn't sourced the file and completed the `mktemp` inside `plot_tmpdir` (`skills/plot/scripts/plot-tmp.sh:114`) by the time `runProcess` fires the timeout, `run.stdout` is empty, `run.stdout.trim().split(' ')` gives `['']`, and `work` is `undefined` — `work.startsWith(tmp)` at `:281` throws a `TypeError` rather than failing the intended assertion.

**L1 — `gone()` can outlive the test.** `gone()` (`:199-202`) polls up to 10 seconds. `packages/domain/vitest.config.ts` sets no `testTimeout` (confirmed: `grep -n testTimeout` returns nothing), so vitest's 5-second default fires first. When it does, the test's `finally` block (which would `SIGKILL` the leader's group) never runs, and `straggler` is left running past the test.

### The decisions the plan settles — do not re-derive them

**The fix is a readiness signal, not a longer sleep.** The plan's Design
section is explicit: "Each child that installs a trap prints a readiness
line after the `trap`, and the test waits for that line before it signals."
A longer fixed sleep (300ms, 500ms) narrows the race without closing it —
it is still a guess about how long `sh` takes to reach a line of its own
script on this machine, under whatever load is running at the time. A
readiness line removes the guess: the child prints after the line that
matters has executed, and the test's `await` on that line is synchronous
with the fact it depends on. Pattern: change `sh -c 'trap "" TERM; sleep 30'`
to `sh -c 'trap "" TERM; echo ready; sleep 30'` (or similar), capture stdout
the same way the leader test already captures the straggler's pid
(`leader.stdout.once('data', …)`), and gate `killGroup` on that event rather
than on a `setTimeout`.

**The temp-path test gets the same treatment, by its own echo line.** The
script already prints `"$$ $work"` after `plot_tmpdir` returns — that line
*is* the readiness signal, it's just not being waited for; the test
currently relies on the 1-second timeout being long enough to contain both
the sourcing and the echo. The plan names two acceptable fixes and asks the
implementer to pick one: wait for the `"$$ $work"` line before the timeout
window starts being counted against it, or raise `timeoutMs` enough that the
echo is never the bottleneck. A readiness-line wait is more in keeping with
the other two fixes in this slice; a raised timeout is simpler here because
the line being waited for is the same line the assertion already parses.
Name which one you chose in the PR description — the plan leaves it open
deliberately (see the plan's Open Questions: this finding is the one case
in the slice where "wait for a line" and "a larger timeout" are both named
as acceptable).

**`gone()`'s poll window must fit inside the test's timeout, not vitest's
default.** Either shorten `gone()`'s 10-second deadline to something under
5 seconds, or give the two tests that call it (`'sends KILL to a child that
ignores TERM after its leader exited on TERM (#1084)'` and any other caller)
an explicit `testTimeout` above 10 seconds via the third argument to `it(...)`.
The plan states both options; pick one and say which. Shortening `gone()`
changes its behavior for every caller in the file — check whether other
tests rely on polling past 5 seconds before narrowing it globally; raising
the per-test timeout is more local and does not risk tightening a poll
window some other test needs.

**These are flaky-under-load tests, not broken assertions.** The straggler
and temp-path tests already encode the right expectation (TERM survived,
KILL needed; stdout parses before the timeout fires) — the finding is that
the *mechanism* proving the precondition is timing rather than a signal.
Confirm this by running the changed tests several times in a row locally
(`pnpm --filter @plot-pm/domain exec vitest run run-script.test.ts` a handful
of times, or under light background load) rather than once — a single green
run proves little when the defect is a race that only shows up occasionally.

### Done when

The plan's `## Done when` is the per-slice bullet: "the TERM-trap tests wait
for a readiness line, the temp-path test waits for its directory line, and
`gone()` fits inside the test timeout."

Concretely:

- Both TERM-trap tests (`:225-245`, `:247-254`) gate `killGroup` on a
  readiness signal the child process emits after installing its trap, not
  on a fixed `setTimeout`.
- The temp-path test (`:269-288`) either waits for its `"$$ $work"` line
  before the timeout window matters, or runs under a timeout large enough
  that the echo cannot be the bottleneck — state which, and why.
- `gone()`'s poll window is below vitest's effective timeout for every test
  that calls it, by shortening the poll or raising the test's own
  `testTimeout` — not by raising vitest's global default, which the plan
  does not ask for and which would mask the same race in future tests.
- Per [[mutation-test-fixtures-must-make-arms-disagree]] and
  [[an-a-b-over-code-proves-nothing-when-a-fixture-varies]]: if you can,
  show the *old* fixed-sleep version actually failed under some condition
  (e.g. by temporarily inflating the sleep in `trap "" TERM` to reproduce
  the race, or by noting the CI flake this issue was filed from) — a fix
  that happens to leave the test green proves nothing about whether the
  race it supposedly closes was ever real for this specific point. Where
  reproducing the original flake isn't practical, say so rather than
  asserting the fix caught something it was never shown catching.

Plus: no changeset (test-only, no shipped code changes). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it resolves to
`pnpm --filter @plot-pm/domain exec vitest related --run {changed}` for this
package, plus the shell gate scripts. The suites under the plan's
`CI suites` config key run in CI on the PR; a failure there comes back as a
correction, not a local run you owe.

`scripts/check-shell-lines.sh` does not apply — this slice touches no `.sh`
file under `skills/`.

### Bookkeeping

Open the PR through the controller once the branch is claimed and has its
first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, or
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to
this branch's line in the plan's `## Slices` section, under "Kill test
readiness". Push the first real commit as soon as it exists — a claimed
branch with no commits for a long stretch reads as idle.

### Scope guard

This branch owns exactly one file: `packages/domain/test/run-script.test.ts`.
It may read, but should not need to change, `packages/domain/src/adapters/run-script.ts`
or `skills/plot/scripts/plot-tmp.sh`.

No other branch in this plan's slice list touches this file — the plan's
Design section states slices change disjoint file sets except the two
decision-gate slices ("Decision table reading" and "Bundle declaration
pairing"), which are unrelated to this one. The two already-merged slices
("Group signal after exit", "Board test signals") changed
`test/reconcile/*.mjs`, board unit tests and e2e tests — none overlap here.

If you find something the plan did not anticipate — for example, a fourth
timing-dependent test in this file the plan's finding list doesn't name —
report it rather than fixing it here; the plan names three findings (M1,
M2, L1) and this slice closes exactly those.
