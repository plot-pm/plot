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
> **So this plan stays Draft until the first is Delivered.** That is the gate,
> and it is a human one because Plot has no other.


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

**Each branch does exactly four things:**

1. Point one production call site at the domain
2. **Delete the old implementation in the same commit**
3. Keep the existing tests, unchanged, as the regression lock
4. Rebuild the board artifact

**Step 2 is the discipline.** An adoption that leaves the old code behind
"until we're sure" produces a third copy and no forcing function. The corpus
tests from plan 2 are what makes deleting safe: agreement was proven against
158 real plans before this plan starts.

**Step 3 matters more than new tests.** The board's 25 existing tests for
`allWavesMerged` are written against its *behaviour*, and behaviour is exactly
what must not change. **A test that needs editing to pass is a signal the
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

**The shell reaches the domain through `node`**, which is settled by precedent
rather than proposed here: six scripts already invoke it, and
`plot-sprint-candidates.sh` argues for it in its own comment — *"node is
already required to run the board and every test suite."*

### What each branch must prove before it merges

| | check |
|---|---|
| **behaviour** | the existing tests pass **unedited** |
| **agreement** | the corpus test still reports 158 of 158 |
| **absence** | `grep` finds no second implementation of the adopted rule |
| **the board** | `pnpm build:board` and `pnpm run test:board` are green |

**The absence check is a gate, not a review note.** *"Did I delete the old
one?"* is answerable without looking; *"does this grep return one hit?"* is not.

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

## Waves

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

**Done when** the scan's output is byte-identical against this repo's 158 plans
before and after, and `test/reconcile/` passes unedited.

### Refusing (Branch: feature/the-refusals-are-domain-rules)

`plot-reap.sh`'s five and `plot-dispatch.sh`'s four become domain predicates
returning a named `Refusal`. **The scripts keep their exit codes and their
messages** — a refusal that reports differently breaks whoever reads it.

**Done when** each refusal is still individually triggerable in the e2e suite,
`--dry-run` output is unchanged, and no refusal logic remains in either script.

### Spawning (Branch: feature/one-place-reaches-a-process)

The board's 46 direct process calls give way to the adapter layer's single
`runScript()`. **10 of them invoke a `plot-*.sh` and are the point**; the `git`,
`ps` and `tailscale` calls move behind the `Refs`, `Processes` and `Machine`
adapters respectively.

**This is where the board stops being a process-spawning application** and
becomes one that asks ports. Until it lands, the adapters exist and the board
routes around them — the same shape as `plot-reap.sh` reaching past
`plot-host.sh`, one layer up.

**Done when** `grep -rnE "(execFileSync|execFile|spawn|spawnSync)\(" packages/board/src/server/`
returns only the adapter layer, the browser suite passes unedited, and no exit
code is interpreted outside `runScript()`.

### Transitions (Branch: feature/a-transition-writes-one-value)

`plot-approve.sh` and `plot-deliver.sh` take their writes from
`plan.approve()` / `plan.deliver()` rather than composing them inline.

**Done when** the sandbox e2e suite produces byte-identical plan files by both
paths, and a phase can no longer be written without its record.

## Notes

**This plan can stop between branches and leave a coherent estate.** Each
branch ends with one fewer duplicated rule, and nothing depends on the next one
starting. **That is deliberate** — a migration that must complete to be
coherent is one that blocks a release.

**What it must not do is stop and leave a branch half-adopted.** A production
call site pointing at the domain while the old implementation still exists is
the third-copy state this whole design forbids, and the absence gate is what
prevents a branch from merging in it.

**The story's job 3 — the delta — is deliberately not here.** It is new
capability rather than adoption, and it belongs after the domain is the only
implementation. Adding it during a migration would mean the corpus tests could
no longer compare against production, because production would have nothing to
compare.

### Interrogated 2026-08-30 — the premise holds, the counts moved

Re-measured against `main` at `v2.12.0`.

**The Delivering wave's premise is confirmed.** `plot-deliver.sh` still parses
the plan itself: three blocks at lines 127-148 reading both `## Branches` and
`## Waves`, in a 488-line script that calls no domain code. The wave's claim
that *"the code that had the bug stops existing"* is still available to make.

**The board half is genuinely done.** `allSlicesMerged` lives in
`@plot-pm/domain` (`rules/deliverable.ts`) and the board imports it, re-exported
under a temporary `allWavesMerged` alias so call sites need not change in the
same commit. This plan's statement that plan 1 relocated rather than copied it
is accurate.

| the plan says | measured 2026-08-30 | effect |
|---|---|---|
| 158 plans | **170** | Eligible's byte-identical scan comparison covers 12 more |
| 46 direct process calls | **51** | Spawning is 5 sites larger |
| 10 invoke `plot-*.sh` | **15 distinct scripts referenced** | more adapter surface than stated |

**The Spawning wave's Done-when is now wrong as written.** It asserts

```
grep -rnE "(execFileSync|execFile|spawn|spawnSync)\(" packages/board/src/server/
```

returns only the adapter layer — but the adapters live in
`packages/domain/src/adapters/`, so once they exist that grep over
`packages/board/src/server/` must return **nothing at all**. As written it can
only pass if adapters were placed in the board, which is the layering this plan
exists to remove. The assertion should be emptiness, not "only the adapter
layer".

**The dependency is unchanged and still binds.** This plan needs
`the-domain-runs-the-workflows-in-a-sandbox` delivered — the adapters and
`runScript()` are built there and consumed here. That plan is Draft with no
branch, so nothing here is startable yet.
