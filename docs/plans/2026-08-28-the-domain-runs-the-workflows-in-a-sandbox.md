# The domain runs the workflows in a sandbox

> Adapters behind the seven ports, and every existing workflow expressed against the domain — approve, implement, dispatch, deliver, release, reap — proven against the live estate and still calling nothing in production.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `@plot-pm/domain` gains adapters for its seven ports and expresses all six lifecycle workflows, verified against the live repository in read-only mode.

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
This plan writes the deciding half for all six and **stops before performing**:

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

**The sandbox tier compares transitions.** `plot-approve.sh` and
`plot-deliver.sh` are idempotent and already have e2e coverage in sandbox
repos; the same sandboxes run the domain's `Decision` and assert the resulting
files are byte-identical to what the scripts produce. **Byte-identical is the
bar** — a transition that writes a different date format is a transition that
breaks the parser.

## Waves

### Reading (Branch: feature/the-ports-have-adapters)

Adapters for `PlanStore`, `Refs`, `Host`, `Processes`, `Trees`, `Clock`,
`Machine`. The two gates: purity-except-adapters, and every-port-implemented.
`plot-host.sh` gains its one missing operation.

**Done when** the domain can be handed this repository's real state through
ports only, and the completeness gate passes.

### Agreeing (Branch: feature/the-domain-agrees-with-production)

The corpus tests, comparing **readings** rather than verdicts: the `PlanStore`
adapter against `plot-plan-meta.sh` over all 158 plans, and the `Refs` adapter
against `plot-fleet-scan.sh`'s pulse.

**Done when** every disagreement is either fixed or filed as a production bug
with its plan — **a disagreement may not be silenced by adjusting the adapter
to match.** If production is wrong, that is a finding and it gets a plan.

**Adapters are written test-first like everything else, but their coverage
threshold is not 100%.** An adapter's uncovered branches are the ones that need
a host to fail, a disk to be full, or a process to die at the wrong moment —
and a threshold that forces those to be faked teaches people to fake them.
**The gate that applies here is the purity-except-adapters grep**, which is what
keeps the untestable code confined to this directory.

### Deciding (Branch: feature/the-workflows-decide-without-acting)

All six workflows as `readings → Decision | Refusal`, with the refusals named
individually.

**Done when** each workflow's refusals are assertable without a repository, and
each `Decision` names every write it would make.

### Writing (Branch: feature/a-decision-writes-what-the-script-writes)

The sandbox tier: the domain's `Decision` applied in a temp repo, asserted
byte-identical against `plot-approve.sh` and `plot-deliver.sh`.

**Done when** approve and deliver produce identical files by both paths, in the
sandbox e2e suite, including the transition records and the sprint annotation.

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
| 158 plans in the corpus | **170** | the Agreeing wave's corpus test is 12 plans wider |
| 46 spawn call sites | **51** | Spawning (plan 3) is 5 sites larger |
| 10 of them invoke `plot-*.sh` | **15 distinct scripts referenced** | the adapter surface is wider than stated |
| `ports/*.ts` are declared | **no `ports/` directory exists** | see below |
| `plot-host.sh` lacks a merged-check | **confirmed** — `mergedAt` appears once, in a comment | unchanged |

**The ports do not exist yet, and the plan assumes they do.** `packages/domain/src`
holds `entities/`, `rules/` and `transitions/` — there is no `ports/`. The
Reading wave says *"adapters for `PlanStore`, `Refs`, `Host`, `Processes`,
`Trees`, `Clock`, `Machine`"*, and the completeness gate asserts *"every
`ports/*.ts` has a directory under `adapters/`"*. Against zero ports that gate
passes vacuously.

**This is a scope question, not a defect.** Either the Reading wave declares the
seven ports as well as their adapters — which is the honest reading of
[DESIGN-ports.md](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md)
§2, since a port is an interface the domain owns — or a slice ahead of it does.
It should be settled before the wave is dispatched, because the gate as written
cannot detect its own omission.

**What HAS landed, and the plan can rely on:** `allSlicesMerged` is in
`@plot-pm/domain` (`rules/deliverable.ts`), re-exported from the board as a
temporary `allWavesMerged` alias. The domain package is real and the board
imports from it.

**What has NOT:** `plot-deliver.sh` still parses the plan itself — three
parsing blocks at lines 127-148, reading both `## Branches` and `## Waves` — and
calls no domain code. That is plan 3's Delivering wave, correctly still open.
