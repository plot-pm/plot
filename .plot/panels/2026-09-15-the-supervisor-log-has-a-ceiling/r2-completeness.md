# Round 2 — the completeness lens

My lens: round 1 found a second source the first draft missed. **Is there a third, and would the amended gates catch it?** Everything below I measured myself on 2026-09-15; commands are named. I did not take round 1's numbers on trust.

## 1. The amendment's new claims, re-measured

File at the time of my run: **69,593,397 B, 1,587,671 lines** (`stat -f %z`, `wc -l`) — it grew ~68 KB while I worked, so every number below is a snapshot of a moving file.

I classified **every** line by leading whitespace (`awk '{match($0,/^ */); print RLENGTH}'` → three levels only: 0, 2, 4) and by prefix. **The classification has no residual bucket** — my `OTHER` arm captured zero lines, so the six classes below are the whole file.

| Class | Lines | Bytes | Share |
|---|---:|---:|---:|
| 4sp branch lists | 1,527,187 | 59,825,651 | 85.96% |
| 2sp unclaimed-worktree paths | 36,884 | 7,088,592 | **10.19%** |
| 2sp `held on <hold> (N):` headers | 8,628 | 258,536 | 0.37% |
| `plot-registryd tick …` summary | 7,341 | 1,510,766 | 2.17% |
| `plot-registryd N worktrees …` header | 6,508 | 864,418 | 1.24% |
| 2sp agent-decision lines | 1,360 | 56,047 | 0.08% |
| `supervising …` banner | 9 | 738 | ~0 |

**Claim-by-claim:**

| Amended claim | Measured | Verdict |
|---|---|---|
| `unclaimedLines` is **10.26%** of bytes | **10.19%** of the paths alone; **11.43%** with its header | **TRUE** — round 1's 10.26% counted the whole 2-space class, which is 97% unclaimed paths but also contains 56 KB of agent-decision lines. The number is right to two figures for the wrong partition; the conclusion is unaffected |
| `unclaimedLines` = 38,174 lines / 7,132,536 B (plan:69) | **36,884 / 7,088,592** for the paths; 38,244 / 7,144,639 for the full 2-space class | **The plan's figure is the 2-space class, not `unclaimedLines`** — mislabelled, off by 1,360 lines. Immaterial to the argument, wrong as a citation |
| One worktree path repeated **6,413×** | `.worktrees/free-b2023483` → **6,420** | **TRUE** (grew by 7 during my run) |
| `/private/tmp/plot-baseline` 2,539× | **2,546** | **TRUE** |
| The four non-`not-claimable` holds are **small and churning** | Split the 4sp lists by their preceding header: `not-claimable` 1,525,582 lines / 59,756,756 B; `no-brief` 1,585 / 67,996; `no-free-agent` 17 / 743; `merge-unknown` 2 / 104; `already-merged` 1 / 52. **Four together = 68,895 B over 7.17 days = 9.4 KB/day.** Worst-case per-tick counts over 7,342 ticks: `no-brief` **4**, `no-free-agent` **2**, `merge-unknown` **1**, `already-merged` **1** | **TRUE, and stronger than stated** — `not-claimable` is 99.885% of all branch-list bytes |
| Who writes the file | `launchctl list \| grep plot` → `- 0 com.plot-pm.registryd` (never ran). `launchctl print` shows the only registered job points at a **temp test fixture** (`plot-fleetctl-start-interrupted-gMWEKg`), `active count = 0`. `lsof` on the log → **PID 90426** only. `ps -o command= -p 91960` → `bash -c while true; do node …plot-registryd.mjs --start-agents >> .plot/logs/registryd.log 2>&1; sleep 45; done`, PPID 1 | **The amendment is RIGHT** — launchd is not the writer; a detached bash `>>` loop is |
| *"documented behaviour the daemon is not following"* | `skills/plot-fleet/SKILL.md:88` verbatim: *"`--once` also names the branches under each hold; the looping daemon prints the counts and stops there."* `registryd-main.ts:824-828`: `reportTick(report, write, warn)` — **three parameters, no `once`**. `run` calls it identically at `:793` and only then branches at `:802` (`if (args.once) return code;`). Eleven test call sites at `registryd-main.test.ts:313-365`, all three-argument | **TRUE** — the strongest claim in the plan, and the distinction has no representation in code |

### Unverified, and I say so

- **`Rounds: 1`** in the front matter is now stale — this is round 2.
- **Registryd CPU 3 min 52 s over 3.5 days**: `ps` now reports **4:07.37 over `03-20:48:52`**. Same process, longer window; the plan's figure is a past reading I cannot re-derive.
- **"Oldest entry 2026-09-08 — 7 days"** is the file's **birth time**, not an entry's. `grep -c '2026-09' registryd.log` → **0**: the log carries **no timestamps on any line**. Correct for the growth argument, unverifiable from the file's contents, and worth one clause because it is the one number a reader cannot check.
- **Lines 1,527,602**: measured **1,587,671**. Stale by 60k, direction honest.

## 2. Is the remedy COMPLETE? — my lens

I enumerated **every** `write(`/`warn(` site in the daemon entry (`grep -n "write(\|warn("` over `registryd-main.ts`) and matched each to a measured class. There are seven emitters. Five are in `reportTick`; two are elsewhere.

| # | Emitter | Site | Per-tick cost is proportional to | Amendment covers it? |
|---|---|---|---|---|
| 1 | tick summary | `:833` | **nothing** — 206 B, stable (measured at ticks 1/1001/…/7001: 194, 207, 206, 206, 206, 206, 206) | kept, correctly |
| 2 | agent supervision | `:836` | **agents** — max 5 lines/tick observed | untouched, and fine |
| 3 | `unclaimedLines` | `:843` | **undispatched worktrees** | **YES — this is the amendment's second fix** |
| 4 | hand-over | `:848` | assignments — 1,360 lines total | untouched, fine |
| 5 | held headers | `:863` | **holds present** — ≤5/tick | kept, correctly |
| 6 | held branch lists | `:864` | **the estate** | **YES — the amendment's first fix** |
| 7 | **manifest parse warn** | **`:205`** | **the agent registry, per tick** | **NO — named by neither round** |

### The third re-emitter: `registryd-main.ts:205`

```ts
warn(`plot-registryd: ${name} is not a manifest this parse understands — skipped\n`);
```

Inside `readRegistry`'s `for (const name of names)` loop, which **runs every tick** (`:781`, `registry: () => readRegistry(registryDir, warn)`). One line **per unparseable manifest per tick**, forever, for as long as the file sits in `.plot/agents/`.

**It reaches this log.** The bash loop redirects `2>&1`, so stderr and stdout land in the same file. It is not hypothetical-only: `com.plot-pm.registryd.plist:71,73` routes `StandardOutPath` and `StandardErrorPath` to two files, and the systemd unit sends both to `journal` — so under the units it lands in `registryd.err` instead, which is the same defect in a different file.

**It has never fired here** — `grep -c "is not a manifest this parse understands"` → **0**, `registryd.err` is **0 bytes**, and the registry holds 2 entries. So it is **latent, not active**. I report it as the third class rather than as a second leak: it is the same shape as the two the plan fixes (a set re-enumerated per tick with no bound), it is in the same function family, and **the amendment's gates as written would not catch it** — see §3.

**Everything else is proportionality-checked and clean.** Emitters 1, 2, 4, 5 are bounded by agents, assignments and the five-element `QUEUE_HOLDS` constant. I found no fourth.

### The completeness finding that matters more than the third emitter

**The amendment scopes the removal to `not-claimable` on an empirical measurement that is true today and is not structurally guaranteed.** `packages/domain/src/rules/queue.ts:205-209`:

```ts
export const whyNotReady = (slice: QueuedSlice): QueueHold | null => {
  if (slice.landed === 'landed') return 'already-merged';
  if (slice.landed === 'unknown') return 'merge-unknown';
  if (isHandOverReady(slice)) return null;
  return slice.claimable ? 'no-brief' : 'not-claimable';
};
```

Five holds **partition one set** — the whole queue. `no-brief` and `not-claimable` are the two arms of a single `if`. Nothing bounds `no-brief`; it is small only because most of this estate's branches are not claimable. And **`merge-unknown` is the sharp case**: `landed()` (`packages/domain/src/rules/landed.ts:60-68`) returns `unknown` whenever the host *could not be asked*, and the docstring at `queue.ts:117-124` says so explicitly. A host outage makes **every** slice `unknown`, and `merge-unknown` is tested **second — before the claimable split**.

**So on a GitHub outage the entire queue moves into a hold the amendment keeps listed in full.** Measured worst case on this estate: `not-claimable=574` at one tick, `held=574` (53 ticks exceeded 400). That is **574 branch lines per tick** under `merge-unknown` — reproducing the exact defect the plan exists to fix, in a class the plan deliberately preserves, on the day the host is down and someone is reading the log.

This does not overturn the scoping — the amendment's *reasoning* (the four are the queue's own holds and are what a debugger reads) is right, and `skills/plot-fleet/SKILL.md:88`'s own example shows `already-merged=11`, higher than anything in this log. **The fix is not to delete the four. It is to bound them**: cap any list at N branches and print `… and 570 more` — which keeps every 3am name in the cases that matter and cannot blow up in the case that does.

## 3. Does the amended `Done when` actually bound the output?

**No. It bounds a tick's shape; it does not bound the file — and the title says "has a ceiling".**

The central gate is *"a looping tick's output is bounded rather than proportional to the estate, pinned by a test that grows the held-branch count and asserts the line count does not follow."*

**(a) As a test it is well-formed** — better than round 1's version. `reportTick` is exported, pure over a `TickReport`, and already has eleven fixture-driven call sites at `registryd-main.test.ts:313-365`. Growing `report.handOver.detail.held` and asserting the line count is unchanged is a two-line test. **This one is real.**

**(b) It does NOT catch the `unclaimedLines` leak, and the amendment knows it** — which is why that is pinned separately. Correct as written. Note the separate pin must grow `report.decision.detail.unclaimed`, a different field; the amendment says "bounded by the same rule" without naming the field, and an implementer could read "the same rule" as "the same test".

**(c) It does not catch emitter #7.** The manifest warn is in `readRegistry`, not `reportTick`; no test over `reportTick`'s fixtures can reach it.

**(d) Nothing gates the file.** Here is the arithmetic, and it is the finding I would not let through. Per-tick bytes on the last tick, measured by class:

```
tick-summary       207 B
unclaimed-header   148 B
unclaimed-paths  1,705 B  (9 paths)
held-header         31 B
branch-list      9,235 B  (233 branches)
supervision         24 B
                --------
                11,350 B/tick  ->  11.1 MB/day at 1,024 ticks/day
```

After **both** amendment fixes land, the residual is summary + header + supervision = **262 B/tick**:

> **262 B × 1,024 ticks/day × 365 = 93 MB/year.**

**That is larger than the 69 MB this plan was filed about.** Plus the four kept hold lists at 9.4 KB/day (3.3 MB/year) — and, on a host outage, `merge-unknown` at up to 574 lines/tick.

So an implementation satisfying every gate ships a log that reaches the filed size in **nine months**, and the Changelog's *"The supervisor's log stops growing without bound"* would be **published as false**. A monotone file with a bounded per-line cost is still unbounded. **`Done when` needs a gate on the file, not only on the tick** — and the amendment's own §"Rotation is possible" correction makes that cheap, since the writer is a restartable `>>` loop, not an unclosable handle.

**(e) `--once` byte-identical is still untestable against a live estate.** `--once` output carries `cost=NNNNms` (measured 6,152–34,520 ms across the file) and a live `held=`. It can only mean *identical for a fixed fixture*. Say so, or an implementer will diff two live runs and find them different for the right reason.

**(f) The key-set assertion passes today and pins nothing.** `tickLine` (`registryd.ts:330-331`) emits all five `QUEUE_HOLDS` keys unconditionally inside `if (report.handOver !== null)`. A gate green before the diff is not a gate; it should assert *unchanged by this diff*.

## 4. How to satisfy every gate and still leave the log growing

Three routes, in order of likelihood:

1. **Do exactly what is asked.** Gate the held lists and `unclaimedLines` on `once`. Every gate green, `--once` unchanged, keys intact. The log drops from 11.1 MB/day to ~270 KB/day and **grows to 93 MB/year forever**. This is not a loophole — it is the plan's own remedy, and the title still promises a ceiling it does not deliver. **This is the likeliest outcome and the reason I cannot vote proceed.**
2. **Bound the held lists only by branch count.** The gate says *"the line count does not follow"* the **held-branch** count. An implementation that caps the list at, say, 50 passes — and `unclaimedLines` (9 paths, 1,705 B/tick, growing 0→9 over the week) is bounded by *worktrees*, not branches. The separate pin covers this only if it grows the `unclaimed` field; if the implementer reuses the held fixture, both gates pass and the second leak survives.
3. **Leave `merge-unknown` unbounded** (§2). Every gate green until the host has an outage, then 574 lines/tick from a class the plan explicitly protected.

## 5. Strongest argument against doing this at all

**The residual makes the source fix insufficient on its own terms, and rotation — now known to be available — is sufficient on its own.**

The amendment concedes the load-bearing premise was false: launchd does not own the write, so rotation was never impossible. It then keeps the same conclusion on a new argument — *"a quieter tick needs no second mechanism."* **My arithmetic in §3(d) breaks that argument.** A quieter tick still writes 93 MB/year, so it does need a second mechanism; it just needs it less often. Meanwhile rotation on the actual writer is two lines in a restartable bash loop, covers all seven emitters including the latent one, covers `merge-unknown`'s outage case, covers every chatty line the daemon grows in 2027, and needs no test of the supervisor's semantics.

**What defeats the argument, and why I land on amend rather than reject:** emitting 60 MB of lines nobody reads is a defect on its own terms, and `SKILL.md:88` plus `registryd-main.ts:850-853` both already promise this exact behaviour against a `reportTick` signature that cannot express it. That is a documented contract the code does not honour, and rotation would hide it rather than fix it. **The right answer is both** — and the amendment has removed the only stated reason for not saying so.

## What I would amend

1. **State the residual, or gate the file.** 262 B/tick = 93 MB/year is the number that decides whether the title is honest. Either add a ceiling gate on the file, or amend the Changelog so *"stops growing without bound"* is not published as false.
2. **Bound the four kept hold lists rather than exempting them** — `merge-unknown` takes the whole queue on a host outage (`queue.ts:207`, `landed.ts:60-68`), measured worst case 574. A cap with `… and N more` keeps every 3am name and cannot blow up.
3. **Name emitter #7** (`registryd-main.ts:205`) — per-manifest-per-tick, latent at 0 today, reaches this file via `2>&1` and `registryd.err` under the units. One sentence; it is the third class my lens was sent to find.
4. **Fix the `unclaimedLines` citation** — the plan's 38,174 / 7,132,536 is the whole 2-space class; `unclaimedLines` is 36,884 / 7,088,592, and the remaining 1,360 lines are agent-decision lines from `:836`.
5. **Say "fixture-identical", not "byte-identical"** for `--once`, and make the key-set gate assert *unchanged*, not *present*.
6. Refresh `Rounds: 1` → 2; mark the line count as measured-at-drafting; add one clause that the 7-day figure is the file's birth time because the log carries no timestamps.

**Plainly: the amendment is not complete.** It carries all four round-1 corrections faithfully, its measurements are true where I could check them, and its scoping judgement is empirically sound. But there is a third emitter, the kept classes have an unbounded case, and — the finding I weight highest — **the amended gates leave the file growing at 93 MB/year while the plan is titled "has a ceiling".**

Verdict: amend
