# A machine is an instance

> Three projects, one computer, three machines — and the spec says there is exactly one.

## Status

- **Phase:** Approved
- **Type:** docs
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

`DESIGN-machine.md` stops claiming a Machine has no identity. A Machine is a
Plot instance, several run on one computer, and the readings split between the
two — identity to the instance, headroom to the hardware.

## Motivation

### The spec's claim, and the measurement that refutes it

> *A Machine has no identity, because there is exactly one.* … *That singularity
> is load-bearing (§8): **if there were two, headroom would be a property of a
> pair and the whole entity would need a key.***

**Measured 2026-08-30 on this computer** — each verified for a `## Plot Config`
section and a `.plot/` directory, not merely for the name:

```
Agentic-Tools/plot          Plot Config: yes    .plot/: yes
Agentic-Tools/agent-skills  Plot Config: yes    .plot/: yes
EKZ.Webportal/ekzweb        Plot Config: yes    .plot/: yes

hostname:  ani              — the same string for all three
```

**Three projects, three boards, three fleets, one laptop.** The operator states
it plainly: *"we work in three projects on one computer, all of them use Plot and
the board, so we have three machines on the computer."*

**So the case the spec calls hypothetical is the working environment**, and its
own sentence names the consequence: the entity needs a key.

### The key already exists and is already correct

`fleet.ts:648` keys every cache — and therefore every pulse, every PR timer,
every estate — by:

```ts
`${opts.repoRoot}\0${opts.scriptsDir}`
```

**That is the instance's identity**, and `hostname()` cannot serve as one alone:
three instances on this laptop all return `ani`. The port declares `hostname()`
today (`ports/machine.ts:44`) as though it identified something.

### The id: `hostname` + a short id

**Proposed by the operator 2026-08-30**, and it keeps `hostname()` useful
instead of discarding it:

```
ani/0a2719e3      Agentic-Tools/plot
ani/e820212f      Agentic-Tools/agent-skills
ani/6652451c      EKZ.Webportal/ekzweb
```

**The hostname is what makes it unique beyond this computer** — three instances
here, but a fleet spanning laptops needs to say *which* `ani`. The short id is
what separates instances on one.

**What the short id is derived from is the decision, and the candidates split
on one case:**

| candidate | three projects | a board in a worktree |
|---|---|---|
| `basename(repoRoot)` | `plot`, `agent-skills`, `ekzweb` — readable | **`bug-the-loop-reads-the-monitor`** — an id that dies with the branch |
| hash of `repoRoot + scriptsDir` | `0a2719e3`, `e820212f`, `6652451c` — opaque | stable, meaningless, correct |

**The worktree case is not hypothetical here** — this repo runs boards from
worktrees in its own test suite. A basename-derived id would rename itself when
a branch is renamed, and vanish when the branch is reaped.

**And the id must cover both axes the cache key already covers.** `repoRoot` is
`PLOT_REPO_ROOT ?? process.cwd()`; `scriptsDir` is `PLOT_SCRIPTS_DIR ??` the
artifact's own directory (`index.ts:64-65`). **They vary independently** — one
follows the working directory, the other follows where the board was installed
from — so an id derived from the repo alone would merge two machines that the
cache already keeps apart.

**The slice decides; the plan records both options and the constraint.** A
readable id is worth something to an operator reading a log, and a hash is worth
something to a machine that must stay itself across a rename.

### The split the spec almost makes

It already says the right thing about headroom without drawing the conclusion:

> *headroom is not **this fleet's** headroom, it is **the machine's**, and the
> fleet is one tenant among several.*

**Read against three instances, "the machine" there is the hardware.** Three
Plot instances share one CPU: each measures the same spawn cost and calls it its
own. Measured 2026-08-30 — `23.3 ms` while orphans and load loops from *other*
projects' work were running, `4.8 ms` once they were cleaned up.

## Design

### Two entities where the spec has one

| | **Machine** (instance) | **Computer** (hardware) |
|---|---|---|
| identified by | `hostname` + short id, from `repoRoot + scriptsDir` | `hostname()` |
| how many | one per Plot project | one |
| owns | its pulse, its fleet, its estate, its divisors | `spawnCostMs`, `loadAverage`, `cores` |
| answers | *whose clock is this?* | *can anything fork cheaply right now?* |

**Headroom is a property of the computer and is read by every instance.** That
is not duplication — it is three tenants reading one landlord's meter.

### What this changes, and what it deliberately does not

**Changes:** the Identity section, the singularity argument in §8, and whichever
fields are hardware-level rather than instance-level.

**Does not change:** any behaviour. Every reading is taken the same way and
means the same thing; what moves is which entity owns it. **This is a docs plan
and it should stay one.**

### Each machine claims a share, and that is why no scheduler is needed

**Settled by the operator 2026-08-30:**

> *Jede Maschine schneidet sich ein Teil der Hardware-Ressourcen ab.*

**A machine does not negotiate its share; it declares one.** Three instances on
one computer each take a slice of it, and none of them has to know what the
others took.

**The dial for this already exists and is being read wrongly.**
`.plot/state/fleet-controls.json` holds `parallelAgents: 11`, and today that
means *"how many agents do I want"*. Under this model it means *"what share of
the computer do I claim"* — the same number, a different question, and the
second one is answerable by an operator who knows three projects are running.

**So the shared-exhaustion problem dissolves rather than needing a solver.**
It looked like a scheduling problem: three caps, one CPU, nothing reading the
sum. It is not. **The sum is the operator's to keep sensible**, exactly as it is
for any three programs sharing a laptop, and the machine's job is to report what
it is getting — not to bargain for more.

**What the entity split then says:**

| | reads | declares |
|---|---|---|
| **Computer** | `spawnCostMs`, `loadAverage`, `cores` — one measurement, read by all | — |
| **Machine** | that same measurement | **its share**: `parallelAgents` |

**Three instances measuring one spawn cost is correct, not duplication.** They
are three tenants reading one meter, and each knows only how much of the flat it
rented.

**The honest remaining gap is visibility, not arbitration.** It is a reporting
question, and it belongs with `Machine`'s fields rather than with a scheduler.

**Measured 2026-08-30, and the shape is not what the warning assumed:**

```
Agentic-Tools/plot          {"autoDispatch":true,"parallelAgents":11}
Agentic-Tools/agent-skills  no fleet-controls.json
EKZ.Webportal/ekzweb        no fleet-controls.json
```

**Re-measured 2026-09-01, and the finding is unchanged where it matters.** All
three still carry a `## Plot Config` and a `.plot/`, `hostname` is still `ani`
for all three, and `fleet-controls.json` still exists for exactly one. Only the
claimed number moved — `{"autoDispatch":false,"parallelAgents":4,"machineOverride":false}` —
because an operator lowered it by hand so a second machine could take a wave
unraced.

**That is the argument, not an exception to it.** The share was changed for a
reason that lives entirely outside this instance: what another machine was doing.
An operator reached for a per-instance dial to solve a cross-instance problem,
which is precisely what a model with no computer-level entity forces.

**Only one instance has ever claimed a share.** The other two run on
config-seeded defaults (`fleet-settings.ts:137`), which means **the share is
currently implicit for two of the three machines**, not merely unreported.

**That sharpens what the document has to say.** Not *"three at 11 is 33"* — a
sum nobody has actually set — but the prior question: **an unset share is still
a share.** A machine that never declares one still takes CPU, and the default is
seeded from config rather than from anything that knows two other projects
exist.

**So the fields table should record `parallelAgents` as a claim with a default
that is not a measurement**, and say that a machine which has not chosen has
still claimed.

### Not chosen: rename Machine to Instance

The word `Machine` is in `DESIGN-agent.md`, `DESIGN-worktree.md`, the domain's
`ports/machine.ts`, `entities/machine.ts`, its adapter and its tests. **A rename
is a large diff that changes no meaning**, and this plan's whole point is that
the meaning was never wrong — only the count.

## Slices

### Correcting (Branch: docs/a-machine-has-an-identity)

`DESIGN-machine.md`'s Identity and §8 sections say a Machine is a Plot instance,
keyed by `repoRoot + scriptsDir`, and that several run per computer.

**Done when** the Identity section states the id as `hostname` + short id, what
the short id derives from, and why `hostname()` alone is not one — including the
worktree case that rules out a basename; §8's *"if there were two"* argument is rewritten against the measured
three; **the per-computer readings are listed separately from the per-instance
ones**; and **`parallelAgents` is described as a claimed share of the computer
rather than a count of wanted agents** — the same number, the question it
answers restated.

**The visibility gap is recorded, not solved:** nothing reports what the three
instances have claimed between them, and two of them have never said. Say so in the
fields table as a known blind spot.

**Nothing in `packages/domain` changes in this slice.** If the correction implies
a code change, that is a finding for the PR — the spec is what was wrong.

## Done when

1. `DESIGN-machine.md` no longer claims a Machine has no identity.
2. The key is named, and `hostname()`'s inadequacy is stated.
3. Hardware-level and instance-level readings are separated in the fields table.
4. The shared-cap question is recorded, not solved.
5. `pnpm test` green — a docs change should touch nothing else.

## Notes

Cut 2026-08-30 while challenging `the-pulse-is-an-entity`, which had asserted
*one pulse per machine* and called the per-repo cache key a defect. **The
operator's correction inverted it**: the key is the identity, and the spec is
what needs changing.

**The spec was not careless.** It says *"if there were two… the whole entity
would need a key"* — it named the exact condition under which it would be wrong,
and then that condition became the working environment.
