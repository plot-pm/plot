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

- **Phase:** Superseded
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Superseded:** 2026-08-23, by `the-wave-is-a-thing-the-board-can-hold`
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

### A wave BELONGS TO a plan and HOLDS branches

**Corrected 2026-08-20, in response to the operator's question — *"Wie kann eine
WAVE Pläne als kinder haben?"* — which this section had got backwards.**

An earlier draft of this section wrote *"a wave **has plans**"*, and that is
wrong in the direction it matters. The scan settles it: `plot-fleet-scan.sh`
emits `waves` **inside** a plan —

    plans: [ { file: …, waves: [ { name, verdict, branches } ] } ]

— and a wave is a `### Name` heading **within** a plan file. A wave cannot have
plans as children; **a plan has waves.**

What the operator's original correction said was about the level below:
*"Nicht der BRANCH hat die WAVE sondern anders herum"* — the branch does not have
the wave, **the wave has branches**. That is one inversion, at one level, and
generalising it upward into *the wave has plans* was an error this plan made on
its own.

So the containment chain has one direction throughout:

    plan  ──has──▶  wave  ──has──▶  branch

| kind | its links are | direction | prefix |
|---|---|---|---|
| PR | its plan, its branch | **provenance** — where it came from, what it rides | **`PLAN`**, **`BRANCH`** |
| Release | its PR, its branch | **provenance** | **`PR`**, **`BRANCH`** |
| **Wave** | **its branches** | **containment** — what it holds | **none** |

**The wave links DOWN, never up.** Its branches are its contents, so they need no
prefix saying which way to read them; and its plan is not in slot 4 at all,
because the plan is the row the wave is nested *under* and that placement is the
statement. `PLAN fleet-scan-asks-the-host` rendered three times directly beneath
the plan row heading those three rows — a link pointing up, at the thing one line
above, three times over.

### The duplication measured

From the live payload, NOT STARTED holds **one** row:

    kind=plan  plan=fleet-scan-asks-the-host  wave=Shaped  note=approved — nobody has taken it

The screen shows **two**. `countsPlans = key === 'not-started'`
(`AgentList.tsx:5236`) makes NOT STARTED always render a plan line, and
`showsWaveFold` (`:1026`) returns `group.rows.length > 1`. With a one-wave plan
there is nothing to fold, so the plan line and the wave row stand side by side
saying the same thing — one labelled `PLAN … 1 wave … Design`, the other
`PLAN Shaped … approved — nobody has taken it`.

**The grouping stays; the duplication goes.** Waves under a plan, expandable, is
what the operator asked to keep. What must not survive is a plan rendered twice
because one of its rows happens to be its only wave.

### Rendered with three waves, every defect is in one frame

Reproduced 2026-08-20 with `PLOT_BOARD_MOCK=1` and a three-wave plan — the state
a one-wave plan hides:

    PLAN  fleet-scan-asks-the-host        3 waves                            Design   WAITING 1d
    PLAN  f…an-asks-once   [Shaped]     PLAN fleet-scan-asks-the-host  approved…   open    1d
    PLAN  …ds-its-owner    [Relocated]  PLAN fleet-scan-asks-the-host  blocked by Shaped — 1 outstanding   open  1d
    PLAN  b… -column-goes  [Moved]      PLAN fleet-scan-asks-the-host  blocked by Relocated — 1 outstanding  open  1d

**The grouping works** — the fold is there, `3 waves` counts them, the four rows
are one box. Everything inside it is wrong:

| slot | shows | should |
|---|---|---|
| kind | `PLAN` four times | `PLAN`, then **`WAVE`** three times |
| name | the **branch** (`f…an-asks-once`) | the **wave** (`Shaped`) |
| — | `Shaped` as a trailing badge | that *is* the name, not an ornament |
| artifact | `PLAN fleet-scan-asks-the-host` **three times** | nothing — the nesting states it |
| status | `open` three times | `eligible`, `blocked`, `blocked` — the verdicts the scan already computed |
| note | `blocked by Shaped — 1 outstanding` | a **link** to the `Shaped` row one line above |

Two things this frame settles that prose could not:

**The plan link is repeated three times directly beneath the plan that heads the
group.** Containment needs no prefix *and* needs no link — the row above is the
link.

**`blocked by Shaped` is a sentence about a row on screen.** `Shaped` is rendered
one line up; the note spells its name in prose instead of pointing at it. That is
`blockedNote()` doing a job an artifact link should do, and it is why that
function becomes redundant rather than merely wordy.

### `wave` becomes the eighth kind

So a wave row is:

| icon | kind | name | artifact links | status | age |
|---|---|---|---|---|---|
| wave | `Wave` | `Shaped` | `feature/a-row-is-a-tuple` — its branches, **unprefixed** | `eligible` | `1d` |

**Icon**: Octicons' **`stack`** — three layered planes. Chosen because a wave
*is* a layer of a plan and layers stack in order, which is exactly what the wave
sequence expresses: *Shaped* before *Relocated* before *Moved*. The contrast with
`plan` (a checklist) is the right one: a plan lists intentions, a wave bundles the
work.

Considered and declined: `versions` reads as release versions, and `git-merge` is
too close to the PR icon it would sit beside.

**Name**: the wave's name — which is why every wave earns one, the convention
recorded in the plan template on 2026-08-20. A nameless wave would render a
nameless row.

**And 6 of the 71 waves in this estate have no name.** Counted on
`last-pulse.json` 2026-08-20, all six in plans written before the template
convention: `a-blocked-wave-is-not-eligible`,
`a-question-nobody-can-answer-is-a-hang`, `an-issue-is-a-signal-the-board-can-see`,
`the-repair-exists-but-nothing-calls-it` and two others. The server already
substitutes `'(unnamed)'` for them at `fleet.ts:3695`.

So the branch spec below asking that *a wave with no name fails loudly rather
than rendering blank* is **withdrawn**, and it is worth saying why, because it
read as the careful choice. Loudly-failing is right for a fact the board
**derives** — a wave whose verdict it could not compute has nothing honest to
show. It is wrong for a fact the board **reads**: the name is the plan file's,
six plans predate the convention, and a board that refuses to render them makes
six real waves invisible to punish six old plan files. The board is not the
enforcement point for a plan-authoring convention; `plot-plan-meta.sh` is, and
it has the plan file in front of it.

`(unnamed)` renders, and it renders as **text rather than as a link** — there is
no wave to point at when the plan file did not name one. Six rows that read
`(unnamed)` are a legible prompt to go and name them; six missing rows are not.

**Status**: the verdict the scan already computes. `complete`, `eligible`,
`blocked` — and where blocked, *what it waits on* becomes the artifact link to
that wave rather than a sentence in a note.

**Artifact links**: its **branches**, unprefixed. Not its plan — the plan is what
the wave sits under, and the nesting states it. A wave holding five branches links
five; the artifact slot is zero-or-more, and this is the kind that uses the upper
end of it.

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

- [x] **Does a wave row replace its branch rows, or sit above them?** It
      **replaces them where it holds one, and sits above them where it holds
      several** — settled 2026-08-20 by counting the estate rather than by
      reasoning about the two shapes.

      Measured over `last-pulse.json`, 35 plans and **71 waves**:

      | branches in the wave | waves |
      |---|---|
      | 1 | **57** |
      | 2 | 8 |
      | 3 | 3 |
      | 4 | 1 |
      | 5 | 2 |

      So the multi-branch wave is real — 14 of 71 — and the fear behind this
      question was not imaginary. But the **intersection with the verdict is
      what decides it.** Of those 14, thirteen are `complete` and one is
      `blocked`. Every one of the 11 `eligible` waves holds **exactly one
      branch**, and across all 21 unfinished waves the distribution is
      **20 × one branch, 1 × five branches** — the five being
      `opus5-longhorizon-hardening :: Implementation`, the 25-day-old plan
      behind PR #57.

      That is not a coincidence to be designed around; it is how a fleet
      behaves. A wave becomes eligible when its predecessor completes, and
      dispatch claims its branches immediately — so a wave is found with many
      branches either **before** anything reached it or **after** everything
      finished, and almost never in between.

      The consequence for the render is that **one row is the common case and
      the fold is the exception**, which is the reverse of what this question
      assumed. So:

      - a wave holding **one** branch renders **one** row — the wave's, naming
        the wave, and the branch is its artifact link;
      - a wave holding **several** renders the wave row **with a fold**, the
        branches beneath it, exactly the disclosure a plan already has.

      The third option in the original question — *show the wave row only where
      its branches would not* — is declined: it makes the row's presence
      conditional on a count, which is the `showPlanHeading` shape this estate
      has now reversed four times. The wave row is always there; what varies is
      whether it has children to disclose.
- [x] **Is `Wave` a kind or a group?** Both, and they do not conflict — settled
      2026-08-20. It is a **kind** because it has a name, a status and links, which
      is the tuple's test. Its links express **containment** rather than
      provenance, and the consequence is that they carry **no prefix**: the row's
      nesting under its plan says what a `PLAN` label would repeat. So the
      grouping stays — waves under a plan, expandable — and the wave row is a
      first-class row inside it.

## Branches

### Modelled
- `feature/a-wave-is-a-kind` — the contract carries a wave as a row with its name, its verdict as status, and its plan and branches as artifact links; the scan's existing wave objects are the source. Tests: a wave row renders all six slots; its status is the scan's verdict, unchanged; a blocked wave links the wave it waits on **as an artifact link**, not as note prose; a wave holding five branches renders five artifact links; a wave with no name renders `(unnamed)` as text, not as a link, and is not hidden (6 such waves exist); no host call is added; the scan is untouched.

### Relocated
- `bug/the-branch-row-stops-labelling-its-wave` — `row.wave` and `row.verdict` stop being rendered on a branch row; a one-wave plan renders **one** row rather than a plan line beside its only wave; the fields stay on the contract for the join. Tests: **a plan with one wave produces exactly one row in NOT STARTED**; a plan with three waves keeps its foldable grouping; a wave row's artifact links carry **no `PLAN` prefix**; a branch row shows no wave label; **no `data-wave` element exists in the kind's track**; `blockedNote` has no caller; the plan heading no longer summarises wave states; a branch's wave is still discoverable — through the wave row that holds it.

### What a container states, its children do not repeat

Settled over four operator corrections during implementation, and they turned out
to be one rule rather than four.

A row inside a wave's fold showed `open`, an age, a plan link, and
`blocked by Relocated — 1 outstanding` — **four facts its container already
states**, on the two children of `Moved`. Each was suppressed for the same
reason, so the rule is stated once:

| the child showed | why it goes |
|---|---|
| `open` | the wave's verdict is `blocked`, one line up — and `open` reads as *available*, which `plot-dispatch.sh` would refuse |
| its own age | the wave's clock is the freshest of its branches, so per-branch ages are four measurements of one thing |
| `plan fleet-scan-asks-the-host` | the plan is **two** rows up, heading the group |
| `blocked by Relocated — 1 outstanding` | the wave row now states all three of those facts structurally |

**The status measurement is the one worth keeping.** A first attempt suppressed
only `state === 'open'`, reasoning that `wip` and `deferred` are events on the
branch that no verdict states. Counted over `last-pulse.json`, that guard
**never fires**: a child row renders only inside a multi-branch unfinished wave,
the estate holds exactly **one** of those, and all five of its branches are
`wip`. The condition covered a case that does not occur and left the case that
does printing a status its wave owns. A rule beat the exception list.

And the branch's state says nothing about startability in any case — inside
`blocked` waves the branches are `open` × 9 and `wip` × 5; inside `eligible`
waves, `open` × 8 and `wip` × 3. Near-identical proportions.

### Where the blocker reference goes — three placements, two measured failures

The reference is a **sentence**, and this row has no unbounded slot spare. Each
placement was rendered before the next was tried:

**1. Slot 4, as a link.** On the argument that *why can I not start this*
outranks *what is in it*. Rendered, that put a reference pointing **up** among
links pointing **down** — `wave Relocated` ahead of two branch links, in a column
headed `Related` whose every other kind reads one direction. Slot 4 holds what
the wave *contains*.

**2. Beside the name in slot 3**, as *Moved — blocked by Relocated*. The
positional rule the wave badge followed beside a branch, and it looked right in
prose. Measured on the mock it was worse than crowding: **`Relocated` rendered as
`R…` and `Moved` as `M`.** The blocker text won the width fight against the name,
so the row lost the one thing it exists to say.

**3. An info mark in slot 5**, beside the status it explains, with the wave named
in `title` and in `aria-label`. This is right structurally and not merely
smaller: **`blocked` is the fact a reader scans down the column; *which wave* is
a follow-up about one row**, and a follow-up belongs behind a disclosure — the
same reason `ApproveButton`'s armed label lives in a popup rather than in a cell.

Not a link, because a wave has no page of its own. The name is in the accessible
label as well as the tooltip, so it is not hover-only for a reader who cannot
hover. Slot 5 keeps `blocked · 2 left` beside it, and the wave names render in
full — measured, `truncated: false` on all three.

### A deferred branch is not a wave's work

`isUnbegun` already drew this line and `waveSummaryFor` already refused to count
a deferred branch as a wave — *"not a wave nobody reached, a branch somebody set
down"*. The wave grouping has to honour it, because a wave row shows the **wave's**
verdict and clock, and a deferred branch carries a PR and an age of its own that
appear nowhere else. Folded into a single-branch wave they would be unreachable,
which is exactly the loss `fleet.ts` warns of: *"a branch started and then
shelved read as never begun, with its age and its PR erased."*

So a deferred branch keeps its own row beside the waves, as a `Branch`.

### Two fixture defects the wave row exposed

**The mock carried four `kind: 'plan'` rows.** `rowKind` returns only `release`,
`branch` or `pr` — no pulse has ever emitted a `plan` row, because a plan row is
assembled by the client from the branches under it. It read correctly for as long
as a not-started row *stood for* its plan; the moment the wave row took that job,
those rows became the branches inside a fold and rendered `Kind: Plan` two levels
deep. A mock is worth only the fidelity it is checked for, so a test now checks it.

**Six of the 71 waves have no name** — see the naming note above. And the test
demanding a row for every kind had to learn that **three** kinds are
client-assembled (`plan`, `wave`, `ticket`), not one.

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

## Superseded

Absorbed 2026-08-23 by `the-wave-is-a-thing-the-board-can-hold`, which was
written without finding this plan first — a duplicate the estate produced because
it builds faster than it re-reads itself.

**This plan was right, and earlier.** Its summary states the defect exactly: *the
scan already reports a wave as an object with its own verdict, and the board
flattens it.* Everything the newer plan measured is downstream of that sentence.

The newer plan survives for three reasons, none of them about being better
written:

- it carries the **measurements** — 82 waves, 14 rendering as several rows, one
  in two sections
- it carries the **domain model** those measurements produced
  (`docs/board-domain-model.md`), which is the release's specification
- its **waves encode a dependency Plot enforces**, and three branches from two
  other plans have already moved into them. Merging backwards would strand those.

Nothing in this plan is lost: its claim is the newer plan's thesis, and this
record is here so the duplication is visible rather than tidied away.
