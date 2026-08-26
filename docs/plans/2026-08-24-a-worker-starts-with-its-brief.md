# A worker starts with its brief

> Auto-dispatch claims a wave and starts a worker without a brief, because it
> wraps the script and the brief is the skill's to write.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-26, Jan Wloka, `bug/auto-dispatch-waits-for-a-brief`
- **Started:** 2026-08-26, Jan Wloka, `feature/the-board-offers-to-write-a-brief`

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

**Which copy of that file to ask about is not settled here, and the wave begins
by measuring it.** The obvious implementation is an `existsSync` against the
board's own checkout, and the obvious implementation has a measured failure
mode: on 2026-08-26 the board was running from a worktree **24 commits behind
main**, holding 152 briefs where main held 155. Three briefs that exist would
have read as missing, and this plan's whole purpose is to stop a start that
should have happened — inverted, it stops starts that should have.

The alternative is `git cat-file -e origin/main:.plot/briefs/<x>.md` per
candidate, which cannot be wrong about main but is a process spawn inside the
5-second pulse. `maybeAutoDispatch` runs on the scan's success path, so anything
paid there is paid every pulse, and the scan already costs 18.3 s against that
cadence.

So the wave **opens with a spike, not a fix**: how far behind main does a board
checkout actually run, across the checkouts on this machine, and what does one
`cat-file` per candidate cost with the pulse's real candidate count? Both
numbers are cheap to get and neither is guessable — a filesystem read is free
and sometimes wrong, a git read is always right and might be affordable. The
spike's answer decides, and it is recorded in this plan before the check is
written.

Do not skip to the implementation. The measurement is the deliverable of the
first half of this wave.
`plot-dispatch.sh` is unchanged. It keeps reporting the constant, because its
reasoning holds: a gate there would block `--dry-run` and `--status`, and *"a
gate that blocks looking-before-leaping is a gate in the wrong place."*

### A missing brief stops the automatic start, not the manual one

Auto-dispatch **does not start** a wave with no brief, and says which wave and
why. The stop is hard: not a warning that starts anyway, not a one-time skip
that lets the next pulse through. An operator running `/plot-dispatch` is choosing deliberately and is not
stopped — the same split the parallel-agents cap takes in
`a-worker-asks-for-the-next-wave`: automatic paths refuse, deliberate ones warn.

The asymmetry is the point. Auto-dispatch acts with nobody watching, so its
refusals are how a person learns something is missing. A manual dispatch has a
person there already.

**A hard stop is only safe because the refusal is not sticky.** The check runs
on every pulse and reads the file each time, so writing the brief unblocks the
wave on the next pass — no flag to clear, no restart, nothing for an operator to
remember. That is the load-bearing half of Done-when 2, and it is what
distinguishes this from a refusal an operator has to undo.

The recovery path was walked twice on 2026-08-24: both brief-less workers
received their brief mid-run, and in both cases the fix was writing the file.
Under this plan those two never start — and the same act that would have
rescued them is the one that releases them.
### The board offers to write it

Where auto-dispatch declines for a missing brief, the row says so and offers
**Write brief** — the same shape as the existing `Implement` and `Dispatch`
actions, and reaching the same place: `/plot-implement`, which owns briefs.

That closes the loop without teaching a script to interpret. The board can
invoke a skill; `plot-dispatch.sh` cannot.

## Waves

### Checked (Branch: bug/auto-dispatch-waits-for-a-brief, PR: #431)
- **first**, the spike: how far behind main a board checkout runs, and what one
  `git cat-file -e origin/main:…` per candidate costs inside the pulse — the two
  numbers that decide where the check reads from. Record the answer in this plan.
- then: auto-dispatch does not start a wave whose brief is absent, and names it

### Offered (Branch: feature/the-board-offers-to-write-a-brief, PR: #432)
- the row offers **Write brief**, running `/plot-implement` for that wave

## Done when

1. **Auto-dispatch starts nothing for a wave with no brief**, and its message
   names the wave and the expected path.
2. **It starts normally once the brief exists** — asserted by creating the file
   and pulsing again, so the check is on the FILE and not on a one-shot flag.
   This is the assertion that makes a hard stop safe: a refusal nobody can lift
   without restarting the board would be worse than the defect.
3. **A manual `/plot-dispatch` is unaffected**, brief or no brief. The
   deliberate path keeps working.
4. **`plot-dispatch.sh` is unchanged** — no new gate, and `brief=missing` stays
   the constant it documents itself to be.
5. **The row offers Write brief** where the brief is missing, and not otherwise.
6. **The spike's numbers are in this plan** before the check is written, and the
   choice of source names them. A check reading the working tree must state the
   measured lag it tolerates; one reading `origin/main` must state its measured
   per-pulse cost.
7. **A brief that exists only on main is not reported missing.** The 2026-08-26
   case, asserted directly: a board checkout behind main, a brief present on
   main and absent locally, and no refusal. If the spike chooses the filesystem,
   this item is what that choice has to survive.
8. `pnpm run test:board` green; artifact rebuilt and committed.

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

### Not chosen: warn and start anyway

A soft refusal keeps the fleet moving and surfaces the gap, which is the usual
right answer for an automatic path. Rejected here because the thing being
protected is the worker's first hour: a warning nobody reads until after the run
arrives exactly when the re-derivation has already happened. The measured cost
was eight minutes on one wave and an unknown amount on the other, and a warning
recovers none of it.

The manual path keeps the soft treatment, which is where that answer belongs.

### The window is real and was measured

Eight minutes on one wave, and both of tonight's auto-dispatched workers started
brief-less. Neither had crashed or stalled: the time went on re-deriving what
the brief already said.
