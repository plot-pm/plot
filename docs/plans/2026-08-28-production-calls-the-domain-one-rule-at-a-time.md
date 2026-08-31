# Production calls the domain, one rule at a time

> The parallel implementation stops being parallel. Each rule is adopted on its own branch, board first and shell second, with the old copy deleted in the same change that starts calling the new one — so the duplication this design forbids never outlives the branch that resolves it.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board and the helper scripts compute lifecycle rules through `@plot-pm/domain` rather than each holding their own copy — one implementation of the deliver rule, the eligibility rule and the reap refusals, where there were two.

<!-- Board impact: YES, and it is the point. Every branch here changes what the
     board computes. The pulse contract does not change: the same values are
     produced by different code. Rebuild the artifact on every branch. -->

## Motivation

> **This plan runs THIRD, after
> [`the-domain-runs-the-workflows-in-a-sandbox`](2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md)
> and [`the-controller-answers-every-asker`](2026-08-30-the-controller-answers-every-asker.md).**
> One plan at a time, and the order is not arbitrary.
>
> **Measured 2026-08-30: 26 of the 51 spawn call sites sit in the very route
> handlers the controller plan rebuilds** — `board.ts` 4, `fleet.ts` 4,
> `idea.ts` 8, `deliver.ts` 2, `approve.ts` 2, `dispatch.ts` 2, `reslice.ts` 2,
> `implement.ts` 1, `commission.ts` 1.
>
> **Re-counted the same evening: 25, and eight of the nine files match exactly.**
> Only `dispatch.ts` moved, 2 to 1 — a line a slice landing that day presumably
> took with it. **This is the first of six plans checked that day whose
> motivating measurement held**; the other five had drifted far enough to change
> what their slices should assert. The per-file breakdown is why it could be
> re-derived at all: a bare total could not have been. If the Spawning slices land first they
> wire those sites straight to the adapters, and the controller plan then moves
> the same lines again.
>
> **So the layer is built before the callers are repointed**, and every call
> site is touched once. That is the same discipline this plan already applies
> to rules: the third-copy state is avoided by ordering, not by cleanup.
>
> **The chain is fifteen slices across three plans**, and running them
> concurrently would have them colliding in shared files. Sequential is slower
> and it is what keeps each file owned by one branch at a time.


> **Depends on [`2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md`](2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md)
> being fully delivered** (and through it, on the domain package). Every branch
> here repoints a production caller at an adapter that plan builds.
>
> **Plot cannot enforce this and will not stop it.** Slice eligibility is
> computed *per plan* — `plot-fleet-scan.sh` marks a slice eligible when the
> prior slices **of the same plan** are complete — and `plot-dispatch.sh`
> requires a plan slug, so no component compares two plans. With auto-dispatch
> on (measured 2026-08-28: `autoDispatch: true`, `parallelAgents: 11`) approving
> this plan claims its first branch within about a minute, against a package
> that does not exist yet.
>
> **Both settings verified unchanged on 2026-08-30**: `.plot/state/fleet-controls.json`
> still reads `{"autoDispatch":true,"parallelAgents":11}`. The warning stands as
> written, and the cap deserves saying out loud — **eleven**, not the three a
> reader might assume. `plot-config.sh get 'Parallel agents'` returns whatever
> default the caller passes, because no such key exists in `CLAUDE.md`; the board
> owns this setting. Asked that way it reported *3 of 3 slots busy* repeatedly on
> 2026-08-30 while eight were free.
>
> **So this plan stays Draft until the first is Delivered.** That is the gate,
> and it is a human one because Plot has no other.


**"Production calls the domain" is shorthand, and worth stating precisely.**
Production does not reach into the domain directly. Adapters turn the world
into readings, controllers ask, and the domain decides — three layers, settled
across
[Ports §4](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#4-the-adapters-already-exist)
and the controller plan. What this plan does is make production **stop holding
its own copy of the rules** and start getting its answers through that stack.
The title is kept because the slug is in the sprint, the story and three
commits, and renaming it would cost more than the sentence above clarifies.

**The duplication was licensed by this plan existing.**
[Plan 1](2026-08-28-the-domain-moves-out-of-the-board.md) builds a
copy of rules that already exist twice, making three, and says so: *"licensed
only by its removal being planned."* **This is the removal.**

**Left unfinished, the parallel implementation is the worst of the three
states** — production unchanged, a second implementation to maintain, and no
benefit realised. **The risk this plan manages is not breaking the board; it is
never finishing.**

## Design

### Approach

**One rule per branch, and the branch deletes what it replaces.**

The unit is deliberately small. A branch that adopts three rules cannot be
reverted for one of them, and the board is a surface somebody is watching while
this lands.

**Each branch does exactly five things:**

1. Point one production call site at the domain
2. **Delete the old implementation in the same commit**
3. **Correct the skill prose that described it**, in the same commit
4. Keep the existing tests, unchanged, as the regression lock
5. Rebuild the board artifact

**Step 3 exists because a script and its skill are one thing described twice.**
`skills/plot-deliver/SKILL.md` describes the branch-parsing mechanic in three
places; the moment `plot-deliver.sh` stops parsing, that prose describes code
that does not exist. It is the same duplication this plan removes from the
code, one layer up — and prose that has drifted is worse than prose that is
missing, because an agent follows it.

**It goes in the same commit for the same reason step 2 does.** A documentation
slice at the end would leave several skills describing removed code for the
length of the plan, which is exactly the interim state the design forbids for
implementations. Reviewing them together also means the reviewer sees whether
the prose still makes sense, not just whether the code compiles.

**Step 2 is the discipline.** An adoption that leaves the old code behind
"until we're sure" produces a third copy and no forcing function. The corpus
tests from plan 2 are what makes deleting safe: agreement was proven against
every plan in this repository before this plan starts (170, measured 2026-08-30).

**Step 4 matters more than new tests.** The board's existing tests for
`allWavesMerged` are written against its *behaviour*, and behaviour is exactly
what must not change. **Measured 2026-08-30 there are 74 of them across four
files** — `deliver-route.test.ts` 15, `auto-deliver.test.ts` 22,
`plan-status.test.ts` 22, `merged-waves-reach-testing.test.ts` 15 — not the 25
this plan first claimed. The regression lock is three times stronger than it
was written to be, and naming the four files means an adoption that quietly
skips one is visible. **A test that needs editing to pass is a signal the
adoption changed something** — and the edit needs an argument, not a fix.

### Board first, shell second — and why that order

**The board's copy is the one that survives**, so the board adopts by *deleting
its own function and importing the domain's* — a rename plus an import, with
the semantics unchanged by construction.

**The shell adopts by losing its copy entirely.** `plot-deliver.sh`'s ~95 lines
of branch-parsing become a call, because the pulse already did the parsing
([stage 2 §4](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#4-where-the-same-rule-lives-twice)).
**This is where the measured shell bug disappears** — the `## Changelog` bullet
read as a branch, which made four fully-merged plans undeliverable — because
the code that had the bug stops existing.

### The scripts ARE the adapter layer, so they do not "reach" the domain

**This plan said the shell would call the domain through `node`, and that had
the layering backwards.** A shell script is not a caller sitting above the
domain; it is the adapter — the thing that turns the world into readings.
[Ports §4](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#4-the-adapters-already-exist)
states it directly: *"Every driven port above already has a working adapter, and
it is a shell script the board already spawns."*

**If a script called into the domain, the outer ring would be calling inward and
still deciding for itself** — which is the shape this whole design removes, not
a step toward it. There would be no harness layer, only a second place where
decisions live.

**So a script with decisions in it has two futures, and each branch picks one:**

| the script is… | what the branch does |
|---|---|
| **pure adaptation** — reads the world, emits facts | it stays, unchanged, and an adapter wraps it (`runScript()` maps its exit codes) |
| **decision dressed as adaptation** | the decision moves to the domain; what remains is either a thin reading the adapter keeps, or nothing, and the script's caller asks the domain instead |

**`plot-deliver.sh`'s branch parsing is the second kind.** Parsing a plan to
decide which branches must be merged is a domain rule wearing shell clothing.
The parsing itself is adaptation — `plot-plan-meta.sh` already does it and stays
— but *"these branches make the plan deliverable"* is a decision, and it belongs
inside.

**The test that separates them:** does this code answer *what is true of the
world?* or *what should happen given what is true?* The first is an adapter and
survives. The second is the domain and moves.

**Where a decision cannot move without rewriting the script in TypeScript, it
stays and the plan says so.** Replacing a working 2000-line script with new
TypeScript is a different plan with a different risk, and this one is built on
adoption rather than rewriting.

### What each branch must prove before it merges

| | check |
|---|---|
| **behaviour** | the existing tests pass **unedited** |
| **agreement** | the corpus test still reports every plan agreeing |
| **absence** | `grep` finds no second implementation of the adopted rule |
| **the board** | `pnpm build:board` and `pnpm run test:board` are green |
| **the prose** | the skill describing the removed code is corrected |

**The absence check is a gate, not a review note.** *"Did I delete the old
one?"* is answerable without looking; *"does this grep return one hit?"* is not.

**The existing tests are the regression detector for the live board, and they
are enough.** Measured 2026-08-30: 54 test files touch spawning, and the four
suites covering the deliver rule alone carry 74 tests — `deliver-route` 15,
`auto-deliver` 22, `plan-status` 22, `merged-waves-reach-testing` 15. The plan's
earlier figure of 25 undercounted by two thirds.

**No pulse snapshot is taken before and after.** It was considered: capture
`/api/board` either side of an adoption and require the payload to match. It is
rejected because the payload legitimately moves between two runs on a live
estate — a worker commits, a PR merges, a scan re-derives — so the comparison
would fail for reasons that have nothing to do with the adoption, and a check
that cries wolf gets switched off. The suites assert the same values against
fixtures that do not move underneath them.

**What that leaves uncovered, stated:** a value no test asserts and no fixture
exercises can change unnoticed until someone looks at the board. The
mitigation is the one already in this plan — one rule per branch, so the
surface that could have moved is small enough to inspect by hand.

### The order, and why it is this order

**Deliver first** — two implementations, the widest measured divergence, and
the one with a known bug on the shell side. It is also the rule with the most
existing test coverage, so the regression lock is strongest exactly where the
change is largest.

**Eligibility second** — one implementation today (`plot-fleet-scan.sh`), so
adoption is a move rather than a merge, but it is on the 5-second pulse path
and any regression is immediately visible on a live board.

**The refusals last** — reap and dispatch. They guard destructive acts, and a
wrong refusal removes a worktree somebody is working in. **They go last because
by then the pattern has been exercised twice** and the corpus tests have been
running against the live estate for two branches' worth of time.

## Slices

### Delivering (Branch: feature/the-shell-stops-parsing-plans)

**The board half of this moved into plan 1**, which relocates `allWavesMerged`
rather than copying it. What remains is the shell: `plot-deliver.sh`'s ~95-line
branch-parsing block gives way to a call, because the pulse already did the
parsing.

**This is where the measured shell bug disappears** — the `## Changelog` bullet
read as a branch, which made four fully-merged plans undeliverable — because
the code that had the bug stops existing.

**Done when** `plot-deliver.sh` no longer parses a plan, `test/e2e/` passes
unedited, and the delivery refusal still names every unmerged branch.

### Eligible (Branch: feature/one-eligibility-rule-decides)

`plot-fleet-scan.sh`'s slice verdicts computed by the domain. **The scan's
output must not change** — same words, same footer counts, on the same estate.

**Done when** the scan's output is byte-identical before and after **against a
frozen clone**, and `test/reconcile/` passes unedited.

**The clone is what makes the comparison mean anything.** The scan reads the
live estate, and this repository runs `parallelAgents: 11` — between two runs a
PR merges, a worker commits, a ref moves, and the diff would be full of changes
the adoption did not cause. A check that cries wolf is a check somebody turns
off. So: clone the estate once, run both scans against that clone with
`--offline` (the flag already exists), and any difference is necessarily the
adoption.

### Refusing (Branch: feature/the-refusals-are-domain-rules)

`plot-reap.sh`'s five and `plot-dispatch.sh`'s four become domain predicates
returning a named `Refusal`. **The scripts keep their exit codes and their
messages** — a refusal that reports differently breaks whoever reads it.

**Done when** each refusal is still individually triggerable in the e2e suite,
no refusal logic remains in either script, and **both scripts' `--dry-run`
output is byte-identical before and after, on the same estate**.

**The dry-run comparison covers `plot-reap.sh` too, and that is the change.**
The plan named it for dispatch and left reap to the e2e suite — but reap is the
one that removes worktrees, and there are 22 on this machine right now with
agents sitting in several of them. A wrong refusal there deletes a desk somebody
is working at.

**Both scripts default to `--dry-run` precisely so this is cheap.** Running each
before and after the adoption, on the same estate, exercises every refusal
against real worktrees, real pids and real markers — the population fixtures
cannot reproduce — and it does so without removing anything or starting
anything. A difference is a refusal that changed its mind.

**This runs before the slice's PR is opened, not after it merges.** The point is
to find a wrong refusal while it is still inert.

### Spawning the scripts (Branch: feature/one-place-reaches-a-script)

The board's calls to `plot-*.sh` give way to the adapter layer's single
`runScript()`. **These are the point** — they are the ones with the exit-code
contract, and the ones where a second reading of 3-vs-4 would collapse a
permanent configuration fact into a transient incident.

**Done when** no `plot-*.sh` is invoked from `packages/board/src/`, the board
suite and browser suite pass unedited, and no exit code is interpreted outside
`runScript()`.

### Spawning the tools (Branch: feature/one-place-reaches-a-process)

The remaining direct calls — `git`, `ps`, one `tailscale` — move behind the
`Refs`, `Processes` and `Machine` adapters respectively.

**Split from the slice above because of size, measured 2026-08-30: 51 call
sites across 22 files, with 54 test files touching spawning.** That is larger
than the Deciding slice the sandbox plan split for the same reason, and this
story exists because agents stall on branches that size. The two halves also
adopt *different* adapters through *different* contracts — `runScript()` maps
exit codes for scripts Plot owns, while `Refs` and `Processes` wrap tools that
answer in their own idiom — so reviewing them together would mean reviewing two
arguments in one diff.

**This is where the board stops being a process-spawning application** and
becomes one that asks ports. Until both land, the adapters exist and the board
routes around them — the same shape as `plot-reap.sh` reaching past
`plot-host.sh`, one layer up.

#### It is also the board's unresponsiveness, measured 2026-08-31

This slice was argued as a LAYERING correction. It is also a performance fix,
and the measurement was taken the hard way — after four wrong causes were named
and withdrawn in `the-board-answers-while-it-scans`.

`sample <pid> 5` on a board refusing every request, main thread, **4258 of 4262
samples**:

```
uv_run → uv__io_poll → http_parser::on_headers_complete()
 → v8::Function::Call → (the request handler)
   → node::SyncProcessRunner::Spawn        ← execFileSync
```

**A synchronous spawn cannot yield.** While it runs the event loop serves
nothing — a STATIC FILE timed out at 15 s beside it, which is what finally
distinguished this from every "the board is slow" theory: a slow computation
does not stop `/` from being served, and a blocked loop does.

It accounts for every reading that refuted the earlier explanations:

| observation | why it followed |
|---|---|
| `cpu=0.0` during an outage | the parent blocks in `waitpid`; the CHILD burns CPU |
| `children=0` in one sample | sampled between two spawns |
| `/` at 1.5 ms, then 15 s | whether a spawn was in flight at that instant |
| stalls with no scan running | these are on the REQUEST path, not the scan's |

**One of the three primitives has since been mitigated, and the mitigation
proves the rest.** `readConfig` — `bash plot-config.sh`, 58 ms a spawn, five
calls per `/api/board`, 318 ms of blocking per request — is now cached on the
config files' mtimes. A second `sample` after that change shows the profile
changed SHAPE rather than emptied: the single 4258-sample block is gone, and
**20 separate spawns remain in a 4 s sample**, the largest holding 49.

Those are `git()` and `gitBuffer()` — **14 call sites in `board.ts` alone** —
and they are precisely this slice's subject. The board still answers in
2.4–5.3 s.

**The cache is a stopgap and this slice retires it.** `plan-store.config(key,
fallback)` is already the async twin of `readConfig`; an mtime cache was built
around a synchronous spawn because the port existed and the board did not call
it. When it does, the cache should go.

**And it is what makes the board testable without git.** `refs-fixture.ts`
already sits beside `refs-git.ts`. A board on the ports takes an injected
fixture and needs no repository, no subprocess and no estate — the same
round-trip property `a-browser-test-serves-its-own-state` is chasing one layer
up, which is why the two plans reinforce rather than duplicate each other.

**Done when**

```bash
grep -rnE "(execFileSync|execFile|spawnSync|spawn)\(" packages/board/src/
```

returns **nothing at all**, and the browser suite passes unedited.

**Emptiness, not "only the adapter layer".** The adapters live in
`packages/domain/src/adapters/`, so once they exist there is nothing left in
the board to match — the earlier wording could only have passed if adapters had
been placed inside the board, which is precisely the layering this plan exists
to remove.

### Transitions (Branch: feature/a-transition-writes-one-value)

`plot-approve.sh` and `plot-deliver.sh` stop composing their writes inline. What
they write comes from `plan.approve()` / `plan.deliver()`; **what performs the
write is still the script**, because a script is an adapter and an adapter does
not call inward.

**The route is the controller.** The domain returns a `Decision` naming every
write; a controller asks for it; the script is handed what to write and does it.
The script keeps its exit codes, its messages and its idempotence — it loses
only the part that was deciding.

> **This slice waits on the controller plan**, which is the mechanism that
> carries a `Decision` to a script without the script reaching into the domain.

**Done when** the sandbox e2e suite produces plan files that **parse
identically** by both paths — every field from `plot-plan-meta.sh` matching —
and a phase can no longer be written without its record.

**Parser equivalence rather than byte equality, following the sandbox plan**
([slice 5](2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md)), which
settled this with its reasoning: the parser is the consumer, the bytes are an
encoding, and the failure that matters — a date written `2026-8-29` — is caught
by comparing parses because the parser is what it would break. Restating it
differently here would put two rules on one file and leave the two test suites
contradicting each other, which is the duplication this plan exists to remove.

## Notes

### Re-measured 2026-08-31, and the motivating count still holds exactly

The Motivation's per-file breakdown was re-derived three days on, counting
INVOCATIONS rather than mentions (`^[^*/]*\b(spawn|spawnSync|execFile|execFileSync)\s*\(`):

| file | plan | today |
|---|---:|---:|
| `board.ts` | 4 | 4 |
| `fleet.ts` | 4 | 4 |
| `idea.ts` | 8 | 8 |
| `deliver.ts` | 2 | 2 |
| `approve.ts` | 2 | 2 |
| `dispatch.ts` | 2 | 2 |
| `reslice.ts` | 2 | 2 |
| `implement.ts` | 1 | 1 |
| `commission.ts` | 1 | 1 |

**Nine of nine match.** The split is now **26 in the route handlers and 26
elsewhere, 52 total** — one site added since the plan's 51, outside the
handlers. The ratio the ordering argument rests on is intact.

**The per-file breakdown is what made this checkable**, exactly as the
Motivation claims: a bare total of 26 would have matched by coincidence across
several distributions, and a bare 51 would now read as drift rather than as one
new call site. A first grep for the same words counted 9/27/18/13/9/10/15/7/9 —
comments, imports and type positions — which would have manufactured drift that
does not exist.

**What this does NOT re-validate:** the ordering constraint itself. This plan
still runs third, and both predecessors are unfinished — `the-domain-runs-the-workflows-in-a-sandbox`
at 3 of 5 branches and `the-controller-answers-every-asker` at 2 of 4.


### How much of each script is domain, and how much is adaptation

**This is the open question the sequence has to answer, and it is per-script
rather than per-file.** The choice is not *which scripts do we replace* but
*where inside each one does deciding stop and adapting begin*. Counted
2026-08-30, by lines against markers of decision (`refus`, `eligible`,
`blocked`, `verdict`, `gate`, `cannot`, `exit 1`):

| script | lines | decision markers | reading |
|---|---:|---:|---|
| `plot-config.sh` | 154 | 5 | **adaptation** — reads a key, prints a value |
| `plot-plan-meta.sh` | 930 | 21 | **adaptation** — the plan-format parser, and the contract |
| `plot-host.sh` | 1686 | 60 | **adaptation** — one place that talks to the host CLI |
| `plot-deliver.sh` | 488 | 18 | mixed — parsing adapts, deliverability decides |
| `plot-approve.sh` | 628 | 43 | mixed — the same shape |
| `plot-worker-state.sh` | 725 | 39 | mixed — six process facts adapt, two workflow states decide |
| `plot-reap.sh` | 286 | 12 | mixed — five refusals decide, the measurements adapt |
| `plot-fleet-scan.sh` | 3496 | 151 | **mostly decision** — slice verdicts are the domain |
| `plot-dispatch.sh` | 2028 | 220 | **mostly decision** — eligibility and nine refusals |

**The pure adapters are not rewritten at all.** `plot-plan-meta.sh` is the
plan-format contract and `plot-host.sh` is the single place that speaks to a
host CLI — reimplementing either in TypeScript would be the duplication this
design forbids, and both already answer in exit codes `runScript()` maps.

**The mixed ones give up their deciding half and keep the rest.** That is what
each slice above does, one rule at a time.

**The two mostly-decision scripts are the open question.** `plot-fleet-scan.sh`
and `plot-dispatch.sh` are 5524 lines carrying 371 decision markers between
them, and after their rules move, what is left may be too thin to be worth
keeping as shell — or may still be the right adapter for the git and process
access underneath. **That is a measurement nobody has taken**, and it should be
taken after the Eligible and Refusing slices land, when the remainder is
visible rather than predicted. Deciding it now would be guessing at the size of
something these slices are about to change.


**This plan can stop between branches and leave a coherent estate.** Each
branch ends with one fewer duplicated rule, and nothing depends on the next one
starting. **That is deliberate** — a migration that must complete to be
coherent is one that blocks a release.

**The sprint is what tells stopping apart from stalling.** The plan's stated
risk is never finishing, and six slices here plus five in the plan above it is
eleven branches — long enough that "paused" and "stuck" look identical from
inside. This plan belongs to a sprint with an end date, and a sprint that closes
with it unfinished puts the question where it can be answered: the retrospective
asks what the timebox changed, and an adoption that stopped halfway is exactly
what that question is for. **No counter is added to this file** — a progress
number kept by hand is one that stops being updated precisely when the plan
starts stalling, which is the moment it would have been worth reading.

**What it must not do is stop and leave a branch half-adopted.** A production
call site pointing at the domain while the old implementation still exists is
the third-copy state this whole design forbids, and the absence gate is what
prevents a branch from merging in it.

**The story's job 3 — the delta — is deliberately not here, and it needs its
own plan.** It is new capability rather than adoption. Adding it during a
migration would leave the corpus tests with nothing to compare against:
production would have no implementation of the new rule, so "does the domain
agree with production?" would have no answer, and the tier that earns this whole
sequence would go quiet exactly where the risk is highest.

**That argument does not depend on where the delta ends up living.** The story
asks whether it belongs in the scan, the board, or a third thing — an open
question — but new capability during a migration destroys the comparison
whichever component holds it. So the exclusion stands regardless of how that
question resolves.

**"Later" is not a place, so name the plan.** A capability deferred without a
successor is one nobody schedules: write `the-fleet-says-what-changed` (or
whatever the delta is called when it is specified) as a Draft plan referencing
this one, so the deferral has an address instead of a promise.

### Interrogated 2026-08-30 — the premise holds, the counts moved

Re-measured against `main` at `v2.12.0`.

**The Delivering slice's premise is confirmed.** `plot-deliver.sh` still parses
the plan itself: three blocks at lines 127-148 reading both `## Branches` and
`## Waves`, in a 488-line script that calls no domain code. The slice's claim
that *"the code that had the bug stops existing"* is still available to make.

**The board half is genuinely done.** `allSlicesMerged` lives in
`@plot-pm/domain` (`rules/deliverable.ts`) and the board imports it, re-exported
under a temporary `allWavesMerged` alias so call sites need not change in the
same commit. This plan's statement that plan 1 relocated rather than copied it
is accurate.

| the plan says | measured 2026-08-30 | effect |
|---|---|---|
| 158 plans | **170** | corrected in the text above; the scan comparison is phrased against "every plan" so it cannot go stale again |
| 46 direct process calls | **51** across 22 files | Spawning was split in two; see the two slices |
| 10 invoke `plot-*.sh` | **15 distinct scripts referenced** | more adapter surface than stated |

**~~The Spawning slice's Done-when is wrong as written.~~ Corrected in round 3.**
It asserted that a grep over `packages/board/src/server/` returns "only the
adapter layer" — but the adapters live in `packages/domain/src/adapters/`, so it
could only have passed if adapters had been placed inside the board, which is
the layering this plan removes. **It now asserts emptiness**, and the slice was
split in two at the same time.

**The dependency still binds, and its state has moved.** This plan needs
`the-domain-runs-the-workflows-in-a-sandbox` delivered — the adapters and
`runScript()` are built there and consumed here. **As of 2026-08-30 that plan is
Approved and dispatched**, with `feature/the-ports-have-adapters` in flight;
it was Draft with no branch when this was first written. Nothing here is
startable until its five slices land, but the wait is now measured in slices
rather than in a decision nobody had taken.

> **Findings above are struck through when the plan itself has been corrected,
> and their measurements are kept.** A finding that reads as open after it has
> been fixed is worse than no record: the next reader trusts it and re-derives
> a decision that was already made. The measurement is the part that stays
> useful — it is the evidence, and evidence does not expire the way a verdict
> does.
