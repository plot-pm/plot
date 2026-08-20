# A wave is a thing, not a label

> The scan already reports a wave as an object with its own verdict:
> `{name: 'Tracer', verdict: 'eligible', branches: [1]}`. The board flattens it
> into a **string on a branch row** — `row.wave = 'Shaped'` — which inverts the
> relationship: **the branch does not have a wave; the wave has branches.**
>
> Measured on the live payload: 3 of 6 rows carry a `wave` string, **0 carry a
> `verdict`**. The wave's own status is thrown away and re-rendered as prose in
> a branch's note.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

### The wave exists, with a status, and the board has no place for it

`plot-fleet-scan.sh --json` emits per plan:

    waves: [
      { name: 'Tracer',         verdict: 'eligible', branches: [ … ] },
      { name: 'Implementation', verdict: 'blocked',  branches: [ … ] },
    ]

A name, a **verdict** — `complete` | `eligible` | `blocked` — and the branches it
holds. That is an entity: it has an identity, a status, and contents.

The board's contract keeps `waves` on the *plan* (`schema.ts:38`) and then puts
`wave: string` and `verdict: … .nullable()` on the **branch row**
(`schema.ts:1836`). So the wave arrives as an adjective and its verdict arrives as
an optional field on something else.

### Three defects measured separately today are this one defect

| symptom | measured |
|---|---|
| `data-wave` renders beside the kind label | 8 kind labels, 3 wave elements, competing for one track |
| the phase column held four meanings | wave name *or* plan phase — both are labels on a row that owns neither |
| `blocked by Surfaced — 1 outstanding` is note prose | `blockedNote(wave, outstanding)` at `schema.ts:812` builds a **sentence** from a wave's status |

The third is the clearest. A wave's verdict is `blocked` and the wave it waits on
is named — that is structured data, rendered as a string into a branch's note
column because there is no wave row to put it on.

### Why the inversion matters beyond rendering

A branch belongs to exactly one wave; a wave holds one or more branches. Modelling
it the other way round means:

- **A wave with no eligible branch cannot be shown.** Its state is `blocked`, and
  the only rows are its branches — each of which repeats the same word.
- **A wave's verdict is repeated per branch** instead of stated once. Measured on
  a five-branch wave, five rows would each carry `blocked`.
- **The plan heading has to do the wave's job.** `2 waves, first eligible` on a
  plan row is a summary of wave states, written because the waves themselves have
  no rows.

## Design

### `wave` becomes the eighth kind

The tuple's rule applies unchanged — an item links **what it came from and what it
travels on**:

| kind | came from | travels on | artifact links |
|---|---|---|---|
| **Wave** | a **plan** | the **branches** it holds | **plan, branch(es)** |

So a wave row is:

| icon | kind | name | artifact links | status | age |
|---|---|---|---|---|---|
| wave | `Wave` | `Shaped` | `a-row-is-a-tuple`, `feature/a-row-is-a-tuple` | `eligible` | `1d` |

**Name**: the wave's name — which is why every wave earns one, the convention
recorded in the plan template on 2026-08-20. A nameless wave would render a
nameless row.

**Status**: the verdict the scan already computes. `complete`, `eligible`,
`blocked` — and where blocked, *what it waits on* becomes the artifact link to
that wave rather than a sentence in a note.

**Artifact links**: its plan, and its branches. A wave holding five branches links
five — the artifact slot is zero-or-more, and this is the kind that uses the
upper end of it.

### What happens to `row.wave` and `row.verdict`

They stop being read for display. The branch row keeps carrying them, because a
branch **does** know which wave it is in and the fleet scan needs that join — but
the rendering moves:

| today | after |
|---|---|
| `row.wave` rendered beside the branch name | the branch's wave is stated by which wave row holds it |
| `row.verdict` on a branch, nullable, unrendered | the wave's own status column |
| `blockedNote(wave, outstanding)` as note prose | the blocking wave as an **artifact link** on the blocked wave's row |
| `2 waves, first eligible` on the plan heading | the wave rows say it themselves |

**`blockedNote` is the one to watch.** It exists because a wave's state had
nowhere to go; with a wave row it becomes redundant, and a redundant sentence
builder is where the next hand-written status will appear.

### Where wave rows live

A wave is not a section — it is a row, and it belongs in the section its **state**
puts it in, by the grammar `every-section-has-one-subject` settles:

| verdict | section | why |
|---|---|---|
| `eligible` | NOT STARTED | it can be started and nobody has |
| `blocked` | NOT STARTED | it is waiting on another wave, not on a person |
| `complete` | DONE | nothing left in it |

**A wave never goes to WORKING** — an agent works, a wave does not. And never to
WAITING ON A MACHINE: a wave is not a build.

### What must not change

- **The scan.** It already emits waves with verdicts; nothing about
  `plot-fleet-scan.sh` changes.
- **The branch row's `wave` and `verdict` fields.** They stay on the contract —
  the join needs them. What changes is that the *renderer* stops reading them.
- **Section membership for branches.** A branch row moves nowhere.
- **The tuple's rules.** This is the eighth kind under the existing rules, not a
  new shape.

### Open Points

- [ ] **Does a wave row replace its branch rows, or sit above them?** Replacing
      collapses a five-branch wave to one row and hides which branch is claimed —
      information the fleet needs. Sitting above them re-creates the plan-heading
      problem one level down. A third option: the wave row appears only where its
      branches would **not** — a blocked wave with nothing to show, a complete one
      — and expands to its branches where they matter. Decide from a rendered
      board with a multi-wave plan.
- [ ] **Is `Wave` a kind or a group?** This plan says kind, because it has a name,
      a status and links — the tuple's test. But it is also the only kind whose
      artifact links are *containment* rather than provenance, which may argue it
      is a grouping the sections already do.

## Branches

### Modelled
- `feature/a-wave-is-a-kind` — the contract carries a wave as a row with its name, its verdict as status, and its plan and branches as artifact links; the scan's existing wave objects are the source. Tests: a wave row renders all six slots; its status is the scan's verdict, unchanged; a blocked wave links the wave it waits on **as an artifact link**, not as note prose; a wave holding five branches renders five artifact links; a wave with no name fails loudly rather than rendering blank; no host call is added; the scan is untouched.

### Relocated
- `bug/the-branch-row-stops-labelling-its-wave` — `row.wave` and `row.verdict` stop being rendered on a branch row; the fields stay on the contract for the join. Tests: a branch row shows no wave label; **no `data-wave` element exists in the kind's track**; `blockedNote` has no caller; the plan heading no longer summarises wave states; a branch's wave is still discoverable — through the wave row that holds it.

## Notes

The operator's correction is the whole design: *"Nicht der BRANCH hat die WAVE
sondern anders herum."*

The inversion is why three defects measured separately today are one. A wave name
beside a kind label, a phase column with four meanings, and
`blocked by Surfaced — 1 outstanding` as a sentence are all the same thing: **a
first-class entity rendered as an adjective on something else, and its status
rendered as prose because it has no column of its own.**

Worth noting that the scan was right all along. It has emitted
`{name, verdict, branches}` per wave since waves existed; the board read the name,
dropped the verdict onto the wrong object, and rebuilt the verdict as English in
`blockedNote`. Every piece was present.
