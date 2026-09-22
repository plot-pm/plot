# Premise lens — a failed tick must not end the daemon

Position: refuted

Evidence: executed

Subject: `docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged as `65071ef52`.
Round 2. Round 1's third finding (the supervisor died again) is withdrawn — the deaths were `launchctl bootout` from `fleetctl.test.mjs`, fixed on `6d47cfa7a`. The supervisor is alive as I write this, pid 3260, uptime 10:55.

## What my lens was asked to settle

Given `tick` already had a `try`/`catch` around its whole body, **what can still reach the loop's new catch?** I built four injection variants of the shipped artifact, each at a different position in the call chain, and ran every one against a throwaway git sandbox. The answer is sharper than round 1 could state, and it does not favour the plan.

## The measurement

`skills/plot/scripts/board/plot-registryd.mjs` copied to scratch. In the minified artifact `og` = `tick`, `AS` = `reportTick`, `_S` = `startAgents`. One `throw` injected per variant, gated on `PLOT_INJ`, so the unpatched path is provably inert. `PLOT_REPO_ROOT` pointed at a throwaway `git init` sandbox. **The real repository was never the subject and the live supervisor was never touched.**

```
node build.mjs                    # four variants from base.mjs
bash run-once.sh                  # --once --start-agents, each variant
bash loop-test.sh                 # --interval 2 --start-agents, 7 s window
```

| # | throw injected at | `--once` exit | which handler caught it | loops? |
|---|---|---|---|---|
| **V1** | **inside `tick`'s own `try`** | 1 | **`tick incomplete reason="INJECTED V1"`** — the **pre-existing** catch | **YES** |
| **V2** | **before `tick`'s `try`** | 1 | `tick failed: INJECTED V2` — **the new catch** | YES |
| **V3** | inside `reportTick` | 1 | `failed to start: INJECTED V3` — the **entry** `.catch` | **NO — DIED** |
| **V4** | inside `startAgents` | 1 | `failed to start: INJECTED V4` — the **entry** `.catch` | **NO — DIED** |
| — | control, unpatched | 0 | — | YES |

**V1 is the whole production class, and the new catch never sees it.** Every reading failure the plan names — *"a git command that fails, a host call that throws, a manifest that disappears mid-read"* — enters `tick` through `options.registry()`, `readTick`, `readQueue` or `options.fleet()`, all of which are awaited **inside** `tick`'s `try`. V1 survives the loop on the pre-existing catch alone. Remove the new catch and V1 behaves identically.

## 1. The new catch's reachable class, named precisely

The plan does not name it. It is:

> **Whatever throws between entering `tick` and entering `tick`'s `try` — plus whatever prevents `tick` from being called at all.**

In the source that window is exactly two statements:

```ts
export const tick = async (options: TickOptions): Promise<TickReport> => {
  const now = options.now ?? Date.now;   // ← the window
  const startedAt = now();               // ← the window
  try {
```

**And in production that window is empty.** `grep -rn "tick({" packages --include="*.ts"` finds the production call site at `registryd-main.ts:831` and **it passes no `now`** — every `now:` in the corpus is a unit test. So `now = Date.now` and `startedAt = Date.now()`, neither of which can throw. V2 is the position I had to inject at to reach the new catch, and **nothing in production occupies it.**

I probed the remaining candidate routes and each one closed:

| candidate route | executed result |
|---|---|
| an argument-expression getter throwing at the call site | **tick's own catch** — the options object is passed by reference and `registry()` runs inside the `try` (`probe3.mjs` route A) |
| `reasonFor`/`emptyDecision` rethrowing from inside tick's catch | reachable in principle (`probe1.mjs`: a null-prototype throw, an `Error` with a throwing `message` getter) — **but nothing in this codebase throws such a value**; every thrower is `Error` or a string |
| `tick` not callable — a broken import | reaches the new catch (`probe3.mjs` route B) — but that fails on **tick 1**, at startup, not mid-life |
| memory pressure / OOM | **`FATAL ERROR: Reached heap limit` — not catchable at all** (`probe3.mjs` route C, under `--max-old-space-size=128`). No `catch` anywhere in any language can see this |

**So the honest statement is: the loop's catch is reachable only by a broken build or a hostile thrown value, neither of which is the failure the plan was written about.** It is not literally dead code — V2 fires — but the class it guards is empty on the production path, and the plan's three named failure modes are all in V1.

## 2. Is the entry `.catch` reachable, and by what?

**Yes, but by nothing its own comment names, and what it does catch it mislabels.**

The code comment claims:

> this covers what throws before the loop is reached — **an unreadable argument, a missing registry directory**.

I executed both:

```
node base.mjs --nonsense            → usage line, EXIT=2     (no throw)
node base.mjs --max=notanumber      → usage line, EXIT=2     (no throw)
node base.mjs --interval zero       → usage line, EXIT=2     (no throw)
PLOT_REPO_ROOT=/tmp/no-such-repo-12345 node base.mjs --once
                                    → normal tick, agents=0  (no throw)
```

**Neither stated cause throws.** `argsFrom` returns `null` and `run` writes the usage line and returns 2; a missing registry directory ticks normally at `agents=0`. The entry `.catch` is unreachable by both.

**What it actually catches is V3 and V4** — a mid-loop throw from `reportTick` or `startAgents`, which sit *outside* the new `try`, inside the same iteration. Both killed the daemon in my loop run, and both printed:

```
plot-registryd failed to start: INJECTED V4
```

The daemon had been supervising for seconds; it did not fail to start. An operator greps that line and inspects their arguments and registry path when the failure was a spawn on tick 400.

## 3. What I executed versus only read

**Executed:** the four artifact variants under `--once` and under `--interval 2` (eight runs plus two controls); `probe1.mjs` (hostile thrown values through tick's catch shape); `probe2.mjs` (`execFile` synchronous throws); `probe3.mjs` (argument getters, uncallable tick, OOM under a 128 MB heap); `probe4.mjs` (`runProcess` rejection with a NUL-bearing env value); the four argument/registry cases against the shipped artifact; `git log`/`git show` on `65071ef52` and `6d47cfa7a`; `grep` over the live `.plot/logs/registryd.log`; `ps` on the live supervisor.

**Read only:** the plan, round 1's `behaviour.md` and `panel.md`, `registryd.ts`'s `tick`, `registryd-main.ts`'s `run`/`startAgents`/`argsFrom`, `performer-shell.ts`, `run-script.ts`, and the `a-test-must-not-stop-the-fleet` plan.

**Not done, as instructed:** no `pnpm run test:e2e`; no supervisor or worker killed. Every injected process was one I started in the sandbox and killed myself.

**Repository state:** `git status --porcelain` is **empty**. `git diff --exit-code` over `registryd-main.ts` and `plot-registryd.mjs` passes. Every mutation lived in `…/scratchpad/premise/`, never in the tree. The live supervisor's uptime grew 10:13 → 10:55 across my session, so I disturbed nothing.

## 4. What the plan claims that the code does not do

**(a) The premise, restated correctly now that the unload explanation exists.**

The plan's argument is *"there is no `catch` anywhere on that path … `grep -c catch` over the tick path returns zero"*. That grep ran over `registryd-main.ts`, which **calls** `tick`; `tick` is **defined** in `registryd.ts:178` and its body opens with `try {`. Round 1 established this. What round 2 adds is the consequence: **the three failure modes the plan names are the exact set V1 covers**, and V1 is caught one frame lower and always was. The plan's fix does not address its own stated cause.

**(b) The live log has never recorded a single caught failure of any kind.**

```
grep -c "tick incomplete"   .plot/logs/registryd.log → 0
grep -c "tick failed"       .plot/logs/registryd.{log,err} → 0, 0
grep -c "failed to start"   .plot/logs/registryd.{log,err} → 0, 0
```

Across four `supervising` banners and the whole recorded life of this daemon, **no catch has ever fired** — not the pre-existing one, not the new one, not the entry one. The pre-existing catch covers every reading failure there is and has never had one to report. That is the measurement saying the class was empty before the change and is empty after it.

**(c) The deaths are now explained, and no `catch` could have prevented them.**

`launchctl bootout` delivers a signal. The OOM route I measured is a V8 `FATAL ERROR`. Neither is a catchable exception. So the plan's hedge — *"a death from memory pressure or a signal would look the same from outside"* — is now the confirmed answer, and its proposed instrument could not have distinguished them: a `catch` prints nothing for either, which is precisely the empty-`registryd.err` signature the plan quoted as its evidence.

## 5. A defect nobody has noticed

**`runProcess`'s docstring is false, and the failure lands outside the new `try`.**

`packages/domain/src/adapters/run-script.ts:52`:

> Never throws for a non-zero exit: the exit code is the answer, and an exception would make the four contract codes indistinguishable from a missing binary.

`runProcess` wraps `execFile` in a `new Promise` executor. **A synchronous `execFile` throw inside that executor becomes a rejection**, and I measured five input shapes that do it:

```
env value with NUL   → TypeError: options.env['PLOT_START_DESK'] must be a string without null bytes
cwd with NUL         → TypeError: options.cwd must be … without null bytes
timeout negative     → RangeError: "timeout" out of range
maxBuffer NaN        → RangeError: options.maxBuffer out of range
env value whose toString() throws → Error: boom
```

The first is the live one. `performer-shell.ts:97` passes `PLOT_START_DESK: worktree`, and `worktree` arrives from a decision write built off a **manifest read from disk**. A corrupted manifest carrying a NUL in its worktree path produces a rejection that escapes `startFreeAgent`, escapes `startAgents` — and `startAgents` is **outside** the new `try`.

Measured end to end as V4: **the daemon dies, and reports `failed to start`.**

This matters because **`--start-agents` is the flag the live supervisor runs with** (`ps` on pid 3260 confirms it), and `startAgents` is the only path that spawns. It is the likeliest real thrower in the loop and the change does not cover it.

## Why refuted

The guards hold — round 1 measured them and I did not re-litigate that. I refute on the premise, which is my lens:

- **The new loop `catch` guards an empty window.** Its reachable position is the two statements before `tick`'s own `try`, and in production those are `Date.now` and `Date.now()`. Every failure the plan names is caught one frame lower by a catch that predates the change, and V1 proves the loop survives without the new code.
- **The entry `.catch` is unreachable by either cause its comment names.** A bad argument returns 2; a missing registry directory ticks normally. Executed, both.
- **What the entry `.catch` does catch, it mislabels.** V3 and V4 — mid-loop throws from `reportTick` and `startAgents` — print `failed to start` about a daemon that had been supervising, and kill it.
- **The hole is on the flag the live supervisor runs with.** `runProcess` can reject despite its docstring, and that rejection lands in the uncovered half of the loop body.
- **The original deaths were signals.** No `catch` can see a `bootout` or a V8 `FATAL ERROR`, so the instrument the plan offered could never have distinguished the cause it was built to expose — and the log confirms it: zero caught failures, ever.

What I would ask for, in order of what the measurement supports:

1. **Move the `try` around the whole loop body**, not the `tick` call alone — that is where V3 and V4 live, and it is the only change here that would have any production effect.
2. **Fix `runProcess`**: add a `try`/`catch` inside the executor and `resolve({ code: 1, … })`, so the docstring becomes true.
3. **Give the entry `.catch` a message that does not assert *start*.**
4. **Correct the plan's premise**, which is published and wrong, and record that the deaths were `launchctl bootout` rather than a thrown tick.
5. Write the four promised tests; `run` has no unit test at all, so none of the three catches has coverage.
