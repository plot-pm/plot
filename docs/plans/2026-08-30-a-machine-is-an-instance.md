# A machine is an instance

> Three projects, one computer, three machines — and the spec says there is exactly one.

## Status

- **Phase:** Draft
- **Type:** docs
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
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

**Measured 2026-08-30 on this computer:**

```
/Users/jwloka/Quatico/Agentic-Tools/plot          Plot + board
/Users/jwloka/Quatico/Agentic-Tools/agent-skills  Plot + board
/Users/jwloka/Quatico/EKZ.Webportal/ekzweb        Plot + board
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

**That is the instance's identity**, and `hostname()` cannot serve as one:
three instances on this laptop return the same string. The port declares
`hostname()` today (`ports/machine.ts:44`) as though it identified something.

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
| identified by | `repoRoot + scriptsDir` | `hostname()` |
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

### The consequence nobody has priced

**If three instances each dispatch against the same hardware, the cap is
per-instance and the exhaustion is shared.** `parallelAgents: 11` is this
project's dial; two other projects have their own. **Nothing reads the sum.**

That is a real defect and it is **not** this plan's to fix — a docs plan that
quietly grew a scheduler would be the wrong shape. **But it must be named**, or
the next reader will assume the spec's silence means it was considered.

### Not chosen: rename Machine to Instance

The word `Machine` is in `DESIGN-agent.md`, `DESIGN-worktree.md`, the domain's
`ports/machine.ts`, `entities/machine.ts`, its adapter and its tests. **A rename
is a large diff that changes no meaning**, and this plan's whole point is that
the meaning was never wrong — only the count.

## Slices

### Correcting (Branch: docs/a-machine-has-an-identity)

`DESIGN-machine.md`'s Identity and §8 sections say a Machine is a Plot instance,
keyed by `repoRoot + scriptsDir`, and that several run per computer.

**Done when** the Identity section states the key and why `hostname()` is not
one; §8's *"if there were two"* argument is rewritten against the measured
three; **the per-computer readings are listed separately from the per-instance
ones**; and the unpriced cap-versus-hardware consequence is recorded as an open
question with the numbers that make it real.

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
