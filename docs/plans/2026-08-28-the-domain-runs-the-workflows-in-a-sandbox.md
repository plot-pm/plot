# The domain runs the workflows in a sandbox

> Adapters behind the seven ports, and every existing workflow expressed against the domain — approve, implement, dispatch, deliver, release, reap — proven against the live estate and still calling nothing in production.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `feature/the-ports-have-adapters`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- `@plot-pm/domain` gains adapters for its seven ports and expresses all six lifecycle workflows in read-only mode. The four with a script — approve, dispatch, deliver, reap — are verified against the live repository; `implement` and `release` exist only as skill prose and are verified against fixtures alone.

<!-- Board impact: NONE. The adapters READ what the board reads; nothing here is
     wired into the board or the skills. The one write path (transitions) is
     exercised against sandbox repos only. -->

## Motivation

> **Depends on [`2026-08-28-the-domain-moves-out-of-the-board.md`](2026-08-28-the-domain-moves-out-of-the-board.md)
> being fully delivered.** Every branch here imports `@plot-pm/domain`, which
> that plan creates.
>
> **Plot cannot enforce this and will not stop it.** Slice eligibility is
> computed *per plan* — `plot-fleet-scan.sh` marks a slice eligible when the
> prior slices **of the same plan** are complete — and `plot-dispatch.sh`
> requires a plan slug, so no component compares two plans. With auto-dispatch
> on (measured 2026-08-28: `autoDispatch: true`, `parallelAgents: 11`) approving
> this plan claims its first branch within about a minute, against a package
> that does not exist yet.
>
> **So this plan stays Draft until the first is Delivered.** That is the gate,
> and it is a human one because Plot has no other.
>
> **The condition is met as of 2026-08-29:** `the-domain-moves-out-of-the-board`
> is Released in v2.12.0, and `@plot-pm/domain` is on the default branch. The
> gate is still a person's to open — this records that it may be opened, not
> that it was.


**A domain nobody can feed is a domain nobody can trust.**
[The previous plan](2026-08-28-the-domain-moves-out-of-the-board.md)
builds entities and rules that are pure by construction and therefore proven
only against hand-built fixtures. **A fixture agrees with whatever wrote it.**

**This plan connects the domain to the real estate without letting it act on
it.** The adapters read: 158 plans, 303 slices, the fleet's branches, the
host's PRs, the worktrees on this disk. The workflows compute what they would
do. **Nothing writes** except in sandbox repos the tests create.

**That is what makes the eventual replacement a swap rather than a migration.**
When a production caller is finally repointed, the code it points at has
already answered the same questions about the same repository, and been
checked.

## Design

### Approach

**Adapters land in `packages/domain/src/adapters/`, one directory per port**,
following the discovery rule
([Ports §2b](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#where-they-live-and-how-to-find-them)):
enumeration is a glob, never a maintained list.

**The purity gate from plan 1 must now exclude `adapters/`** — and that
exclusion is the layer boundary made mechanical:

```bash
grep -rlE "from '(node:|fs|child_process)" packages/domain/src/ \
  | grep -v '^packages/domain/src/adapters/'
```

**Empty output still means the domain is pure**, and now it also means every
world-reaching import lives in exactly one directory. **A second gate** asserts
the converse: every `ports/*.ts` has a directory under `adapters/`, so a port
cannot be declared and left unimplemented.

### Adapters wrap the scripts; they do not replace them

**The scripts are the adapters** ([Ports §4](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#4-the-adapters-already-exist)).
`plot-plan-meta.sh` already parses the plan format and is the contract;
`plot-fleet-scan.sh` already derives slice verdicts; `plot-host.sh` already
speaks to both hosts and already carries the exit-code result type.

**So a TypeScript adapter is a thin translation, not a reimplementation** — it
spawns the script and maps its exit code into `PortResult<T>`:

| exit | `PortResult` |
|---|---|
| 0 | `{ ok: true, value }` — including a `NONE` payload |
| 1 | `{ ok: false, why: 'failed' }` |
| 3 | `{ ok: false, why: 'failed' }` — could not be asked |
| 4 | `{ ok: false, why: 'unaskable' }` — structurally has no answer |

### One spawner, because there is currently none

**The board reaches processes from 46 call sites and has no shared helper for
it** — `fleet.ts` imports `execFile`, `execFileSync` and `spawn` directly, and
each site does its own error handling. Of those 46, **10 invoke a `plot-*.sh`**;
the rest are `git`, `bash`, `ps` and one `tailscale`.

> **Measured 2026-08-28, correcting an earlier count of 235.** That figure was
> every *mention* of the words in a codebase that discusses its own spawning at
> length. The real number makes this bounded rather than a rewrite.

**The adapter layer gets exactly one `runScript()`**, and it is the only place
the exit-code contract is written:

```
0 → { ok: true, value }        // NONE is a payload, not a miss
1 → { ok: false, why: 'failed' }
3 → { ok: false, why: 'failed' }      // could not be asked
4 → { ok: false, why: 'unaskable' }   // structurally has no answer
```

**Seven adapters writing that mapping seven times is how 3 and 4 get
collapsed** — and collapsing them turns a permanent configuration fact into a
transient incident, which `plot-host.sh` warns against in its own header.

**The existing 46 stay untouched in this plan**, and
[plan 3](2026-08-28-production-calls-the-domain-one-rule-at-a-time.md) migrates
them. Repointing them here would mean changing the board before the domain it
would call is proven.

**Rewriting a parser in TypeScript would be the very duplication this design
forbids.** The adapter's job is to make one existing implementation reachable
from a typed caller.

**`plot-host.sh` gains one operation** — *has any PR for this branch merged?*
That is the single measured gap in the port
([Ports §7](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#7-how-wide-is-a-port-the-measured-answer)):
`pr-state` returns `mergeCommit` and not `mergedAt`, which is why
`plot-reap.sh` reached past it. **This is the only production file this plan
touches**, and it adds an operation without changing one.

### The workflows, expressed and not enacted

**Each workflow is the domain deciding and the adapter performing**, per
[stage 2 §3](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#3-the-split-per-workflow).
This plan writes the deciding half for all six — across two slices, since
`dispatch` alone is half the code — and **stops before performing**:

```
workflow(readings) → Decision            // proceed, with what to write
                   | Refusal             // which rule fired, and why
```

**A `Decision` is inert.** It says *merge PR #42, set Phase: Approved, write
this record* and does nothing. That makes every workflow testable end to end
with no host and no repository — and it is why the eventual production swap has
something already-proven to point at.

### How it is proven against the live estate

**Three test tiers, in ascending cost:**

| tier | asks | needs |
|---|---|---|
| **unit** | does the rule hold? | nothing — fixtures |
| **corpus** | does it agree with production, on this repo? | read-only adapters |
| **sandbox** | does the transition write what production writes? | a temp git repo |

**The corpus tier is the one that earns this plan**, and what it compares
changed when plan 1 became a *move* rather than a copy.

**There is no second implementation of the RULES to compare against** — the
board imports the domain's. What the corpus tier proves instead is that **the
adapters feed the domain the same readings production reads**: run
`plot-fleet-scan.sh` and the `Refs` adapter over this repository and assert the
resulting `Pulse` is identical; run `plot-plan-meta.sh` and the `PlanStore`
adapter over all 158 plans and assert every field matches.

**That is the honest comparison for an adapter.** A rule with one
implementation cannot disagree with itself; an adapter that drops a field, or
reads `state` where production reads `mergedAt`, absolutely can — and would
otherwise surface as a domain that is correct about the wrong facts.

**A disagreement fails CI and is a finding either way** — either the adapter is
wrong, or it found a production bug.

**It runs as its own CI job, parallel to the board suite.** The comparison is
one `plot-plan-meta.sh` process per plan against the adapter's reading, so at
170 plans it is roughly 340 spawns — and the board's integration suite already
ran 12.5 minutes on 2026-08-29 and has timed out at 15. Adding this to that job
would make a suite that is already at its budget fail for a reason unrelated to
the code under test. A separate job costs a runner slot and keeps both signals
readable: a red board suite means the board, a red corpus job means the
adapters and production disagree.

**Running it per PR rather than nightly is what makes the claim above true.**
"A disagreement fails CI" is only a gate if the failure lands on the change that
caused it; found hours later it is a report, and a report is something someone
has to remember to read.

**Which side is wrong is a person's call, and the worker stops for it.** The
rule that an adapter may not be adjusted to match says what must not happen; it
does not say what the agent should do instead, and an agent facing red CI with
no instruction will find a way to make it green. So on a disagreement the worker
writes `PLOT-BLOCKED` naming the field, the plan, and both readings, and stops.
Deciding whether production or the adapter is wrong needs someone who knows why
the field exists — and getting that backwards in the permissive direction
cements a real production bug behind a passing test.

**The sandbox tier compares transitions.** `plot-approve.sh` and
`plot-deliver.sh` are idempotent and already have e2e coverage in sandbox repos
(`test/e2e/lifecycle.test.mjs`); the same sandboxes run the domain's `Decision`
and compare the resulting files against what the scripts produce.

**The bar is parser equivalence, not byte equality.** Both outputs go through
`plot-plan-meta.sh` and the resulting JSON must match field for field. The
concern that motivates the check is real and unchanged — a transition writing
`2026-8-29` where production writes `2026-08-29` is a transition that breaks
the parser — and parser equivalence catches exactly that, because the parser is
what the difference would break.

**What it deliberately tolerates is formatting**: a trailing newline, a blank
line between records, the order of two independent Status fields. Those are
differences no reader of the plan format can observe, and gating on them buys
nothing while guaranteeing a class of failures whose fix is to re-align
whitespace with a shell script — work that teaches an implementer the test is
noise.

**The parser is the right oracle because it is the consumer.** Every component
that reads a plan reads it through `plot-plan-meta.sh`; the file's bytes are an
encoding, and its parsed fields are its meaning. Asserting on bytes asserts on
the encoding of a format both sides are allowed to write — asserting on the
parse asserts on what any reader will actually see.

**The cost, stated:** a difference the parser ignores today becomes visible if
the parser later starts reading it. That is a real gap and it is accepted,
because the alternative fails on differences that are invisible to every
existing consumer.

## Slices

**Reading comes first and alone; the three after it are not a queue.**
Everything needs the ports, so Reading blocks all of them. But Agreeing verifies
adapters against production while Deciding and Dispatching express workflow
logic — different files, different questions, and neither reads the other's
output. Deciding needs the ports to exist, not the corpus comparison to have
passed.

**Sequencing them anyway would cost the fleet three waves where one would do**,
and the parallelism is real rather than theoretical: this repository runs
`parallelAgents: 11`.

**Writing is last, and that one is a genuine dependency** — it applies the
`Decision` that Deciding and Dispatching produce, so it cannot start before both
land.

```
Reading ──┬─→ Agreeing ─────┐
          ├─→ Deciding ─────┼─→ Writing
          └─→ Dispatching ──┘
```

### Reading (Branch: feature/the-ports-have-adapters, PR: #530)

**The seven ports are declared here, not assumed.** `PlanStore`, `Refs`,
`Host`, `Processes`, `Trees`, `Clock` and `Machine` become `ports/*.ts` in this
slice, each a pure interface the domain owns, and each gains its directory under
`adapters/`. The slice is named for the adapters because they are the work; the
ports are the contract they satisfy, and neither half is meaningful alone.

`plot-host.sh` gains its one missing operation.

**The completeness gate is two-sided, because one-sided it passes on nothing.**
Asserting only *"every `ports/*.ts` has a directory under `adapters/`"* is
vacuously true against an empty `ports/` — which is exactly the state this slice
starts from, so the gate would report success before a line was written. It
therefore also asserts a floor:

```bash
test "$(ls packages/domain/src/ports/*.ts | wc -l)" -ge 7
```

An empty set satisfying a universal claim is the failure mode this repository
already names elsewhere: a check you can answer "yes" to without doing the work
is a rule, not a gate.

**Done when** the seven ports exist as interfaces, each has an adapter, the
domain can be handed this repository's real state through them, and both gates
pass — the purity grep excluding `adapters/`, and the two-sided completeness
check above.

### Agreeing (Branch: feature/the-domain-agrees-with-production)

The corpus tests, comparing **readings** rather than verdicts: the `PlanStore`
adapter against `plot-plan-meta.sh` over all 158 plans, and the `Refs` adapter
against `plot-fleet-scan.sh`'s pulse.

**Done when** every disagreement is either fixed or filed as a production bug
with its plan — **a disagreement may not be silenced by adjusting the adapter
to match.** If production is wrong, that is a finding and it gets a plan.

**An agent that hits a disagreement writes `PLOT-BLOCKED` and stops**, naming
the field, the plan, and both readings. Which side is wrong is judgement, and
the failure that matters here is the permissive one: an agent left to choose,
facing red CI, adjusts the adapter and cements a production bug behind a
passing test. The comparison runs as its own CI job, so that stop blocks this
branch and nothing else.

**Adapters are written test-first like everything else, but their coverage
threshold is not 100%.** An adapter's uncovered branches are the ones that need
a host to fail, a disk to be full, or a process to die at the wrong moment —
and a threshold that forces those to be faked teaches people to fake them.
**The gate that applies here is the purity-except-adapters grep**, which is what
keeps the untestable code confined to this directory.

### Deciding (Branch: feature/the-workflows-decide-without-acting)

`approve`, `deliver`, `reap`, `implement` and `release` as
`readings → Decision | Refusal`, with the refusals named individually.
**`dispatch` is not here** — it has its own slice below, for reasons of size.

**Two of the five have no script**, and that changes what can be proven about
them rather than whether they are expressed. `plot-implement` and
`plot-release` exist only as skill prose: 312 and 482 lines, six and nine
numbered steps, five and fifteen refusal statements, and two and four
`PLOT-UNASKED` shapes between them. **That prose is the specification** — it is
what every agent running these workflows today actually follows, so a domain
that disagrees with it disagrees with production.

**What it cannot do is fail mechanically.** Prose has no exit code, so there is
no corpus comparison for these two and no sandbox byte check: a disagreement
between the domain and a paragraph is a reading, and readings are how a promise
that was never implemented survives review. They are therefore proven by unit
tests against fixtures only, and **the plan states that as weaker evidence
rather than hiding it behind the same "verified" the other four earn.**

**The numbered steps and named refusals are what make this tractable at all.**
Had the prose been narrative, expressing it would be interpretation; being a
numbered procedure with explicit refusals, it is closer to transcription. Where
a step is genuinely ambiguous, that ambiguity is a finding about the skill and
gets recorded, not resolved by guessing.

**Done when** each of the five workflows' refusals is assertable without a
repository, each `Decision` names every write it would make (proven as below),
and the two prose-derived workflows are marked in the code as fixture-verified
only.

### Dispatching (Branch: feature/dispatch-decides-without-acting)

`plot-dispatch.sh` alone, as `readings → Decision | Refusal`.

**It is its own slice because it is half the work.** Measured 2026-08-30:
`plot-dispatch.sh` is **2028 of the 3430 lines** across the four scripted
workflows and carries **~46 of the ~104 error paths**. Folding it into Deciding
would make one branch larger than the other three workflows combined — and this
story exists because agents stall on branches that size, with 324 finished
lines left uncommitted in one measured case.

**Its refusals are also the ones with teeth**: a live worker pid, a
`PLOT-BLOCKED` marker, a worktree holding unlanded work, a phase gate read from
`origin/<main>`. Each is a measurement rather than a judgement, which is
exactly what makes them expressible as domain predicates — and worth reviewing
on their own rather than in a diff that also moves five other workflows.

**Done when** every `plot-dispatch.sh` refusal is a named `Refusal` assertable
without a repository, and the `--dry-run` reasoning is reproducible from the
domain alone.

### Writing (Branch: feature/a-decision-writes-what-the-script-writes)

The sandbox tier: the domain's `Decision` applied in a temp repo, compared
against `plot-approve.sh` and `plot-deliver.sh` through the parser rather than
byte for byte — both outputs are read by `plot-plan-meta.sh` and every field
must match.

**The sandbox is also what proves a `Decision` named every write it makes.**
The Deciding slice asserts that it does; nobody can check it by reading, because
the failure mode is a write the author forgot — and an author who forgot it
while writing the code forgets it again while reviewing. So the sandbox runs the
script in a temp repo, takes `git status --porcelain` plus an untracked-file
listing before and after, and asserts every path that changed appears in the
`Decision`. **The filesystem enumerates the writes, not a person.**

An extra path in the `Decision` that the script never writes fails too: over-
claiming is how a `Decision` stops being a usable description of what will
happen.

**Done when** approve and deliver parse identically by both paths in the
sandbox e2e suite — including the transition records, the phase, and the sprint
annotation — every filesystem change is named by the `Decision` and no unnamed
path appears, and a deliberately corrupted date (`2026-8-29` for `2026-08-29`)
makes the comparison fail. Without that mutation the assertion is unproven:
a comparison of two parses that both silently returned nothing would pass.

## Notes

**Still nothing in production calls this.** `plot-host.sh` gains an operation
and no caller; everything else is additive.

**The corpus tests are also the drift alarm.** An unused package rots, and this
one is protected by tests that run against the live estate every CI run — a
production rule that changes without the port following turns CI red the same
day.

**Run the e2e tier with `env -u PLOT_UNATTENDED`.** The sandbox tier inherits the
worker environment when run from inside a dispatched worktree, and
`PLOT_UNATTENDED` in the ambient environment trips the control tests.

### Interrogated 2026-08-30 — the plan holds, three numbers moved

Re-measured against `main` at `v2.12.0`. **No design decision is overturned**;
what follows is drift in the figures the plan quotes, and one figure that is
larger than stated in a way that matters.

| the plan says | measured 2026-08-30 | effect |
|---|---|---|
| 158 plans in the corpus | **170** | the Agreeing slice's corpus test is 12 plans wider |
| 46 spawn call sites | **51** | Spawning (plan 3) is 5 sites larger |
| 10 of them invoke `plot-*.sh` | **15 distinct scripts referenced** | the adapter surface is wider than stated |
| `ports/*.ts` are declared | **no `ports/` directory exists** | see below |
| `plot-host.sh` lacks a merged-check | **confirmed** — `mergedAt` appears once, in a comment | unchanged |

**The ports do not exist yet, and the plan assumes they do.** `packages/domain/src`
holds `entities/`, `rules/` and `transitions/` — there is no `ports/`. The
Reading slice says *"adapters for `PlanStore`, `Refs`, `Host`, `Processes`,
`Trees`, `Clock`, `Machine`"*, and the completeness gate asserts *"every
`ports/*.ts` has a directory under `adapters/`"*. Against zero ports that gate
passes vacuously.

**This is a scope question, not a defect.** Either the Reading slice declares the
seven ports as well as their adapters — which is the honest reading of
[DESIGN-ports.md](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md)
§2, since a port is an interface the domain owns — or a slice ahead of it does.
It should be settled before the slice is dispatched, because the gate as written
cannot detect its own omission.

**What HAS landed, and the plan can rely on:** `allSlicesMerged` is in
`@plot-pm/domain` (`rules/deliverable.ts`), re-exported from the board as a
temporary `allWavesMerged` alias. The domain package is real and the board
imports from it.

**What has NOT:** `plot-deliver.sh` still parses the plan itself — three
parsing blocks at lines 127-148, reading both `## Branches` and `## Waves` — and
calls no domain code. That is plan 3's Delivering slice, correctly still open.
