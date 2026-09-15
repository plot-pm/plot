# Premise lens — the supervisor log has a ceiling

Everything below is a measurement I ran on this machine, 2026-09-15. Commands are named.

## 1. Are the factual claims true?

`stat -f '%z' .plot/logs/registryd.log`, `wc -l`, `awk` over the file.

| Plan's claim | Measured | Verdict |
|---|---|---|
| Size **69 MB** | 69,513,946 B = 69.5 MB (grew to 69,525,296 B mid-session) | **TRUE** |
| Lines **1,527,602** | **1,585,949** (`wc -l`), 1,586,195 counting the last partial | **STALE, not wrong** — file grew ~58k lines while drafting; direction is honest |
| Oldest entry **2026-09-08 — 7 days** | file birth `2026-09-08 16:24:22`, mtime `2026-09-15 20:25:31` → **7.17 days** | **TRUE**, but see the caveat below |
| One branch name repeated **7,086×** | `grep -c '^    feature/board-sync$'` → **7,332**. Every one of the 583 distinct branch lines repeats 7,332× | **TRUE and understated** |
| `board.log` beside it **16 KB** | 16,745 B, 176 lines | **TRUE** |
| Registryd CPU **3 min 52 s over 3.5 days** | `ps -eo time` → **4:06.93** over `03-20:40:55` etime | **TRUE** (same process, since re-measured) |

**The 7-day claim has an unverifiable half.** `grep -c '2026-09' registryd.log` returns **0** — the log carries **no timestamps on any line**. "Oldest entry 2026-09-08" is the file's birth time, not an entry's. That is fine for the growth argument, and I flag it because it is the one number that cannot be re-derived from the file's contents.

### The one claim that is FALSE, and it is the load-bearing one

> `skills/plot/units/com.plot-pm.registryd.plist:71` sets `StandardOutPath` with `KeepAlive: true`. **The write is launchd's, not the program's.**

The plist text is verified exactly — `:59-60` `KeepAlive`/`<true/>`, `:71-72` `StandardOutPath` → `__REPO_ROOT__/.plot/logs/registryd.log`. So the plan reads the file correctly.

**But launchd is not writing this log.** Measured:

```
$ launchctl list | grep -i plot
-	0	com.plot-pm.registryd          # '-' = NOT RUNNING

$ ps -eo pid,ppid,etime,time,command | grep registryd
90426 91960 03-20:40:55 4:06.93  node .../plot-registryd.mjs --start-agents
91960     1 05-10:27:36 0:00.01  bash -c while true; do node .../plot-registryd.mjs \
                                 --start-agents >> .plot/logs/registryd.log 2>&1; sleep 45; done
```

The writer is a **detached bash `while true` loop with `>> .plot/logs/registryd.log`**, PPID 1, running 5d10h. The launchd job is loaded but has never run (pid `-`, exit `0`). The plist's `StandardOutPath` is a *template* (`__REPO_ROOT__` unsubstituted in the repo copy) that happens to name the same path the bash loop appends to.

**Why this matters and why it does not sink the plan.** The plan uses launchd-owns-the-write to argue *rotation is impossible, therefore fix the source*. That argument is **built on a false premise** — a `>>` redirect from a bash loop is trivially rotatable (`logrotate` with `copytruncate`, or truncate between iterations, since the loop reopens nothing but the shell holds the fd — actually the shell holds it open for the loop's life, so `copytruncate` is required, not `mv`). So "nothing can rotate it" is not established.

The *conclusion* survives anyway, because the plan's real argument is the better one and stated independently: **"the fix is at the source rather than the sink"**, and **"a rotation on a noisy one is a second mechanism maintaining the first."** That holds regardless of who owns the fd. The premise is wrong; the recommendation is right for a different reason. **This is exactly the failure mode the panel was convened to catch, and it is present** — it just happens to be non-fatal.

## 2. Is the diagnosis right? Is the volume the per-branch lists?

I classified all 1,585,949 lines by shape (`awk` on leading whitespace/prefix) and measured bytes per class:

| Class | Lines | Bytes | % of file |
|---|---|---|---|
| `    ` 4-space **branch lists** | 1,525,556 | 59,761,006 | **85.96%** |
| `  ` 2-space **desk/worktree lines** | 38,174 | 7,132,536 | **10.26%** |
| `plot-registryd N worktrees nobody dispatched` | 6,501 | 863,382 | 1.24% |
| `plot-registryd tick …` counted summary | 7,334 | 1,509,315 | 2.17% |
| `  held on <hold> (N):` headers | 8,621 | 258,319 | 0.37% |
| `plot-registryd: supervising …` | 9 | 738 | 0.00% |

**The diagnosis is correct and the dominant term is right: 86% of bytes are the per-branch lists.** At 208 list lines per tick over 7,334 ticks, removing them removes ~60 MB of 69.5 MB.

### But the plan never mentions the second-largest population, and it is 11.5%

**10.26% of bytes are the `unclaimedLines` desk report** — `registryd.ts:376-391`, printed via `registryd-main.ts:843`. Measured repeats:

```
6413  .worktrees/free-b2023483 (detached) — git worktree remove …
4551  /private/tmp/.../scratchpad/wt-fix1 (detached) — git worktree remove …
4550  /private/tmp/.../scratchpad/wt-app (detached) — 2 uncommitted, read it before removing it
```

Plus its 1.24% header line (`N worktrees nobody dispatched`, 6,501 emissions). **Together 11.5% — about 8 MB.** These lines are long (absolute paths twice over, one is 265 chars) and repeat thousands of times.

And the code **explicitly licenses this** (`registryd-main.ts:838-842`):

> *"NAMED ON EVERY TICK, unlike the held slices below… the unclaimed trees were twelve at their worst and **are zero on a healthy estate**, so a looping daemon can name each one without ever writing a line nobody wants."*

**That justification is measurably false on this estate.** The last tick reports `unclaimed=9`, and the same nine desks have been re-emitted for 6,413 consecutive ticks. The estate is not healthy, the count is not zero, and "without ever writing a line nobody wants" has written 8 MB. `wt-fix1` and `wt-app` are in a **scratchpad directory** — they are session detritus, re-reported 4,500 times each.

**So the plan fixes 86% and leaves a documented-as-impossible 11.5% in place, under a comment asserting it cannot happen.** After this plan lands, the log still grows at ~1.2 MB/day from a source the plan never names. That is not a reason to reject — it is a reason the Done-when must not claim the file is bounded.

### A third thing the plan never mentions: the volume is GROWING, not constant

`held=` sampled across the file: **165 → 166 → 188 → 194 → 197 → 213 → 217 → 220 → 225 → 233**. Monotonic. The per-tick list is not a fixed 208 lines; it is proportional to a held count that has risen 41% in seven days and has no ceiling of its own. The file's growth is **superlinear**, which strengthens the plan's case and is missing from its Design.

## 3. Is claim #3 — "documented behaviour the daemon is not following" — true?

**Verified true, in both halves, and it is the plan's strongest section.**

The documentation, `skills/plot-fleet/SKILL.md:88`, verbatim:

> *"`--once` also names the branches under each hold; **the looping daemon prints the counts and stops there.**"*

The code's own comment, `registryd-main.ts:850-853`:

> *"THE HELD SLICES ARE NAMED HERE AND NOWHERE ELSE. `--once` is the operator's inspection path; the looping daemon prints the counts on its summary line and stops there, because a tick every 60 s must not write 480 branch names to a log nobody is reading at the time."*

The code, `registryd-main.ts:824-828`:

```ts
export const reportTick = (
  report: TickReport,
  write: (s: string) => void,
  warn: (s: string) => void,
): number => {
```

**`reportTick` takes no `once` parameter.** `run` calls it identically on every iteration (`:793`) and only afterwards branches on `if (args.once) return code;` (`:802`). The distinction the comment and the skill both assert **has no representation in the code at all**. The comment describes behaviour that was never implemented — it reads as a design intent someone wrote beside the loop and did not wire.

This is a genuinely well-found defect. It is not the rejected sibling's error: the sibling mistook designed behaviour for a bug, whereas here the design says one thing and the code does another, and I can point at the missing parameter.

## 4. What does `Done when` fail to pin?

Four gaps, one serious.

**(a) It does not pin the desk lines, and its wording implies they are covered.** The gate is *"a looping tick prints no per-branch list, pinned by a test asserting the line count per tick is bounded rather than proportional to the branches held."* An implementation satisfying this exactly still emits 208→9 desk lines per tick. **Concretely: an implementation could pass every gate and reduce the log by 86% while leaving it growing at ~1.2 MB/day forever** — and the plan's own summary sentence ("the supervisor's log stops growing without bound") would be false. The desk lines are bounded by *desks*, not branches, so "bounded rather than proportional to the branches held" is literally satisfied by code that is still unbounded in practice.

**(b) "`--once` output is byte-identical" is untestable as stated against a live estate.** `--once` output contains `cost=NNNNms` (measured 6,152–8,925 ms across the file) and a live `held=` count. Byte-identical to *what* is unpinned — it can only mean "identical for a fixed `TickReport` fixture", which the existing tests already do (`registryd-main.test.ts:309-333`). Worth pinning as fixture-identity, not byte-identity.

**(c) The key-set assertion is already satisfied today** and pins nothing new. `tickLine` (`registryd.ts:313-330`) emits all six `QUEUE_HOLDS` keys unconditionally inside `if (report.handOver !== null)`. A gate that passes before the change is not a gate. It should pin that the key set is *unchanged by this diff*, which is a different assertion.

**(d) The Open Question is left open and it decides the shape.** *"Does the daemon keep a per-tick line at all?"* is marked "Does not block", but the answer changes what a reviewer accepts: 7,334 tick lines cost 1.5 MB (2.17%), which is the ~200 KB/year the plan estimates and is clearly fine. I'd resolve it in the plan rather than at implementation time, since an implementer reading "does not block" might drop the summary line and still claim compliance.

**The way to satisfy every gate and still be wrong:** gate `reportTick`'s held-slice block on a new `once` flag, ship it, watch the log drop to ~9.5 MB over the next week, and report the ceiling achieved — while `unclaimedLines` re-emits nine scratchpad worktree paths every 60 s under a comment promising it only happens on an unhealthy estate, and the held count that drives the counted summary keeps climbing past 233.

## 5. Strongest argument against doing this at all

**The log is diagnostic output on a gitignored file on one developer's machine, and the only thing it has cost anyone is disk.** No process reads it; the plan says so itself — the registrar rebuilds the list every tick, so the file is pure re-emission. 69 MB is roughly 0.007% of a 1 TB disk. Set against that: a change to the supervisor's reporting path, touching a function with an existing 60-line test block, to save a resource nobody is short of.

**And the sharper form of that argument:** the true fix for a runaway append-only log is rotation, which is a solved, generic, zero-risk problem — and the plan's stated reason for rejecting rotation ("launchd owns the write") **is factually wrong**, as measured above. The actual writer is a bash `>>` redirect. `logrotate` with `copytruncate`, or a two-line change to the loop, caps the file at any size you like, covers the desk lines and the tick lines and every future chatty line the daemon ever grows, and needs no test of the supervisor's semantics. The plan dismissed the general solution on a false premise and chose the specific one.

**What defeats this argument, and why I land on amend rather than reject:** the plan's independent reason is good and survives the false premise — *"a rotation on a noisy one is a second mechanism maintaining the first"*. Emitting 60 MB of lines nobody reads is a defect on its own terms, not merely a disk problem; the code and the skill both already promise this behaviour (§3), so this is honouring a documented contract rather than inventing a policy. And the daemon is now measured to write **~9.5 KB per tick, 208 branch names, growing**. Rotation would hide that, not fix it. The right answer is the plan's source fix **and** rotation as a genuine belt — but the plan rejects rotation for a reason that is not true, and that reasoning should be corrected before it becomes estate precedent.

## What I recommend amending

1. **Correct the launchd premise.** Measure who actually writes the file before shipping the claim. Either the unit is meant to be running and is not (a separate defect worth filing — the plist is loaded and never ran), or the constraint sentence should be struck. As written it is a false statement about this repo's own infrastructure, in the section that justifies the approach.
2. **Name the desk lines.** 11.5% of the file, ~8 MB, 6,413 repeats of one path, emitted under a comment (`registryd-main.ts:838-842`) asserting it is zero on a healthy estate. Either fold them into the slice or state explicitly that the log still grows after this lands, so the Changelog's "stops growing without bound" is not published as false.
3. **Fix the Done-when's (a) and (c).** Pin the *total* per-tick line count as bounded by a constant, not "bounded rather than proportional to the branches held" — the latter is satisfied by code that is still unbounded. And make the key-set gate assert no change rather than assert a property that already holds.
4. **Add the growth measurement** (`held=` 165→233 over seven days) to the Design. It is the fact that makes this worth doing now rather than never.
5. Refresh the line count (1,585,949) or state it as "measured at drafting".

The core defect is real, well-located, and the §3 documentation-vs-code finding is exactly right. The premise supporting the *approach* is not.

Verdict: amend
