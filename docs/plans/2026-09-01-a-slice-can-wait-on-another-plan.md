# A slice can wait on another plan

> A slice blocked by work in a different plan is offered as claimable, because
> eligibility is computed per plan and nothing compares two.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 0
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- A branch may declare that it waits on a branch of another plan, and the fleet
  stops offering it until that branch has merged.

Board impact: the fleet payload gains a reason on a branch that is held; the scan
reads one more annotation. The plan format gains one annotation, parsed the way
`deferred:` already is.

## Motivation

### Measured 2026-09-01, and it happened twice in one session

**`a-third-connector-costs-one-adapter`** cannot start until
`bug/the-budget-knows-which-bucket-it-spent` — a slice of
`one-account-has-one-budget` — has merged, because until then two `fleet.ts`
branches still consume the closed enum it removes. **The fleet offered it as
claimable anyway**, and the only thing standing between a worker and premature
work was a paragraph in its brief.

**`the-pulse-is-an-entity`'s Waiting slice** must not land before
`the-registry-supervises-its-agents` builds the gate that replaces
`plot-dispatch.sh:558`'s birth guarantee. Same shape, different plans, also
prose.

**And `one-account-has-one-budget` was amended for the same reason** — the
Spawning slice overlapped `the-read-path-stops-spawning`, and the amendment says
plainly: *"Plot cannot see the overlap. Slice eligibility is computed per plan,
so nothing compares two approved plans over one file."*

### The population, measured

| | count |
|---|---|
| plans linking to another plan file | **18** |
| plans declaring an ordering constraint in prose | **6** |
| of those, expressible as *branch X must merge first* | 2 |
| gated on a **measurement** instead | 1 |

**So this is not one case dressed as a pattern**, and it is also not universal:
six of 188 plans. A heavyweight dependency graph would be machinery for six
edges.

### Prose is a rule, and the rule is already being tested

`plot-dispatch.sh` refuses on a phase, a live pid, a `PLOT-BLOCKED` marker and a
missing brief — **all gates**. A cross-plan dependency is the one ordering
constraint expressed as a sentence a worker may or may not read, in a document
the worker is told to read first but which nothing verifies it understood.

## Design

### One annotation, on the branch, parsed the way `deferred:` already is

    - `feature/x` <!-- waits: bug/the-budget-knows-which-bucket-it-spent --> — description

**The precedent is exact.** `plot-plan-meta.sh` already parses per-branch HTML
comments and exposes `waves[].branches[].deferred_reason`; this adds a sibling
key and no new mechanism. A branch may name **one** branch it waits on — not a
list, because a slice needing two prerequisites is a slice that has not been cut
finely enough, and a list invites a graph nobody wants to debug.

### The scan holds it; the dispatcher refuses it

**`plot-fleet-scan.sh`** already asks the host whether a branch has merged, for
every branch of every plan. **The waited-on branch is such a branch**, so the
answer costs no new round trip — it is already in the terminal-state cache.

- **waited-on branch merged** → the slice is eligible as it is today
- **not merged** → verdict `waiting`, with the branch it waits on named
- **not found at all** → **`blocked`, not eligible.** A typo'd or deleted
  dependency is not permission; the same direction `plot-pr-merged.sh` takes when
  a host is unreachable.

**`plot-dispatch.sh`** refuses to start it, beside its four existing refusals,
naming what it waits on. `--allow-waiting` is the named escape, in the tradition
of `--allow-local` and `--force`.

### What it must NOT become

**Not a dependency graph.** One branch, one prerequisite, no transitive
resolution. If a plan needs a DAG, the plans are wrongly cut.

**Not a substitute for a measurement gate.** `the-registry-supervises-its-agents`
defers its daemon on *"a week of visibility AND a non-zero count of
reported-but-unattended desks"* — **deliberately not mechanical**, because the
plan is willing to cancel itself if reporting turns out to be enough. Encoding
that as `waits:` would replace a judgement with a branch name and lose the
cancellation. **`deferred:` remains the annotation for a judgement; `waits:` is
only for a fact a script can check.**

**Not a cross-repo mechanism.** The waited-on branch is in this repo. A
split-home plan is a different problem and this must not pretend to solve it.

### Not chosen: infer the dependency from a shared file

Two plans touching one file is a *collision*, which `plot-dispatch.sh` already
reports before fanning out, and it is not the same as a dependency: the connector
plan waits on the budget plan because of a *behaviour* that must exist first, not
because they edit one file. **Inference would find the wrong pairs and miss this
one.**

## Branches

### Declaring

- `feature/a-branch-names-what-it-waits-on` — `plot-plan-meta.sh` parses `<!-- waits: <branch> -->` beside `deferred:`, exposing `waves[].branches[].waits_on`. Parser and contract only; nothing consumes it yet, so the shape settles before three components read it. **The parser test must cover a `waits:` naming a branch no plan declares** — that is the case the scan turns into `blocked`.

### Holding

- `feature/the-scan-holds-a-waiting-slice` — the scan reports `waiting` for a branch whose prerequisite has not merged, and `blocked` where the prerequisite cannot be found. Uses the merged answer it already has; no new host call. The fleet payload carries the branch name so a reader can see what it waits on.

### Refusing

- `feature/dispatch-refuses-a-waiting-slice` — `plot-dispatch.sh` refuses to start it, names the prerequisite, and honours `--allow-waiting`. **The refusal is the point:** until this lands, the constraint is prose in a brief.

## Done when

- A branch annotated `waits:` on an unmerged branch is **not offered by
  `--next`**, and `plot-dispatch.sh` refuses it by name.
- A branch annotated `waits:` on a **merged** branch behaves exactly as it does
  today — asserted, because a dependency that never clears is a deadlock.
- A `waits:` naming a branch **no plan declares** reads `blocked`, not eligible.
- **`deferred:` is untouched**, and a test asserts the two annotations do not
  interfere on one branch.
- The two live cases carry the annotation and stop needing their prose:
  `a-third-connector-costs-one-adapter` and `the-pulse-is-an-entity`.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm build:board`, changeset.

## Notes

**Found by dispatching into it.** On 2026-09-01 the fleet offered
`feature/the-domain-forgets-the-vendor-list` as claimable while its prerequisite
had no branch and no PR. Nothing was harmed, because the slice was not
dispatched — but the only reason was a person reading the brief they had just
written.
