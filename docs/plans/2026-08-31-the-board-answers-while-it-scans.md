# The board answers while it scans

> The board stops serving for seconds at a time, at zero CPU, while something it
> is waiting on has not come back. **This plan finds out what** — it ships the
> probe, not the fix. Two causes have already been named from reading the source
> and refuted by measuring; the leading measured candidate is `pr-list --rich`,
> 22 s of wall clock for 0.22 s of CPU.

<!--
THE SUBTITLE HAS BEEN WRONG ONCE, AND THE CORRECTION IS THE POINT. It read "the
board recomposes the whole fleet document on every streamed scan line, on the
thread that answers HTTP" — a reading of the code, not of the data. The probe's
own 238 samples then showed stalls are three times MORE likely with NO scan
running (23% against 8%). See ## Notes for that and for everything else ruled
out with a measurement. A plan whose headline states a refuted cause is worse
than one with no headline: it is the sentence a reader carries away.
-->

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- The board can say what blocked it: a flag-gated probe records event-loop
  stalls together with the async resource in flight when each began, so a stall
  is attributable to a named call instead of guessed at from the source.

Board impact: this IS the board. `packages/board/src/server/fleet.ts` only; the
plan format, the template, the helper scripts and the `docs/plans` layout are
untouched. The artifact needs rebuilding (`pnpm build:board`).

## Motivation

The board periodically shows *"No contact with the board server for N polls"*,
dims its controls, and then recovers on its own. Measured 2026-08-31.

**It is not a leak and not a crash.** RSS is flat at 360–387 MB across 78
samples, 2 plot processes, 37 FDs, and the process never dies.

**"THE PROCESS NEVER DIES" IS NO LONGER TRUE. Measured 2026-08-31 20:47.**
Probed directly, three consecutive requests to `/api/board` timed out at 15 s,
and so did a request for `/` — a STATIC FILE. The next request for `/` was
refused in **0.0002 s**, and `ps` then showed the pid gone: the board had died
between two probes.

```
/api/board  http=000  15.004s
/api/board  http=000  15.003s
/            http=000  15.006s   <- a static file, so the loop is wedged
/            http=000  0.0002s   <- connection refused: the listener is gone
```

**This is a different failure from the one this plan describes**, and the
distinction matters for the probe:

| | the stall this plan measured | what happened at 20:47 |
|---|---|---|
| duration | 1.5–5 s bursts | ≥15 s, then death |
| recovery | on its own | needed a human restart |
| the process | alive throughout | **gone** |

`node --watch` did not restart it — the watcher (pid 69580) was still running
five hours later with no child, so a death that is not a file change leaves the
board simply absent. It took an operator noticing.

**What this does NOT establish:** that the stalls and the death share a cause.
A wedged loop that eventually dies is one story; a stall that recovers and a
separate fatal event are another, and one sample cannot tell them apart. But the
probe must now record **whether the process survived**, because a diagnostic
that assumes its subject is alive will simply stop producing data at the moment
the worst outcome occurs.

**The discriminating measurement** — six requests for `/`, a STATIC FILE, back
to back:

```
3630ms   2ms   1.7ms   1.5ms   1.4ms   1.5ms
```

The first waits 3.6 s; the rest answer in ~1.5 ms. **A static file cannot wait
on a fleet scan** — it waits on the event loop. So the board is not slow; it is
periodically *blocked*, and everything arriving in that window queues behind it.

> **THIS PREMISE DID NOT SURVIVE A QUIET MACHINE, 2026-08-31 21:19.** With load
> at **3.08** and zero test processes, zero agents — the quietest reading this
> investigation ever took — the same two measurements diverge completely:
>
> ```
> /           1.6ms   1.4ms   1.5ms      ← static, never slow
> /api/board  1.3s    6.7s    1.2s       ← same server, same minute
> /api/board  1.3s  4.5s  6.2s  1.2s  3.1s  4.4s
> /api/fleet  3.8s  5.0s  3.7s
> ```
>
> **The static file is fast while the API is slow.** The event loop is therefore
> NOT blocked — a blocked loop cannot serve `/` in 1.5 ms. The 3630 ms static
> read above was taken under load and measured the machine, not the loop.
>
> **What is actually there is two costs on `/api/board`:** a floor of ~1.2 s even
> at its fastest, and a spike to 4–6 s with no visible pattern — plausibly a
> cache hit versus a recomputation, which the probe can settle. `/api/fleet` sits
> at 3.7–5.0 s and never gets below the client's 5 s poll, which is the whole of
> why the Agents tab shows *Loading…* forever.
>
> The Motivation below is left as written because it records what was measured at
> the time and how it was read. It is wrong, and the correction belongs beside it
> rather than in place of it.

Sampling `/` once a second for 40 s gives the shape:

- blocks of **1.5–5 s**, arriving every **~8 s**
- a two-stage pattern: a long block, then a shorter one ~2 s later
- unblocked roughly 60–70 % of the time

The browser overlay follows mechanically: the client polls on a timer, lands in
blocked windows repeatedly, and after enough consecutive timeouts declares no
contact. It recovers because nothing was ever broken.

**A sampling artifact to avoid repeating.** A 5-second probe reported a "2571 ms
average response". That average is an artifact of landing inside blocks — it
describes the sampler, not the server. Measure with back-to-back requests.

**AND A CONTAMINATION TO EXCLUDE, measured 2026-08-31 20:03.** Two blackouts in
two minutes coincided with three rescue agents running full test suites in
parallel worktrees: load average **3.79**, a 35-minute vitest, four
`node --test --test-concurrency=4` processes, a `plot-fleet-scan.sh --stream`,
and a `plot-host.sh pr-list --rich` of their own.

Those samples are **not evidence about the board**. The agents compete for the
same cores AND for the same rate-limited GitHub endpoint the board polls, so an
outage during them measures the machine, not the defect.

**The probe branch must record enough to tell the two apart** — load average and
sibling `plot-*` process count at the moment of a stall, not just the board's own
`children` and `cpu`. Without that, a future reader cannot know which samples in
the log were taken on a quiet machine, and the honest ones get averaged together
with the contaminated ones. That is the same failure as the "2571 ms average"
above, one level out.

## Design

### What the cause is NOT

**The streamed scan is not the blocker, and this plan first said it was.**
Corrected 2026-08-31 from the probe's own data, 238 samples:

| | slow (>3.5 s) | total | rate |
|---|---|---|---|
| no scan running | 12 | 53 | **23 %** |
| scan running | 15 | 185 | **8 %** |

The board is **three times more likely to stall when no scan is running**. The
first version of this plan named `publishPartial()` — which recomposes the whole
fleet document on every arriving scan line — as the cause. That code is still a
real inefficiency and worth fixing, but it cannot be this, because the stalls
concentrate where it does not run.

**Memory does not predict a slow SAMPLE** — slow samples average 381 MB RSS,
fast ones 380 MB — but **it does grow, and the growth is steep.**

Corrected 2026-08-31: a restart put RSS at **80 MB**, against **419 MB** on the
process it replaced after 1h38m, and the fresh process reached **222 MB within
one minute**. The earlier "RSS is flat" reading was taken over one-minute
windows and measured a plateau, not a trend.

So memory is not what makes any single request slow, and it is still a real
growth to explain. The two questions are separate and both open.

So what is measured and certain is the SYMPTOM: the event loop is blocked in
bursts of 1.5–5 s, roughly every 8 s, and a static file is as slow as an API
route during one. What blocks it is **not yet identified**.

### The second outage: a host call, not a scan

**15:55:34, `http=000` after 4864 ms** — and the sample rules the scan out
completely:

```
cpu=0.0   children=4   scan=no
```

`ps` on those children during the outage:

```
72575  bash plot-fleet-scan.sh --stream        40s
81613  bash plot-host.sh pr-list --rich ...    22s
96255  (bash)                                  <- zombie
```

**`plot-host.sh pr-list` measures 10.4 s and 11.2 s** run directly, twice, and
GitHub is **not** rate limiting (graphql 5000/5000). That is simply what the
call costs against this repo's PR volume, and it runs on the 60 s
`PR_REFRESH_MS` timer.

**But `refreshPrs` is properly async** — `await run('bash', …)` behind
`setInterval(() => void maybeRefreshPrs(…))`. So the host call does not block
the loop by itself, and "single-threaded, therefore blocked" is too quick an
explanation. It is discarded here rather than left implied.

**What is established:** during an outage the board has zero CPU, several
long-lived children, at least one zombie, and no scan running. It is waiting on
child processes. **Which await is not yielding is still open.**

### The growth, measured from a clean start

A restart gave the cleanest reading available: one process, watched from its
first second.

| | RSS |
|---|---|
| at start | **78 MB** |
| 55 samples later (~5 min) | **336 MB** |
| the process it replaced, after 1h38m | **419 MB** |

**4x in five minutes**, then flattening toward ~420 MB. That is why the earlier
one-minute windows read as "flat": they sampled the plateau, not the climb.

13 % of those 55 samples were slow (>3.5 s), so the board is degraded from early
in its life rather than only after hours.

**Two questions, still separate.** Memory does not predict a slow SAMPLE
(381 MB slow vs 380 MB fast, measured over 238 samples of the previous
process). But something retains, and the first outage sample showed
`plot-plan-meta.sh` churning with unreaped zombies — a plausible shared cause
for both, and not yet established as one.

### What the first outage sample says

**Measured 2026-08-31 15:41:42, the first UNREACHABLE sample** (not merely
slow — `http=000` after a 10 s budget, and still dead 15 s later):

```
pid=99533  rss=416752KB  cpu=0.0  children=2  scan=yes
```

**`cpu=0.0` while unreachable.** The board was not computing; it was WAITING.
That rules out a synchronous compute burst — including `publishPartial()`, this
plan's original suspect — and points at process I/O.

`ps` on its descendants during the outage:

```
71884  <defunct>
74127  <defunct>
75143  bash .../plot-plan-meta.sh /var/folders/g0/...
```

**Two zombies and a live `plot-plan-meta.sh`.** Sampled every 2 s, the pattern
holds: a continuous churn of `plot-plan-meta.sh` spawns with unreaped children.

That is one process **per plan file**, which is precisely what
`packages/board/test/plan-read-shape.test.mjs` forbids for the estate read —
*"spawns plot-plan-meta.sh ONCE for the whole estate"*, whose own comment prices
the alternative at **~8 s on this repo's estate**.

So the next question is narrow: **which board path spawns `plot-plan-meta.sh`
per file, and why is the contract test not catching it?** The test covers
`/api/board`; something else on the refresh path evidently does not go through
the batched read.

### The floor is 8 s, and an earlier reading of "it degrades" did not hold

**Measured 2026-08-31 20:50, four back-to-back requests to `/api/fleet`:**

```
200  7.636s
200  11.356s
200  12.971s
200  16.211s
```

**Monotonic. Every request slower than the one before, and no recovery.** A
stall recovers to baseline between bursts; this does not. Beside it, RSS on a
process restarted minutes earlier went **112 MB → 300 MB in under two minutes**,
and the sequence ended in an `UNREACHABLE`.

**The shape is a queue draining slower than it fills.** `/api/fleet` takes ~6.6 s
while the client polls every **5 s**, so each request arrives before the last
one finished. Work accumulates: more pending requests, more retained memory,
slower responses, more overlap. A positive feedback loop, and it ends where the
board ended at 20:47 — wedged, then dead.

**THIS REFRAMES THE WHOLE PLAN.** The "1.5–5 s bursts every ~8 s" recorded in the
Motivation is not the disease. It is what this loop looks like EARLY, sampled at
5 s. The sampler's own cadence is close enough to the poll interval to alias the
degradation into something that reads as periodic.

It also explains the intermittency without invoking GitHub's cache: **once a
response time crosses the poll interval, the loop is self-sustaining** until
something breaks it. A quiet estate has responses under 5 s and never enters it;
a busy one crosses over and cannot get back out.

**THE PREDICTION WAS TESTED WITHIN THE HOUR, AND IT FAILED. 2026-08-31 20:53.**

Eight leftover processes were killed — two vitest runs asleep at 0 % CPU for 33
and 47 minutes, two build shells, an orphaned board server holding 135 MB, and a
five-hour watcher with no child. Load fell from 6.03 to 4.55. The same four
back-to-back requests then ran:

```
200  17.355s
200  12.044s
200   8.590s
200   8.279s
```

**Descending.** The feedback-loop reading predicted the opposite: work
accumulating faster than it drains gets worse under back-to-back load, not
better. It recovers toward a floor instead.

**So the direction of the first run was LOAD, not a self-sustaining loop.** The
hung suites were inflating it, and the ascending sequence measured the machine
rather than the board. That is the third cause this plan has named and the third
it has had to withdraw.

**What survives the correction, and it is the useful half:** the floor is about
**8 seconds**, against a client that polls every **5 s**. A response slower than
the poll is enough on its own to explain the Agents tab never rendering — every
request is superseded before it lands, and that tab has no frozen payload to
fall back on the way the Plans tab does. No feedback loop is required for that;
one slow endpoint is sufficient.

**And the question narrows to the floor.** Not *"why does it degrade?"* — it
does not — but *"why does one `/api/fleet` cost 8 s?"*

**"ON A QUIET MACHINE" IS A PHRASE NO MEASUREMENT HERE HAS EARNED, and an
earlier draft of this very sentence claimed it.** The 8 s floor was measured at
load **4.55** — not quiet, merely quieter than the 6.03 before it. Tabulating
every observation in this plan against what else was running:

| observed | load | what else was running |
|---|---|---|
| the 22 s `pr-list --rich` | — | three rescue agents' suites |
| the 7.6 → 16.2 s "degradation" | 6.03 | two hung vitest runs, four test shells |
| the 8 s floor | 4.55 | the same agents, after cleanup |
| a blackout at 21:06 | **8.69** | 17 `node --test` processes |

**Not one was taken on an idle machine.** So the leading explanation is now the
least interesting one: **the board is starved by the fleet's own testing.**
Three of this repo's suites take 5–10 minutes and spawn dozens of processes; a
dispatched agent runs them by design, and several agents run at once.

**This does not retire the host findings** — a 22 s `pr-list --rich` is real and
costs what it costs. It **reorders** them: contention is the first candidate,
and the per-call cost is what leaves the board unable to absorb it.

**What is still missing is a reading with nothing else running at all.** Until
that exists, every number in this plan is an upper bound of unknown tightness —
which is why the probe must record load and sibling process count beside each
sample, or it will produce more of the same.

**What it does not explain:** why one `/api/fleet` costs 6.6 s in the first
place. The loop amplifies that cost; it does not create it. The host findings
below remain the candidates for the baseline, and the probe is still what
settles them.

### THE BLOCKER, NAMED BY A STACK — 2026-08-31 21:36

**`node::SyncProcessRunner::Spawn`, on the main thread, inside an HTTP request
handler.** That is `execFileSync`/`spawnSync`.

Captured with `sample <pid> 5` while the board was refusing every request. The
main thread, **4258 of 4262 samples**:

```
node::SpinEventLoopInternal
 uv_run → uv__io_poll → uv__stream_io
  node::http_parser::Parser::on_headers_complete()
   v8::Function::Call  →  Builtins_JSEntry
    …  (the request handler)
     Builtins_CallApiCallbackOptimizedNoProfiling
      node::SyncProcessRunner::Spawn        ← A SYNCHRONOUS CHILD PROCESS
```

**A synchronous spawn cannot yield.** While it runs, the event loop serves
nothing — which is why a static file times out at 15 s beside it.

**IT EXPLAINS EVERY CONTRADICTORY READING IN THIS PLAN**, and that is why it is
credible where three earlier explanations were not:

| observation | why it followed |
|---|---|
| `cpu=0.0` during an outage | the parent blocks in `waitpid`; the CHILD burns the CPU |
| `children=0` in one sample | sampled between two spawns |
| `/` at 1.5 ms, then 15 s | whether a spawn was in flight at that instant |
| worse under load | the child competes for the cores its parent is blocking on |
| stalls with no scan running | these spawns are on the REQUEST path, not the scan's |

**Everything above this section reasoned about ASYNC host calls**, because
`refreshPrs` is properly `await`ed and that was the visible cost. The blocking
call was never in the fleet path at all.

**The population is already counted, in this repo's own words.** CLAUDE.md:
*"`packages/board/src` holds 65 `spawn`/`execFile` lines across 23 files, and CI
has zero path references to it."* Measured now: **53** `execFileSync`/`spawnSync`
occurrences under `packages/board/src`, with `board.ts` — which serves
`/api/board` — carrying five.

**What this does NOT settle:** which specific call sites are reached per
request, and how often. The stack proves one is; `board.ts:114`, `:419` and
`:447` are the candidates on that path. The probe branch now has a named
function to instrument rather than an event loop to characterise.

**And it changes the fix.** Not "make the host call cheaper" but **"stop
spawning synchronously on the request path"** — which is the same boundary
`the-sprint-proves-its-own-goal` wants to ratchet and `production-calls` wants
to migrate. This is that work's motivating measurement.

### Approach — find the blocker before fixing one

The static-file measurement bounds the search: whatever runs **owns the loop and
does not yield**, in bursts, and is not the scan.

**Not necessarily synchronous JS, and the distinction decides where to look.**
An earlier draft said "synchronous on the main thread", which reads as a compute
burst — and `cpu=0.0` during every outage rules a compute burst out. Both
readings are measured, so the wording has to hold both: something owns the loop
(the static file proves it) while burning no CPU (the sampler proves it). That
leaves a blocking SYSCALL or a starved loop, not JS arithmetic. Candidates, in the order they
can be cheaply ruled out:

1. **The PR refresh** (`PR_REFRESH_MS`, 60 s) and whatever it does with the
   host's answer — a 60 s timer cannot produce an 8 s period, but its
   *processing* may be one of two interleaved sources.
2. **The registry / manifest read** — per-agent file reads on every pulse.
3. **Anything the board derives per request** rather than per refresh.

**The first branch is instrumentation, not a fix.** This plan asked for a fix
before it had a measurement, which is how it got the cause wrong.

**`monitorEventLoopDelay` ALONE CANNOT SATISFY `Done when`.** It reports THAT
the loop stalled and for how long — it does not report WHAT stalled it, and a
stall at `cpu=0.0` leaves no JS frame to sample, so a CPU profiler comes back
empty on exactly the samples that matter. A histogram plus the existing
`children`/`scan`/`cpu` sampling would give correlation; `Done when` asks for
attribution to a **named call**, which is a stronger claim.

**So the probe tracks async RESOURCES, not just loop delay.** `async_hooks`
records each resource's `init` (with its creation stack) and its `before`/`after`
transitions, so a resource that entered `before` and has not reached `after` when
the stall begins is a named, stack-carrying suspect:

```js
const inFlight = new Map();
async_hooks.createHook({
  init(id, type)  { created.set(id, { type, stack: new Error().stack }); },
  before(id)      { inFlight.set(id, { ...created.get(id), at: now() }); },
  after(id)       { const r = inFlight.get(id);
                    if (r && now() - r.at > STALL_MS) record(r);
                    inFlight.delete(id); },
}).enable();
```

**What this costs, and why it is still the right trade.** `async_hooks` has real
overhead — it fires on every async resource, and capturing a stack in `init` is
the expensive part. Two consequences the branch must handle rather than discover:

- **It is a diagnostic, not a permanent default.** Behind a flag, off unless
  asked for. A probe that slows the thing it measures changes the measurement.
- **`init` stacks must be capturable cheaply or lazily** — capture the stack only
  for resource types worth naming (process spawns, file ops, host calls), not for
  every timer and promise the server creates.

The alternative — hand-timing the dozen known `await` sites — was considered and
rejected as the *primary* mechanism: it can only ever name a call somebody
already suspected, and this plan's whole history is being wrong about which call
to suspect. It remains a fine *supplement* once the probe narrows the field.


Publish on a **schedule**, not per line. Accumulate arriving plans and compose
at most once per interval (and once on the terminal line), so the number of
recompositions stops scaling with the number of plans.

Two properties the current code establishes and this must not lose:

- `pulseComplete` stays false for every partial, so a consumer can tell a
  partial from a finished answer
- `summary` is RECOUNTED from the plans actually present, never carried over —
  a summary describing 24 plans beside 3 plan rows is a measurement of one
  document presented as a measurement of another

### Open Questions

- [ ] What publish interval? It must be short enough that the board still reads
      as streaming and long enough that recomposition stops dominating. The scan
      runs ~18 s and the client polls at 5 s, so the answer is bounded by both.
- [ ] Is composition itself worth making incremental (a keyed map rather than
      filter-and-concat), or does batching alone bring the block under the
      threshold? Measure before adding the complexity.

## Branches

### Measuring

- `bug/the-board-times-its-own-loop` — an event-loop lag probe in the server
  that records the stall AND what was running when it began. This is the whole
  first branch, and it comes first because the plan's original cause was wrong
  and only a measurement would have caught that.

<!--
THE ANSWERING WAVE WAS REMOVED, and the removal is the decision.

It read: `deferred: named once the probe says what blocks`. That is honest, and
it still leaves one plan spanning two questions with different evidence — a
diagnosis that can finish, and a fix that cannot even be NAMED until it does.
Such a plan can never be delivered: `/plot-deliver` gates on every non-deferred
branch being merged, and a branch nobody can name is a branch nobody can merge,
so the deferral would have to be renewed indefinitely.

So this plan is now the DIAGNOSIS ONLY, and it can finish. The probe is a real
deliverable on its own merit — a permanent, flag-gated diagnostic the board
keeps, useful the next time it stalls for a different reason.

The fix gets its own plan, opened AFTER the probe reports and NAMED FOR THE
ACTUAL CAUSE. That ordering is this plan's own lesson applied to its own shape:
it named a cause twice from reading and was wrong twice, so it will not name a
third one in advance.
-->

## Done when

- The server records event-loop stalls with what was running at their start, and
  a stall of >1 s is attributable to a named call rather than inferred.
- The 8 s period and the 1.5–5 s duration are explained by that record — or
  shown to be something else, in which case this plan is corrected again.
- The probe is **off by default and flag-gated**, so a board nobody is
  debugging pays nothing for it — and the flag's own overhead is measured, not
  assumed.
- `pnpm build:board`, `pnpm run test:board`, `pnpm run typecheck`, changeset.

**THE FIX IS NOT IN THIS LIST, deliberately.** `/` answering in tens of
milliseconds under load is the goal of the plan that FOLLOWS this one, opened
once the probe has named the cause. Keeping it here would make this plan
undeliverable until a branch nobody can name yet is merged.

## Notes

**This plan named the wrong cause once.** Its first version blamed
`publishPartial()`'s per-line recomposition, which was a reading of the code
rather than of the data. The probe's own samples then showed stalls are three
times MORE likely when no scan is running. The measurements were right and the
inference was wrong — which is why the first branch is now a probe.

Ruled out, with measurements, so they are not re-investigated:

- **memory, process and FD leaks** — RSS flat over 78 samples; 2 plot processes;
  37 FDs
- **`execFileSync('git', ['worktree', 'list'])` and `git branch --show-current`
  in `fleet.ts`** — both measure 0.00 s against 21 worktrees
- **the 5 s scan timer and the 60 s PR timer** — the observed period is ~8 s,
  which is neither
- **the streamed scan itself** — stalls are 23 % of samples with no scan running
  against 8 % with one (238 samples)
- **memory pressure** — slow samples average 381 MB RSS, fast ones 380 MB
- **the synchronous plan-directory walk in `board.ts`** — `readdirSync` over
  `active/`, `delivered/` and the plan root, then `realpathSync` + `statSync`
  per `.md` entry. **6.6 ms for 360 files**, warm cache. Three orders of
  magnitude short of a 1.5–5 s stall.

  **It is listed because of how convincing it was, not because it was close.**
  It fits every bound this plan states: synchronous, `cpu=0.0` (syscall wait,
  not compute), bursty (per refresh, not continuous), and independent of the
  scan — which would explain why stalls concentrate when no scan runs. Reading
  the code, it looks like the answer. It is wrong by 1000x.

  **That is the second time a suspect was picked by reading and refuted by
  measuring**, after `publishPartial()`. The bounds this plan has established
  are real, but they are **not selective enough to identify a culprit from the
  source** — a fact worth stating once, because it is the entire argument for
  the probe branch coming first.

**A MEASURED CANDIDATE, 2026-08-31: `pr-list --rich` costs 4x, and the cost is
GitHub's, not ours.** Timed by hand against this repo, back to back:

| call | wall | cpu |
|---|---|---|
| `plot-host.sh pr-list --rich --state all --limit 1000` | **22.19 s** | 0 % |
| `plot-host.sh pr-list --state all --limit 1000` | **5.48 s** | 3 % |

**0 % CPU across 22 seconds is the whole finding.** The process spends 0.22 s of
actual CPU; it is blocked on the network for the rest. That matches the board's
own stall signature exactly — every `BOARD SLOW` sample reports `cpu=0.0` — so
the board is not slow because it is computing, it is slow because it is waiting.

It is not payload volume: the rich call returned **10** PRs, the plain one 4.
The difference is which FIELDS are asked for. `--rich` requests `mergeable` and
`mergeStateStatus`, and GitHub computes those **on demand**, blocking the
response until a background merge-commit calculation settles.

**Which explains the intermittency nobody could pin down.** The cost depends on
whether GitHub already holds a cached mergeability result. Every push
invalidates it for that PR — so an evening of active pushing is exactly when
every poll pays full recomputation, and a quiet estate is exactly when the
problem "goes away". The same field is why `gh pr list` intermittently reports
`mergeable: UNKNOWN`; that is the cache being cold, seen from the other side.

**AND THE SECONDARY RATE LIMIT IS PART OF IT, measured an hour later.** While
`gh api rate_limit` reported **5000/5000 remaining on both core and graphql**,
`plot-host.sh pr-list` still exited 5 with:

```
plot-host: pr-list: host throttled — GraphQL: API rate limit already exceeded
```

Both readings are true. GitHub enforces a **secondary** limit — on concurrency
and request rate — entirely separate from the primary quota the `rate_limit`
endpoint reports, and nothing in that endpoint's numbers shows it.

**This corrects a wrong inference made here.** Seeing full quota beside a
`throttled` verdict, the first reading was that `plot-fleet-scan.sh` had cached
a stale throttle or was misreporting a timeout as a rate limit — that the SCAN
was lying. It is not. Its `unknown — PR could not be read (throttled host)` is
the honest answer to a host that really is refusing, and the design note at
`plot-fleet-scan.sh:512` — *"`throttled` says wait; `failed` says look"* — is
being followed exactly.

**What it means for the 22 s call:** the mergeability computation above is real,
but secondary-limit backoff is at least as likely a contributor, and the two are
indistinguishable from the outside — both present as wall-clock time at 0 % CPU.
Any probe must tell them apart, or it will confidently name the wrong one.

**AND A SINGLE SAMPLE CONSTRAINS BOTH OF THEM.** Observed 2026-08-31 19:34:05:

```
BOARD UNREACHABLE: http=000 after 10006ms, pid=1585 rss=212432KB
                   cpu=0.0 children=0 scan=no
```

**`children=0` with `scan=no`.** A total outage of more than ten seconds with no
child process in flight and no scan running. Every host call above — the 22 s
`pr-list --rich`, the throttled retry — runs as a CHILD. So whatever blocked the
server for those ten seconds, it was not a host call, because there was no
process to make one.

That does not retire the host findings: a 22 s host call still explains a stale
refresh, and it is worth fixing on its own. It does mean the host call **cannot
be the whole cause**, and that a probe which only instruments host access will
come back clean on at least some samples.

**HOW MUCH WEIGHT THAT ONE SAMPLE CARRIES — the tally, 143 samples:**

| | outages | share |
|---|---|---|
| children in flight (`children>=1`) | **11** | 85 % |
| no children (`children=0`) | **1** | 8 % |

13 outages, 117 slow samples. **The dominant pattern is the opposite of what
the single sample suggested in isolation:** outages overwhelmingly coincide with
a child process running, which is what the host-call theory predicts.

**This corrects the weight, not the logic.** One counterexample does refute
*"host calls explain every outage"* — that inference stands. What it does not
support is treating host calls as a minor contributor. The defensible reading:
**host calls are the leading driver, and one outage in thirteen had no child at
all and needs a separate explanation.** An earlier revision of this section
stated the stronger claim, on that single sample, before the tally existed.

`cpu=0.0` in 9 of 13 outages either way — so whatever blocks, it is waiting
rather than computing, with or without a child.

**What it points at:** something inside the Node process, blocking the event
loop with nothing spawned. That is a narrower target than "a whole event loop" —
and it is reachable, because a synchronous block of that length is visible to
`--cpu-prof` or to an event-loop-delay histogram (`perf_hooks.monitorEventLoopDelay`),
neither of which needs a reproduction on demand.

**Not yet established:** which await fails to yield while this is in flight. The
call being slow explains a slow refresh; it does not by itself explain the
SERVER going unresponsive to unrelated requests. That is still the open
question, and it is the one the probe branch should answer — but it now has two
specific things to instrument rather than a whole event loop.
