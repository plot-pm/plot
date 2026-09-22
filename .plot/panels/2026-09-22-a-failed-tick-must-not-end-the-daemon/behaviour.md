# Behaviour lens — a failed tick must not end the daemon

Position: refuted

Evidence: executed

Subject: `docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged as `65071ef52`.

## Summary

The four guards the plan names all hold, and I measured each one by execution rather than reading the diff. I still refute the delivery, on three findings that execution produced and the diff conceals:

1. **The plan's stated premise is false.** `tick` already had a `try`/`catch` around its entire body before this change. The plan says *"`grep -c catch` over the tick path returns zero"*; the catch is one frame lower, in `registryd.ts:180`, and its own docstring says it was put there for exactly this reason.
2. **The promised tests do not exist.** The slice promised four test pins. The commit added none, and I proved the suite is blind to the change by reverting it.
3. **The live supervisor died again, after the fix, with the same signature.** Not a prediction — it is dead right now.

## 1. Does each deliverable the plan named appear in the merged code?

Partly. Two of three.

| the slice promised | in the merged code |
|---|---|
| tick wrapped in `try`/`catch` inside the loop | YES — `registryd-main.ts:828-857` |
| the entry point gains a `.catch` | YES — `registryd-main.ts:1004-1014`, and in the built artifact |
| "Tests pin that a throwing tick leaves the loop running, that the next tick is attempted, that `--once` does not swallow it, and that the report is empty rather than partial" | **NO — zero tests added** |

`git show 65071ef52 --name-only` lists exactly three files: the changeset, the source, and the rebuilt artifact. No test file is touched.

**I proved the suite cannot see the change.** I copied the pre-fix source over the current one and re-ran the three registryd suites:

```
command cp -f <pre-fix registryd-main.ts> packages/board/src/server/entry/registryd-main.ts
grep -c "tick failed" …/registryd-main.ts     → 0   (swap confirmed real)
git diff --stat                               → 17 insertions, 63 deletions
./node_modules/.bin/vitest run test/unit/registryd-main.test.ts \
    test/unit/registryd-tick.test.ts test/unit/registryd-units.test.ts
  → Test Files 3 passed (3)   Tests 123 passed (123)
git checkout -- …/registryd-main.ts           → restored, git diff clean
```

**123 pass with the fix entirely absent.** The commit message's *"registryd unit tests: 123 pass"* is true and says nothing — it is the same 123 that passed before. `run` is never invoked in any unit test (`grep -n "run(" test/unit/registryd-main.test.ts` returns nothing), so neither the loop's catch nor the entry `.catch` has any coverage at all. Per CLAUDE.md's *Gates Over Rules*: this shipped as a rule where the slice promised a gate.

## 2. Do the plan's four guards actually hold?

All four hold. I measured each against the **shipped artifact** `skills/plot/scripts/board/plot-registryd.mjs`, copied to scratch and patched to throw at the first statement of the minified `tick` (`og`), run against a throwaway git sandbox with `PLOT_REPO_ROOT` pointed at it. The real repository was never the subject.

**Guard A — `--once` still returns non-zero.**
```
PLOT_INJECT_THROW=1 node throwing.mjs --once
  EXIT=1
  stderr: plot-registryd tick failed: injected tick explosion
```
Control, unpatched artifact, same sandbox: `EXIT=0`. Control, patched artifact with the env var unset: `EXIT=0` — so the patch is inert and the exit code is the catch's, not the patch's.

**Guard B — the report stays empty rather than partial.** Measured as a contrast, not a claim. Healthy tick stdout:
```
plot-registryd: supervising …/sbx/.plot/agents
plot-registryd tick agents=0 left=0 reap=0 … cost=550ms
```
Failed tick stdout:
```
plot-registryd: supervising …/sbx/.plot/agents
```
The banner and nothing else. No `tick` line, no partial counts.

**Guard C — the interval is still waited.**
```
PLOT_INJECT_THROW=1 node throwing.mjs --interval 2    (9 s window)
  ALIVE after 9s: YES (pid 86135)
  stderr: 4 × "plot-registryd tick failed: injected tick explosion"
  stdout: the banner only
```
4 failures at a 2 s interval over 9 s. It sleeps; it does not spin. The process survived and I killed it myself.

**Guard D — the failure reaches stderr, not stdout.** Every run above: the failure text appears only in the stderr capture; the stdout capture holds only the banner.

**And the pre-fix artifact does die**, which makes the guards meaningful rather than vacuous. Same injection into `65071ef52^`'s artifact, `--once`: an unhandled `Error: injected tick explosion` stack trace, no `tick failed` line.

## 3. What I executed versus only read

**Executed:** all four guard measurements above, plus their three controls; the pre-fix regression control; two out-of-try throw injections (§5); the three registryd suites twice, once against the current source and once against the reverted source; `ps`, `launchctl print`, and reads of the live `.plot/logs/registryd.log` and `registryd.err`.

**Read only:** the plan, the diff, `registryd.ts`'s `tick`, `startAgents`, and the launchd/systemd units. I did not run `test:e2e` and I killed no live worker or supervisor.

**Repository state:** `git status --porcelain` shows one untracked file, `.plot/panels/2026-09-22-a-loaded-label-is-not-a-running-daemon/amendment.md`, which is another juror's output and not mine. `git diff --exit-code` over `registryd-main.ts` and the artifact: clean. Every injection lived in a scratch copy; the one in-tree swap was restored with `git checkout --`, never from my own copy.

## 4. What does the plan claim that the code does not do?

**The plan's diagnosis is wrong, and this is the finding that matters most.**

The plan's central claim:

> **There is no `catch` anywhere on that path.** … `grep -c catch` over the tick path returns **zero**. The `catch` blocks in the file are per-file-read (`:217`, `:657`, `:669`) — they protect individual reads, not the tick.

That grep was run over `registryd-main.ts` alone. `tick` does not live there — it lives in `registryd.ts:178`, and **its entire body is already inside a `try`/`catch`** that converts any thrown reading into `incomplete: reasonFor(error)` with an empty decision. Its own docstring, written long before this plan:

> **A TICK THAT CANNOT COMPLETE REPORTS AND DOES NOT THROW.** … Before this, any one of them escaped `tick` and ended the loop in `run`…

So the three failure modes the plan names — *"a git command that fails, a host call that throws, a manifest that disappears mid-read"* — were **already handled**, and handled better: they produce an `incomplete` tick line that a person can grep, where the new catch produces a bare stderr line and no tick record. My injection reached the new catch only because I placed the throw at the very first statement of `tick`, the one position its own catch cannot cover. No production failure occurs there.

**The live log confirms this empirically.** `grep -c "incomplete" .plot/logs/registryd.log` returns **0**. Across the entire recorded life of this supervisor, `tick`'s catch — which fires on every reading failure there is — never fired once. Whatever killed the daemon twice was never a reading failure inside `tick`. The plan removed a class that was already empty.

The plan's own hedge is the honest part, and it is now answered:

> **It may not be the only cause.** … The `catch` makes the difference observable: a surviving daemon that logs a tick failure has hit this class, and one that still vanishes has not.

Measured below: **it still vanishes.**

## 5. Is there a defect nobody has noticed?

**Yes — two, and the second is still killing the daemon today.**

**(a) The catch covers only the tick call. The rest of the loop body still ends the daemon.**

`reportTick` and `startAgents` run *after* the `try` block, inside the same iteration. I injected a throw into each, in the shipped artifact, and ran the loop:

```
throw from reportTick,   --interval 2, 7 s window
  ALIVE after 7s: NO -- DAEMON DIED
  stderr: plot-registryd failed to start: injected report explosion

throw from startAgents,  --interval 2 --start-agents, 7 s window
  ALIVE after 7s: NO -- DAEMON DIED
  stderr: plot-registryd failed to start: injected startAgents explosion
```

Both still take the daemon down. And the message is **wrong**: `"failed to start"` is printed for a daemon that had been supervising for however long. An operator greps that line and looks at their arguments and their registry directory, when the failure was a spawn on tick 400. The plan explicitly scoped the entry `.catch` to *"an error thrown while parsing arguments, before the loop starts"* — in practice it is the catch-all for mid-loop deaths, mislabelling every one of them.

This matters because **`--start-agents` is the flag the live supervisor runs with** (`skills/plot/units/com.plot-pm.registryd.plist:32`, `plot-registryd.service:47`), and `startAgents` is the path that shells out through `performer` to spawn worker processes. It is by far the likeliest real source of a throw, and it is outside the try.

**(b) The supervisor died again after the fix, with the identical signature — and is dead right now.**

Not inference. Measured at 12:42 on 2026-09-22:

```
ps -eo pid,etime,command | grep plot-registryd | grep -v grep   → (nothing)
stat .plot/logs/registryd.log   → last written Sep 22 11:40:46
date                            → Sep 22 12:42:02
wc -c .plot/logs/registryd.err  → 0 bytes, mtime Sep 8 16:24
launchctl print … com.plot-pm.registryd → label not loaded
```

The fix committed at **11:11**. `.plot/state/fleet-start.done` records `2026-09-22T09:12:01Z` = **11:12 CEST**, so the third `supervising` banner in the log (line 142) is the post-fix daemon. It ticked normally until **11:40** and then stopped. No process. An hour of silence. `registryd.err` still zero bytes, untouched since September 8th.

**That is precisely the signature the plan set out to remove** — *"`registryd.err` was empty on both deaths, which is itself evidence: the process was not reporting, it was vanishing."* It vanished again, 29 minutes after the fix, and reported nothing. The fix's own stated observability test has been run by reality and it failed: a daemon that hit the tick class would have logged `tick failed`; this one logged nothing, so per the plan's own criterion it did not hit the class this change removes.

The last ticks before the death are also worth naming — `cost=90886ms`, `103804ms`, `91143ms`, against a documented `TICK_COST_MS` of ~3.5 s. The supervisor was 25-30× over budget on a 60 s interval, so ticks were overlapping their own interval. Whether that is the cause I did not establish and do not claim. What I do claim is that the plan looked for the cause in the one place the code already handled, and the evidence pointing elsewhere — zero `incomplete` ticks, ever — was available before the change and was not consulted.

## Why refuted

The four guards hold. The mechanism is sound and correctly built, and had a test been written it would have been a fair small change. I refute on the outcome, not the craft:

- the plan's stated premise is factually wrong, and the code it claims does not exist has been there all along, one file over;
- the promised tests are absent, and I proved the suite is blind to the whole change;
- the defect the plan exists to fix is unfixed — the daemon is dead as I write this, with the exact empty-`registryd.err` signature the plan quoted as its evidence;
- the catch's scope leaves the live supervisor's own flag path (`--start-agents`) uncovered, and the entry `.catch` now mislabels every mid-loop death as a startup failure.

What I would ask for: move the `try` around the whole loop body rather than the tick call alone; give the entry `.catch` a message that does not assert *start*; write the four tests the slice promised; and re-open the diagnosis, since the `incomplete=0` count says the real cause was never on this path.
