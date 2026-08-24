# A worker starts with its brief

> Auto-dispatch claims a wave and starts a worker without a brief, because it
> wraps the script and the brief is the skill's to write.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A wave auto-dispatch starts has a brief before its worker does. Where no brief
  exists, the fleet says so instead of starting a worker into a plan it must
  re-derive.

## Motivation

### What happened twice on 2026-08-24

`bug/the-agents-tab-filters-on-membership` was claimed by auto-dispatch and its
worker ran for **eight minutes before the brief existed**. The same happened to
`bug/a-wave-renders-as-a-wave-in-every-section` earlier the same evening.

Neither worker was idle in that window. They were reading the plan and deriving
decisions the brief already records.

### What a brief carries that a plan does not

The brief for this very wave names a trap the plan does not:

> `passesSprintFilter` CANNOT be reused as written. It takes a `Card` and keys on
> `card.slug`; an `AgentRow` has no `slug`. The join key is `row.plan`.

That was found by interrogation and cost a round to establish. A worker without
it reaches for the obvious reuse, hits a type error, and improvises — and
improvising is how a wave widens its own scope.

The same brief carries three more settled decisions: the exemption belongs on
row KIND (53 of 55 sprintless rows are plan work), the join must be on
`sprint.members`, and *why* this tab was left behind by #386 — so the worker does
not read a deliberate sequencing decision as an oversight.

### Why the gap exists, and why it is not `plot-dispatch.sh`'s fault

`plot-dispatch.sh` reports `brief=missing` in every summary, and it is a
**constant string, not a measurement**. Its own comment says so:

> *`brief=missing` is CONSTANT, and that is the point: this script cannot write a
> hand-off brief and never will. A brief is interpretation … and no script here
> invokes a skill — bash cannot reach one at all. `/plot-implement` owns the
> brief; the plot-dispatch SKILL invokes it after a fan-out.*

That design is right. The script claims and starts; the skill interprets.

**Auto-dispatch bypasses the skill.** `auto-dispatch.ts` spawns
`plot-dispatch.sh` directly (`wrapping plot-dispatch.sh — which still owns the
claim`), so nothing in the automatic path ever reaches `/plot-implement`. The
brief is not late; it is never written unless a person writes it.

## Design

### The fleet checks what the script cannot

A brief's existence is a FILE question — `.plot/briefs/<branch-suffix>.md` — and
the board can ask it even though bash cannot write one. Auto-dispatch checks
before it spawns.

`plot-dispatch.sh` is unchanged. It keeps reporting the constant, because its
reasoning holds: a gate there would block `--dry-run` and `--status`, and *"a
gate that blocks looking-before-leaping is a gate in the wrong place."*

### A missing brief stops the automatic start, not the manual one

Auto-dispatch **does not start** a wave with no brief, and says which wave and
why. An operator running `/plot-dispatch` is choosing deliberately and is not
stopped — the same split the parallel-agents cap takes in
`a-worker-asks-for-the-next-wave`: automatic paths refuse, deliberate ones warn.

The asymmetry is the point. Auto-dispatch acts with nobody watching, so its
refusals are how a person learns something is missing. A manual dispatch has a
person there already.

### The board offers to write it

Where auto-dispatch declines for a missing brief, the row says so and offers
**Write brief** — the same shape as the existing `Implement` and `Dispatch`
actions, and reaching the same place: `/plot-implement`, which owns briefs.

That closes the loop without teaching a script to interpret. The board can
invoke a skill; `plot-dispatch.sh` cannot.

## Waves

### Checked (Branch: bug/auto-dispatch-waits-for-a-brief)
- auto-dispatch does not start a wave whose brief is absent, and names it

### Offered (Branch: feature/the-board-offers-to-write-a-brief)
- the row offers **Write brief**, running `/plot-implement` for that wave

## Done when

1. **Auto-dispatch starts nothing for a wave with no brief**, and its message
   names the wave and the expected path.
2. **It starts normally once the brief exists** — asserted by creating the file
   and pulsing again, so the check is on the FILE and not on a one-shot flag.
3. **A manual `/plot-dispatch` is unaffected**, brief or no brief. The
   deliberate path keeps working.
4. **`plot-dispatch.sh` is unchanged** — no new gate, and `brief=missing` stays
   the constant it documents itself to be.
5. **The row offers Write brief** where the brief is missing, and not otherwise.
6. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Not chosen: teach `plot-dispatch.sh` to check

A file test is within bash's reach, and the script could refuse on it. Rejected
because the script's comment argues the case already: `--dry-run` and `--status`
are legitimate direct calls, and refusing them to protect an automatic path
would move the cost onto the person inspecting before leaping.

### Not chosen: have auto-dispatch write the brief itself

It would need to interpret the plan — which alternatives were rejected and what
killed them — and that is a skill's work, not a server's. The board can INVOKE
`/plot-implement`; it should not reimplement it. Wave 2 does the former.

### The window is real and was measured

Eight minutes on one wave, and both of tonight's auto-dispatched workers started
brief-less. Neither had crashed or stalled: the time went on re-deriving what
the brief already said.
