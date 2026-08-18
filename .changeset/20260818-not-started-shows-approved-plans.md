---
"@plot-pm/board": patch
---

board: NOT STARTED shows Approved plans, and nothing else

The section groups by **branch state** and never asked the plan's **phase**. A
branch with no ref reads as "never started" — which is true of a branch nobody
created and equally true of one deleted at merge four months ago.

Measured on this board 2026-08-18, ten plans in NOT STARTED:

```
approved   3   ← the only ones /plot-dispatch will start
draft      7   ← refused with "plan not approved yet"
released   1   ← plot-sprint-support, shipped in v1.0.0-beta.3
```

Measured again after a plan-hygiene sweep set 39 delivered plans to `Released`
— **20 rows, ten of them Released**, each offering a merged branch:

```
Released  a-squashed-branch-is-…  bug/a-squashed-branch   eligible — nobody has taken it
Released  bb-state-vocabulary     bug/bb-state-vocabulary eligible — nobody has taken it
Released  the-gate-reads-what-w…  bug/the-gate-reads…     eligible — nobody has taken it
```

All three shipped in v2.5.1 the same day. **The board was advertising released
work as available**, and the sweep did not cause that — it multiplied a defect
that had been hiding behind a single row.

The section is now filtered on the plan's phase FIRST:

| Phase | May an agent take it? | Section |
|---|---|---|
| Draft | no — waits on approval | WAITING ON YOU |
| **Approved** | **yes** | **NOT STARTED** |
| Delivered | no — work is done | DONE |
| Released | no — shipped | DONE |

**This is not a rule layered on top of the phase model — it is the phase
model.** `Approved` is precisely the phase meaning *decided, not yet done*, and
the only one in which `/plot-dispatch` hands a branch to an agent. Stated as one
inclusion rather than three exclusions because that is what it is.

A `Draft` plan moves to WAITING ON YOU and **names what it waits on** —
approval — rather than offering a branch nobody may claim. A `Delivered` or
`Released` plan lands in DONE, with a note accounting for the missing ref:
`plot-sprint-support` has no branch because the change went straight onto main.

**The phase is read from the plan, never inferred from the branches.** Inferring
is the defect: a Released plan whose branch has no ref is bit-identical in git
to an Approved plan nobody has started, and only the plan says which it is.

**Within `Approved`, nothing changed.** Branch state is still what refines the
answer there, and an Approved plan with unclaimed branches renders exactly as
before — the phase is the first question, not a replacement for the second.

Three orderings are deliberate and tested:

- **Below the local-worktree check.** Someone editing a branch of a shipped plan
  is still someone editing; the board reports what is, not what the bookkeeping
  says should be.
- **Above the wave verdict.** A blocked wave of a finished plan is not blocked,
  it is finished.
- **Only for `open` branches.** A finished plan whose branch carries commits, a
  claim or a PR keeps its git answer — drift between a plan's records and its
  git state is worth seeing rather than smoothing over, the same rule `rowPhase`
  already follows.

**An allowlist, not a blocklist**, matching `prAsksNobody` in the same file and
for its reason: a blocklist of finished phases would silently start claiming *an
agent may take this* the first time a phase is added. An unrecognised phase
lands in DONE and names itself, so the plan file is where the reader is sent.

**A pulse reporting no phase is unchanged.** Absent is not a guess — a scan
predating the field says nothing about the plan, and reading that as unstartable
would empty the section wholesale against an older scan.

Derived, never stored: a plan that becomes Approved changes section on the next
pulse with nothing to clear and no restart, which is asserted by scanning one
fixture twice.

`waitingOnFor`'s draft arm is **deleted** rather than left unreachable. It
answered `you` for a Draft plan's first wave because those rows used to sit in
this section; they no longer arrive, so a dead arm there would be a second rule
asserting they belong — exactly the drift that function's derive-from-the-group
shape exists to prevent. The concern it answered is answered better by the move:
a four-wave Draft plan no longer puts four loud rows on the board for one
pending approval, because it puts none.

The Start button needed no change, and that is the check that the split is in
the right place: `isStartable` reads `waitingOn === 'click'`, which is null
outside `not-started` by construction, so Draft and Released rows lose their
button without a second rule anywhere.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` changed but the generated `board-server.mjs` artifact, which is
rebuilt output rather than authored skill content. The `/api/fleet` payload is
unchanged — `phase` has travelled on the pulse since #140, reported and unread;
this decides with it. No skill documents which section a plan's rows land in.
