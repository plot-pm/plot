# Juror: the measurement lens

Position: amend

Lens: I do not accept a stated number. I re-took the timings and re-read the timeout path.

## 1. Are the timings reproducible? No.

Eight sequential runs of `bash skills/plot/scripts/plot-fleetctl.sh --status`, on the same estate, at load average 8.3–8.6 — the plan's own "busy machine" condition, and the same order of load the plan claims produced 5724 ms:

| run | ms | exit | load |
|---|---|---|---|
| 1 | 2157 | 0 | 8.64 |
| 2 | 1903 | 0 | 8.64 |
| 3 | 869 | 0 | 8.64 |
| 4 | 1348 | 0 | 8.59 |
| 5 | 838 | 0 | 8.59 |
| 6 | 2579 | 0 | 8.59 |
| 7 | 1801 | 0 | 8.54 |
| 8 | 874 | 0 | 8.54 |

Six more, run **concurrently** to force contention, all finished at 2117 ms.

**Max of 14 runs: 2579 ms. The budget is 5000 ms. Nothing came close.** The plan's two lower readings (1780, 2345) sit inside my range and reproduce fine. The 5724 ms outlier does not reproduce in 14 attempts.

And the estate is **larger** than the plan describes. The plan says `--status` "walks a dozen desks"; it currently enumerates **19** agents (`agents_other=19`, 19 worktrees under `.worktrees/`). A bigger fleet than the plan measured, and still under half the budget.

**Three samples is not enough to set a budget.** One of three was the outlier, so the plan's "measured worst case" is a sample of one. With n=3 there is no distribution, no percentile, and no way to tell a systematic cost from a scheduler hiccup. The plan then names that single reading "the measured worst case here" and builds the whole fix on it.

## 2. `SUPERVISOR_TIMEOUT_MS = 5000` is real. **The timeout path is NOT what the plan says.**

`packages/board/src/server/supervisor-reading.ts:50` — `export const SUPERVISOR_TIMEOUT_MS = 5_000;` Confirmed.

The plan states (line 30): "`:126` wraps the call so that a timeout returns `{ asked: false }`."

**That is false, and I measured it.** The chain is:

- `supervisor-reading.ts:126` calls `scripts.awaited(SCRIPT, ['--status'], { timeoutMs: SUPERVISOR_TIMEOUT_MS })`
- `awaited` is bound at `packages/domain/src/adapters/scripts/scripts-shell.ts:107`, and delegates to `runProcess`
- `runProcess` (`packages/domain/src/adapters/run-script.ts:60`) is `new Promise((resolve) => execFile(...))` with **no `reject` path at all**. Its own docstring: *"Never throws for a non-zero exit."* A `timeout` kill is exactly a non-zero exit.

Measured directly with node:

```
execFile('bash',['-c','sleep 10; echo done'], {timeout:1000})
→ 1005 ms {"code":1,"stdout":"","stderr":"","killed":true,"signal":"SIGTERM"}
```

It **resolves**. It does not throw. So the `catch { return { asked: false, ... } }` at `:133` is **never reached by a timeout**. It is reached only by a fork failure — which is the `unknown`-must-stay-reachable case the plan's "What must not break" section is about, and that case is fine.

What a timeout actually produces, measured with a script shaped like `--status` (prose lines, then a trailing `summary:`):

```
{"code":1,"stdout":"platform: launchd\n  desk a  none\n","summarised":false,"killed":true}
```

So a timeout yields `asked: true, exitCode: 1, summarised: false`. Partial stdout survives SIGTERM — which the module's own `SUMMARY_PREFIX` docstring anticipates correctly, unlike the plan.

The rule at `packages/domain/src/rules/supervisor-reading.ts:237-243`:

```ts
if (!readings.asked) return 'unknown';     // ← NOT the arm that fires
if (!readings.summarised) return 'unknown'; // ← THIS is the arm that fires
if (readings.exitCode === 0) return 'up';
```

**The plan quotes both lines and attributes the behaviour to the first. The second is the one that fires.** The user-visible word is the same — `unknown` — so the symptom description survives, but the plan's stated mechanism is wrong.

This matters beyond pedantry, because of what the plan's own slice promises to test: *"a test pins that a run exceeding the budget still answers `unknown` rather than hanging, and that `summarised: false` keeps its own arm."* Those are **the same arm**. A timeout *is* the `summarised: false` case. An implementer writing that test from this plan would write two tests believing they cover two paths, and would leave `asked: false` — the genuine fork-failure case — untested while believing it was pinned.

## 3. What number would the fix use? The plan names none, and the worst case is unbounded.

The plan says "a budget that admits a run of that shape" and stops. That is not a number, and a plan whose entire subject is a constant must name the constant.

Worse, **the cost is not bounded at all.** `plot-fleetctl.sh:440` is a serial loop:

```sh
for wt in "$wt_root"/"$wt_prefix"*; do
  row=$(plot_worker_state "$wt")
```

I timed one desk: **72, 116, 61 ms**. Nineteen desks × ~90 ms ≈ 1.7 s, which matches my observed median. There is no concurrency, no cap, and no early exit. **Cost is linear in desk count with no ceiling.**

The module's own docstring already records the trend the plan ignores: *"0.46 s in a checkout with no fleet worktrees, 1.42 s in one with 27."* That is roughly 36 ms/desk in a quieter moment — same shape, same unboundedness.

So: 19 desks ≈ 1.7 s today. 60 desks ≈ 5.4 s and the budget is blown again at any load. The fleet is the thing that creates desks, and a fleet that grows walks itself past any fixed number. **Question 3 has no answer the plan's approach can give.**

## 4. Is raising the budget the right lever? Not on its own.

Given §3, no. Raising 5000 to (say) 8000 buys headroom proportional to desk count, and the estate has already grown from the 12 the plan describes to 19 while the plan sat in Draft. The lever moves a constant against a quantity that grows.

The plan explicitly rejects two alternatives and never considers the ones the measurements point at:

- **Bound the walk, not the wait.** Cap desks enumerated, or read them concurrently. ~90 ms serial per desk is the cost driver, and it is the thing that scales.
- **A timeout is currently indistinguishable from a partial run.** Since `awaited` resolves rather than throws, `readSupervisor` could read `killed`/`signal` and report a *timed-out* reading distinctly from *script printed no summary*. That is the real "keeps its own arm" split the plan gestures at but has backwards.

The plan's rejection of retrying is sound. Its rejection of quieting `unknown` is sound, and well argued. Neither rejection is where the weakness is.

I also want to record what the plan gets right, because it is not nothing: `unknown` genuinely is honest, it genuinely renders as a `note` (`rules/supervisor-reading.ts:271`), the "must stay bounded" constraint is real (the render path is single-threaded), and the symptom an operator reported is a real symptom. The diagnosis is where it fails, not the motivation.

## 5. What was not measured that should have been

- **The distribution.** n=3, one outlier, no repetition. 14 runs cost me under a minute.
- **The load at the time of each reading.** The plan names "a working machine" and "three panel agents, three workers and a supervisor" but no load average, so the 5724 ms reading cannot be placed against any other machine state — including mine at 8.6.
- **What the machine was doing during the 5724 ms run.** An outlier 2.2× the neighbouring samples on the same box is more likely a scheduler stall, a `git` lock, or an unrelated burst than a property of `--status`. Nothing rules that out.
- **Per-desk cost and desk count** — the two numbers that actually determine the budget, and the only ones that answer question 3.
- **The timeout path itself.** Twelve lines of node would have shown `execFile` resolves. The plan asserts the opposite in its central paragraph.
- **Whether the reported incident was even this defect.** The plan's own Notes say the state was gone before investigation, and that *"this is the third distinct defect today behind one symptom"* — two prior explanations for `fleet status unknown` were each real and each wrong about the others. That history is an argument for reproducing before fixing, and the plan cites it while not reproducing.

## Why amend and not reject

The defect class is plausible and the estate does grow toward it. But the plan cannot be implemented as written: it names no number, its stated mechanism is factually wrong, and its one test promises to distinguish two arms that are one arm.

What would make it proceed:

1. **Re-measure with n ≥ 20**, recording load average per run, and report the distribution. If a run over 5000 ms does not reproduce, say so and re-scope — the defect may be desk growth rather than machine load.
2. **Correct the mechanism.** A timeout is `asked: true, exitCode: 1, summarised: false`, and `runProcess` never throws. The `!readings.summarised` arm is the one that fires.
3. **Name the number and derive it** from desks × per-desk cost plus headroom, not from one sample.
4. **Address the unboundedness**, or state explicitly that a fixed budget is accepted as temporary and name the desk count at which it fails again.
5. **Fix the slice's test description.** Pin the `asked: false` arm separately, since it is the one nothing currently covers.

## Measurements, for reuse

- Machine: load avg 8.38→8.64 throughout, 25 days uptime, 18 users.
- `--status`: 14 runs, min 838 ms, max 2579 ms, median ≈ 1850 ms, **zero over budget**.
- Estate: 19 agents, 19 fleet worktrees, 20 git worktrees, 3 registered agent manifests, supervisor up (pid 3260, `install=running`).
- Single `plot_worker_state` on one desk: 72 / 116 / 61 ms.
- `execFile` timeout: resolves, code 1, `killed: true`, `signal: SIGTERM`, partial stdout retained.
