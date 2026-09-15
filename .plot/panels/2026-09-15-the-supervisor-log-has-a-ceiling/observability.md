# The supervisor log has a ceiling — the observability lens

Juror lens: **removing output is cheap until someone needs it.** I measured the file, its line composition, who writes it, and what each class of line can answer that the counted line cannot.

## 1. Which factual claims hold

Measured 2026-09-15 on this machine, against `.plot/logs/registryd.log`.

| Plan's claim | Measured | Verdict |
|---|---|---|
| Size 69 MB | 69,525,296 bytes (66.3 MiB / 69.5 MB) | **TRUE** |
| Lines 1,527,602 | **1,585,949** | Stale, grew while drafting — direction and order right |
| Oldest entry 2026-09-08, 7 days | birth `2026-09-08 16:24`, mtime `2026-09-15 20:25` | **TRUE** |
| One branch repeated 7,086× | `feature/board-sync` appears **7,332×** | Understated; claim holds |
| `board.log` 16 KB | 16,745 bytes | **TRUE as a number** — see §1b |
| Registryd CPU 3 min 52 s over 3.5 days | Not re-measured; process restarted 2026-09-11 23:45 so the window is gone | **UNVERIFIED** |
| `.plot/logs/` gitignored | `.gitignore:77` → `.plot/logs/` | **TRUE** |
| plist sets `StandardOutPath` + `KeepAlive: true` | `com.plot-pm.registryd.plist:71-72` StandardOutPath, `:63` KeepAlive true | **TRUE of the file** |
| **"launchd owns the write"** | **FALSE for this machine** — see §1a | **FALSE** |

### 1a. The constraint the plan builds its argument on is not the one in force

The plan's central structural claim is *"The write is launchd's, not the program's — so nothing in the daemon can rotate a file it does not open, and a rotation script would be racing a writer that never closes its handle."*

**Nothing launchd started is writing this file.** Measured:

```
$ launchctl print gui/501/com.plot-pm.registryd
	active count = 0
	state = spawn scheduled
	path = /private/var/folders/.../plot-fleetctl-start-interrupted-gMWEKg/home/Library/LaunchAgents/
	       com.plot-pm.registryd.test-start-interrupted-53718.plist
	stdout path = /private/var/folders/.../plot-fleetctl-start-interrupted-gMWEKg/repo/.plot/logs/registryd.log
```

The only registered job is a **leftover from an interrupted `plot-fleetctl.sh --start` test fixture**, it points at a temp repo, its active count is 0, and its stdout path is not this file.

The real writer:

```
$ ps -o pid,ppid,lstart,command -p 91960
91960  1  Thu Sep 10 09:59:10 2026  bash -c while true; do
         node skills/plot/scripts/board/plot-registryd.mjs --start-agents
         >> .plot/logs/registryd.log 2>&1; sleep 45; done
```

A **hand-started bash `while true` loop with `>>`**, PPID 1, running since 2026-09-10 — and the child (PID 90426) restarted 2026-09-11 23:45.

Three consequences for the plan:

1. **The "rotation is impossible" argument is unfounded as stated.** A `>>` reopened per iteration by a 45-second bash loop is trivially rotatable — truncate between iterations and the next `>>` re-creates it. The plan's reason for rejecting the fallback dissolves on the machine it was measured on.
2. **The interval is 45 s + tick cost, not the 60 s the plist declares.** 7,334 ticks over 7 days is ~0.73/min, consistent with the bash loop, not with `--interval`.
3. **The `--start-agents` supervisor believed to be under launchd is not.** That is a separate, larger finding than the log: `plot-fleetctl.sh --status` would report this as loaded (it greps launchctl) while the actual supervisor is an orphan nobody's `--stop` can reach. That is the ticket's *second* half, which the plan explicitly scopes out — but the plan's own §"launchd owns the write" is the place it walks past the evidence.

The plan is right that *the file it measured* is not rotated. It is wrong about *why*, and the wrong why is what it uses to reject the alternative.

### 1b. `board.log` is not a control

The plan calls it *"the strongest evidence … Two long-lived daemons, one machine, one week."*

- `board.log` birth: **2026-09-11 22:34** — 3.5 days, not 7. Half the window.
- It has been **truncated/restarted**: `Plot board: http://localhost:7777` appears at line 1 *and* in the last three lines.
- Its content is a different kind: `auto-dispatch: machine reads tight (spawn cost 48.4 ms)` — event lines, no per-entity enumeration, and no queue to enumerate.

The comparison is between a daemon that enumerates a 200-element set every tick and one that has no set to enumerate. It is an illustration, not a control. **The diagnosis does not need it** (§2 carries it alone), so this is a claim to delete rather than a reason to reject.

## 2. The diagnosis is right, and it is sharper than the plan states

Line composition of all 1,585,949 lines:

| Class | Lines | Bytes | Share |
|---|---|---|---|
| Branch names under `held on …` | 1,525,556 | 59,761,006 | **86.0%** |
| Per-agent / unclaimed / hand-over detail (2-space) | 38,174 | 7,132,536 | 10.3% |
| `held on <hold> (N):` headers | 8,621 | 258,319 | 0.4% |
| `plot-registryd tick …` summary | 7,334 | 1,509,315 | 2.2% |
| `supervising …` banner | 9 | 738 | 0.001% |

**The diagnosis is confirmed: the per-branch lists are 86% of the file.** 208 branch lines per tick on average.

**And it is one hold, not the lists in general.** Splitting the 86% by which hold produced it:

| Hold | Lines | Bytes | Share of file |
|---|---|---|---|
| `not-claimable` | 1,524,184 | 59,701,346 | **85.9%** |
| `no-brief` | 1,585 | 67,996 | 0.098% |
| `no-free-agent` | 17 | 743 | 0.001% |
| `merge-unknown` | 2 | 104 | ~0 |
| `already-merged` | 1 | 52 | ~0 |

**`not-claimable` alone is 99.93% of all branch-list bytes.** The other four holds together produced **68,895 bytes over seven days** — 9.8 KB/day. They are already free.

That matters for the remedy and the plan does not see it: `not-claimable` is a hold over the *whole estate's* backlog (165→~200 branches, every branch no plan makes claimable), re-enumerated 7,333 times. The other four are holds over *the queue* — small, churning, and exactly what a debugger wants. The plan proposes to delete all five classes to fix one.

Secondary finding, not in the plan: the 10.3% "detail" class is also unbounded — `/private/tmp/plot-baseline (detached) — git worktree remove …` appears 2,539×, `.worktrees/free-b2023483` 6,413×. The `unclaimedLines` block at `registryd-main.ts:840` carries the same re-emission defect at 1/8th the volume, and `:836-839`'s comment justifies it with *"the unclaimed trees were twelve at their worst … so a looping daemon can name each one without ever writing a line nobody wants"* — which the 7.1 MB measured here falsifies.

## 3. The plan's strongest and least-acknowledged point

`packages/board/src/server/entry/registryd-main.ts:852-857`:

```
  // THE HELD SLICES ARE NAMED HERE AND NOWHERE ELSE. `--once` is the
  // operator's inspection path; the looping daemon prints the counts on its
  // summary line and stops there, because a tick every 60 s must not write 480
  // branch names to a log nobody is reading at the time.
```

`reportTick(report, write, warn)` — **`:824`, three parameters, no `once`.** The function has no way to know which path called it. The comment describes behaviour that was designed and never implemented, and the 69 MB is precisely the cost it predicted.

The plan says this ("documented behaviour the daemon is not following") and it is the best argument in the file. It is under-weighted relative to the launchd paragraph, which is wrong.

## 4. What the branch lists are FOR — the lens question

### Is the log a documented debugging path?

**Yes, in two places, and it is the only one named:**

- `skills/plot/scripts/plot-fleetctl.sh:509` — `--status` prints `log: $repo_root/.plot/logs/registryd.log` as the thing to go read.
- `skills/plot/units/README.md:57` — `tail -f .plot/logs/registryd.log     # the tick lines`

**And it has been used.** `.plot/panels/2026-09-15-the-tight-band-remembers-what-it-started/premise.md:45` and `docs/plans/2026-09-15-the-tight-band-remembers-what-it-started.md:181` both cite this file as evidence about who spawned 84 processes — two days ago, in this same panel round. The file is not write-only.

No test or script parses it. Nothing depends on its format. So the format is free to change; the *file* is a live debugging surface.

### What question needs a per-tick branch list?

Honest answer, and it cuts both ways:

**Questions the counted line already answers.** `not-claimable=165` → `167` → `521` → `166` is on `tickLine` (`registryd.ts:332`, all five holds every pass, `queue.ts:129` — *"a zero is a measurement"*). *How many were held, under which hold, at 03:14* needs no list. The `521` spikes I measured are visible in the counts alone.

**Questions that need the set, not the count.** *Which* branch entered or left a hold, and when. Measured over the log: **583 distinct branches ever appeared under `not-claimable`, 416 of them in fewer than 90% of ticks.** Some appear once (`bug/a-harness-this-machine-cannot-run-refuses`, 1 tick), some four times (`infra/the-supervisor-log-has-a-ceiling` — this plan's own branch, visible for 3 minutes). A count of 166 → 167 tells you one arrived; it cannot tell you which, and at 3am *which* is the whole question.

**So the lists do answer a real question — but `not-claimable`'s does not.** `not-claimable` is the estate's static backlog: 165 branches no plan makes claimable, mostly delivered work from months ago. Nobody debugs a fleet by asking which of 200 long-dead branches is still not claimable. The four *small* holds are the opposite: `no-brief` names 36 distinct branches over the week, each a slice that was *supposed* to dispatch and did not, and `no-free-agent` names 15 — every one of which is a slice that would have run if the fleet were bigger. **Those are the 3am lines.** They cost 68 KB/week.

### The 3am case the plan does not consider

Fleet misbehaving overnight, operator reads the log in the morning. With the plan as written — counts only, no lists — they see `no-brief=3` for forty ticks and cannot name a single one of the three. `--once` does not help: it reports the estate *now*, and by morning the three have been fixed, dispatched, or replaced. **The log is the only record of what the supervisor saw, and the plan's own Design says so implicitly** by calling `--once` the inspection path — `--once` cannot inspect the past.

`not-claimable`, by contrast, is reconstructible: it is a function of the plan estate, which is in git. Deleting its list loses nothing that `git log` plus `plot-fleet-scan.sh` cannot rebuild.

### Judging "the content is not state"

The plan says *"The registrar rebuilds the branch list every tick, so the whole file can be deleted without losing anything. It is a re-emission, not a record."*

**Half right, and the half it gets wrong is the half that matters.** A re-emission *of a derivable set* is not state — `not-claimable` qualifies, because the plan estate that produces it is version-controlled. A re-emission *of a transient set* IS a record: `no-brief` at 03:14 named three branches whose briefs were written by 09:00, and no re-derivation recovers that. The daemon holds nothing between ticks (`registryd-main.ts:777-780`, *"That is the whole of the daemon's state"*) — which means the log is the **only** persistence the supervisor has. Calling its output "not state" because the process is stateless inverts the argument: statelessness is exactly what makes the log load-bearing.

## 5. What `Done when` fails to pin

1. **Which lists go.** *"no per-branch list"* deletes all five holds' lists to fix one that is 99.93% of the cost. The gate as written forbids the cheap, useful four.
2. **The 10.3% detail class.** `unclaimedLines` re-emitted `/private/tmp/plot-baseline` 2,539× — 7.1 MB, same defect, explicitly out of the gate. A tick bounded on holds and unbounded on unclaimed trees still has no ceiling; the plan's title promises one.
3. **A ceiling is never actually pinned.** The gate says *"line count per tick is bounded rather than proportional to the branches held"* — that bounds a tick, not the file. 7,334 ticks × a bounded line is still monotone growth. Nothing in the plan stops the file reaching 69 MB again in 2027, and the title says "has a ceiling".
4. **How `--once` keeps its lists.** `reportTick` (`:824`) has no `once` parameter. *"`--once` output is byte-identical"* requires threading a flag through a signature the plan does not name, and every one of its eight existing test callers (`registryd-main.test.ts:313-358`) passes three arguments.
5. **No bound on the existing file, and no command.** *"the plan names the command rather than running it"* — I find no command named anywhere in the plan.
6. **`registryd.err` is unaddressed.** 0 bytes over 7 days with 7,334 ticks means no tick was ever incomplete — worth stating as the measurement it is, since the plan's *"a tick that cannot complete still reports its reason, unchanged"* gate has never fired in production.

## 6. Strongest argument against doing this at all

**The file is a symptom of an unsupervised supervisor, and fixing the symptom removes the evidence.**

The daemon writing 69 MB is a PPID-1 bash loop that no `plot-fleetctl.sh --stop` can reach, while the only launchd job registered is a temp-directory test leftover with `active count = 0`. That is a live process-control defect on the machine right now. The 69 MB log is currently the most visible symptom of it — *"seven days of growth took a person noticing a disk"*, as the plan says. Make the daemon quiet and the orphan becomes invisible: same wrong process, no longer announcing itself.

The plan scopes the `--stop` defect out as *"a separate defect with a separate cause"*. **It is not a separate cause.** Both are the same fact — this supervisor was not started the way Plot thinks it was. Shipping the quiet-daemon slice first fixes the disk and hides the fleet defect, and the ordering is the wrong way round.

This is an argument about **sequencing**, not about merit. The output genuinely is 86% waste and the code comment genuinely promises the fix. It does not reach `reject`.

## 7. What I would keep

Removing `not-claimable`'s list is right — 59.7 MB, statically derivable, nobody debugs with it.

Keep, in the looping daemon:

- **`no-brief`, `no-free-agent`, `already-merged`, `merge-unknown` lists in full.** 68.9 KB over seven days, 9.8 KB/day, ~3.5 MB/year. These are the only record of which slice was stuck when, and they are already free. A bounded summary is *not* enough here: the question is *which branch*, and a count cannot name one.
- **A count-only line for `not-claimable`**, which it already has on `tickLine`.
- **A change-log line where a list is suppressed**: `not-claimable 166 (+1 bug/x, -0)`. One line per tick, bounded by churn rather than by set size, and it answers the one question the list answered that the count cannot — measured at 416 branches churning across 583 distinct names, so the delta is small nearly always.

And the ceiling the title promises needs `plot-fleetctl.sh` to bound the file — trivially available, since the writer is `>>` from a restartable loop, not an unclosable launchd handle.

## Summary

The diagnosis is correct and better than the plan argues: 86% of the file is branch lists, and 99.93% of *that* is one hold. The code comment at `registryd-main.ts:852` describes the fix and `reportTick`'s signature proves it was never implemented. But the plan's structural premise — *launchd owns the write* — is false on this machine, its `board.log` control is not a control, its `Done when` deletes four useful lists to fix one wasteful one and leaves 7.1 MB of the same defect out of scope, and no gate actually bounds the file the title says gets a ceiling.

Amend: scope the removal to `not-claimable`, keep the four small holds, bring `unclaimedLines` into the gate, correct or drop the launchd and `board.log` paragraphs, name the `reportTick` signature change, and state a real ceiling.

Verdict: amend
