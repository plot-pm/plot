# The agent rows line up, and the PR column says what it means

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, jwloka, plan-PR #162 merged (one interrogation round)
- **Started:** 2026-08-17, Jan Wloka, `feature/pr-state-travels-as-a-field`
- **Delivered:**

## Problem

Asked on 2026-08-17 from a screenshot of WAITING ON YOU: *something about the
presentation of Phase / Branch / PR / Age is wrong.* Four rows, and no two of
them agree on where anything sits:

| Phase | Branch | PR | Age |
|---|---|---|---|
| *(none)* | `feature/opus5-longhorizon-hardening` | `PR #57 green` | `22d` |
| *(none)* | `changeset-release/main` | `PR #116, no checks` | `15m` |
| `Discovery` | `idea/board-survives-its-agents` | `PR #157, draft` | `13m` |
| `Development` | `feature/dispatch-writes-brief` | `PR #158 green` | `8m` |

Three separate defects are visible in that table, and they have one root.

### The row is a table that was never built as one

Measured — `AgentList.tsx:586` is a flex row, and the code says so itself:
*"a visual table with no table semantics"*. Only three cells have a width:

| Cell | Width | Behaviour |
|---|---|---|
| Phase | `w-24` | fixed |
| Plan | — | **content-sized** |
| Branch | — | **content-sized** |
| PR / note | `ml-auto` | **pushed right** |
| Age | `w-10` | fixed |
| Menu | `w-5` | fixed |

`ml-auto` on the note is what produces the look: everything from there is shoved
to the right edge, so the branch ends where its text ends and the slack collects
*between* branch and PR. The branch names are not centred — they simply start at
different offsets, because the plan cell before them is sometimes present and
sometimes not.

**And `agent-rows-line-up`'s sibling change makes it worse before it makes it
better.** The heading fix landing in #160 means a group with one row prints its
plan name *in the row*, while a group with several prints it in the heading — so
two rows in the same section now differ by a whole cell.

### `no checks` still means two opposite things

Recorded in the story as an open finding and hit twice more while writing this
plan: PR #149 read `no checks` when GitHub was saying *"This branch has
conflicts that must be resolved"*, and PR #160 did the same thing an hour ago.

Measured both times: `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`, and
`statusCheckRollup` genuinely **empty** — GitHub does not start CI for a
conflicting PR. So the board reports the symptom and withholds the cause, and
the same three words also mean *a workflow is waiting for a human to approve
it*. One wants a rebase; the other wants a click.

The data is not fetched: `plot-host.sh pr-list --rich` selects
`number,title,state,head,draft,checks,review,url`. No mergeability field.

### The state is prose, so the row cannot format it

This is the part that makes the first two defects one problem.

`Note` (`AgentList.tsx:766`) receives a **finished sentence** from the server —
`row.note` is `"PR #116, no checks"` — and finds the PR link by string search:

```ts
const marker = row.pr ? `PR #${row.pr.number}` : '';
const at = marker && row.pr?.url ? row.note.indexOf(marker) : -1;
```

The contract carries `pr: { number, url }` and nothing else; `green`, `draft`,
`no checks` exist only inside that sentence, assembled by different branches of
`classify()` in `fleet.ts` — which is why one row says `PR #57 green` and the
next `PR #116, no checks`. **The frontend cannot make those consistent**, and it
cannot render a badge or an icon from a sentence without parsing it back apart.

## Design

### The row becomes a grid, and the columns become real

A CSS grid with named tracks, so every cell holds its position regardless of the
text inside it:

```
grid-cols-[6rem_10rem_1fr_9rem_2.5rem_1.25rem]
           phase plan  branch pr  age  menu
```

**The branch takes `1fr`** because it is the longest and most variable value,
and the one worth reading in full; the others are bounded by their content
(`Development` is the longest phase, `#1234 conflicts` the longest PR cell).

**Overflow elides the MIDDLE, keeping both ends.** Branch names here share long
prefixes and differ at the tail — `feature/opus5-hardening-…` covers six
branches, and end-truncation would render all six identically, which is worse
than no truncation because the row then looks duplicated. Measured on the
screenshot that produced this plan: `feature/opus5-longhorizon-hardening` is 35
characters against `changeset-release/main`'s 22, so at any fixed width
something gives. Middle-elision keeps the prefix that says *what kind of work*
and the suffix that says *which one*; the full value stays in `title`.

**An empty cell now leaves a gap rather than shifting its neighbours** — which
is the whole point. A row with no phase and a row with one align on branch;
so do a row whose plan name sits in the group heading and one whose does not.

**It gains table semantics.** The `sr-only` labels exist, as the code says,
because *"column position conveys nothing and each row is heard as a run of
words"*. With `role="row"` / `role="gridcell"` and a header row carrying
`role="columnheader"`, position conveys something again, and a screen reader
announces the column name instead of the row's spans running together. The
`sr-only` prefix on the phase can then go — it was compensating for the missing
structure.

**Not a `<table>` element.** The rows already carry interactive controls, a
collapsible group structure and per-group sub-headings; wrapping that in real
table markup would fight the grouping rather than serve it. `role="grid"` on a
`<ul>` keeps the DOM and gains the semantics.

**All six waiting-groups inherit it, and that is structural rather than
generous.** Measured: `AgentList.tsx:945` maps `GROUPS` and `:1043` renders one
`<Row>` inside it — a single row implementation, so WAITING ON YOU, WORKING,
WAITING ON A MACHINE, NOT STARTED, QUIET and DONE cannot diverge. The
`Done when` list pins that, because the cheap way to fix one group's alignment
is a special case, and a special case is how six sections stop agreeing.

### Below 640px the row becomes a card

**This is what the grid takes away, so it has to give it back.** Measured: the
agents tab has **zero** responsive breakpoints and the whole app has two. Its
only concession to a narrow window is `flex-wrap`, and the code says why that
works — *"the rows are flex-wrapped, so nothing depends on the position"*.
Position meaning nothing is exactly what lets a row wrap without losing
anything. A grid inverts that: tracks line up, and tracks cannot wrap.

The arithmetic decides it. Fixed tracks total 460 px; gaps and padding add
84 px. **The grid needs 544 px before the branch column gets a single pixel:**

| Viewport | Branch column |
|---|---|
| 375 px (phone) | **−169 px** |
| 414 px (phone) | **−130 px** |
| 768 px (tablet) | 224 px |
| 1024 px | 480 px |

So below `sm` the row stops being a row. Each becomes a small block: the branch
on its own line — it is the row's primary key and the thing worth reading in
full — with plan, phase, PR and age beneath it as one wrapped line. Nothing is
dropped and nothing is elided; the same facts stack instead of ranging.

**Dropping columns instead was the cheaper answer and is wrong.** Phase and plan
are the two candidates, and the plan name is precisely what `showPlanHeading`
just finished making sure a row carries when its group has no heading. Removing
it on a phone would re-open, at one width, the defect closed at every width an
hour earlier.

**A phone is a real reader, not a hypothetical.** The server already detects a
Tailscale address, so the board is meant to be reachable over a private network,
and *what are my agents doing* is exactly the question asked away from the desk.
It is a **reading** surface there: `/api/dispatch` is gated to localhost, so the
row action menu is unavailable on a phone by construction rather than by layout
— which is also why losing its column below `sm` costs nothing.

### A Draft card says how many rounds it has survived

A different question on a different surface, folded in because it is the same
defect: **information that exists, is decisive, and reaches no screen.**

Measured: **14 plans carry a `"round"` in their `CHALLENGE-THE-PLAN-METADATA`
block**, ranging from 1 to 4 — and `plot-plan-meta.sh` contains zero references
to it. A plan interrogated four times (`fleet-sees-merged-branches`) and one
written twenty minutes ago render identically in Discovery.

That is precisely the question a Draft card leaves open. Every other badge says
what a plan *is*; none says how hard it has been looked at. A reader deciding
*approve, or one more round?* has to open the file to find out.

**The badge suppresses itself when there is nothing to say.** A plan with no
metadata block shows no badge — not `0 rounds`, which would read as *interrogated
and found empty* rather than *never interrogated*. `waveBadgeText()` already
establishes that pattern on this card, returning `""` where the fact would not
earn its place; this follows it rather than inventing a second convention.

**Draft cards only.** Once a plan is approved the count is history: it says
something about how the decision was reached, not about what to do next, and
Discovery is the only column where *approve or interrogate again* is a live
question. Everywhere else it would be a number nobody acts on.

**The card, not the agent row.** Measured on the live pulse: 3 rows carry an
idea-branch, and **34 implementation rows also carry a plan name**. A round
count on every row bearing a plan would attach to 34 branches whose plan was
settled long ago — noise of exactly the kind the per-group heading fix has just
finished removing from that tab. The question belongs where the plan is the
subject, and that is the card.

The parser gains one field. `plot-plan-meta.sh` reads the metadata block it
already skips over, and reports `rounds` — absent where the block is, which the
contract carries as `null` rather than `0`.

### The PR cell gets fields instead of a sentence

`AgentPr` grows from `{ number, url }` to carry its own state:

```ts
pr: { number, url, draft: boolean,
      state: 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' }
```

**`draft` stays a separate field and is deliberately not one of the states.** It
answers a different question — *is this offered for review* — and the two are
independent: a draft has CI like anything else. `draftNote()` already reads
`pr.checks` and writes *"draft, CI running"*, so folding draft into the enum
would destroy an answer the code already produces.

It would also rebuild a known defect. The story's WAITING ON A MACHINE finding
named three causes for that group never being populated, and the first was that
**a draft PR could not reach it** — the classifier short-circuited every draft
before the checks were consulted. A single-value state would move that
short-circuit from the classifier into the contract, where it is harder to see
and shared by every consumer.

Two fields, two badges: `⑂158 [draft] [CI running]`.

`classify()` keeps deciding the group and the note; what changes is that it also
**states the PR's condition as a value** rather than only spelling it into
prose. The note stays — it carries everything a PR state cannot say (*uncommitted
work*, *blocked by an earlier wave*, *claimed elsewhere*) — but it stops being
the only place the PR's condition exists.

`Note`'s `indexOf` search goes with it. A string search for a marker the server
happened to write is a parser for a format nobody declared, and it silently
renders an unlinked note whenever the wording drifts.

**`conflicts` needs one field from the host.** `pr-list --rich` gains
`mergeable` from `gh`'s `mergeable,mergeStateStatus`. Bitbucket has no
equivalent, and that is already handled by precedent: it sets `checks:"unknown"`
today, and unknown mergeability means the cell falls back to what it can say
rather than guessing. **Absent is not false** — the same rule the local signals
obey.

**`conflicts` outranks `no checks` when both are true**, because it is the cause
and the other is its consequence. A row that says `no checks` on a conflicting
PR is telling the truth about the symptom and hiding the reason, which is the
defect being fixed.

### The `PR` label becomes the git-host's own icon

`PR #157, draft` is fifteen characters in a cell that must hold a fixed width.
`⑂157 [draft]` is roughly nine, and the difference decides whether the cell
truncates.

**The icon replaces the word `PR`, never the state.** The repo's rule is *symbol
AND word* — colour or shape must never be the sole carrier — and the phase cell
is spelled out for exactly that reason. This does not breach it: the number
stays, the state stays as a word, and only the label `PR` becomes a glyph that
means *pull request* in every git host's own UI. An `aria-label` carries it for
readers who hear rather than see, since a bare `157` announces nothing.

**Rendered inline, not as an image.** No external asset, no icon font — a small
inline SVG or the existing text glyph, so the artifact stays self-contained the
way the rest of the board is.

## Branches

### Data

- `feature/pr-state-travels-as-a-field` — `AgentPr` carries the PR's condition
  as a value; `pr-list --rich` fetches `mergeable`; `classify()` sets it, and
  `conflicts` becomes distinguishable from `no checks` → #165

### Presentation

- `feature/agent-rows-line-up` — the row becomes a grid with fixed tracks and
  gains `role="grid"` semantics; the PR cell renders number, icon and state
  badge from the fields rather than searching a sentence
### Rounds

- `feature/card-shows-interrogation-rounds` — `plot-plan-meta.sh` reports the
  interrogation round; a Draft card wears it as a badge, and wears nothing where
  no interrogation has happened

**The rounds badge is its own wave rather than sharing Presentation**, and the
reason is the same one that keeps the first two apart: it adds a field to
`schema.ts`, which the grid branch is also editing. Two branches adding
neighbouring fields to one object is exactly what produced four manual conflict
resolutions in a single hour on 2026-08-17 — every one of them a union with no
genuine disagreement, and every one still a rebase and a rebuild.

It is last rather than first because it is the smallest and the least urgent:
the grid answers a defect visible in every row, the badge answers a question a
reader can still resolve by opening a file.

Two waves, and the order is a real dependency rather than a preference: the
badge cannot be rendered from a sentence, so the field has to exist before the
cell can use it.

The second reason was measured rather than assumed. Both waves touch `fleet.ts`
and `schema.ts`, and this session watched #160 and #161 collide in **four**
files — `board.ts`, `index.ts`, `plot-config.sh` and the artifact — because two
branches added neighbouring fields to the same objects. Every conflict resolved
to a union: not one genuine contradiction, and still four manual resolutions and
two rebuilds. One branch in flight over these files is worth a round of waiting.

## Done when

- **Every row's branch cell starts at the same x**, whether or not the row has a
  phase and whether or not its plan name sits in the group heading. Assert
  against a mixed section — the case #160 introduced.
- **An empty cell leaves a gap, not a shift.** Assert a row with no phase aligns
  with one that has a phase: the flex version has no way to express this, so a
  test that only checks "the phase is absent" passes today.
- **A long branch name elides rather than pushing the PR cell.** Assert the PR
  and age cells sit at the same x for a short and a very long branch.
- **The elision is in the MIDDLE.** Assert two branches sharing a long prefix
  stay distinguishable: end-truncation renders `feature/opus5-hardening-*` as
  six identical rows, which reads as duplicates rather than as truncation.
- **All six waiting-groups get the same row.** Assert the grid in a group other
  than WAITING ON YOU — one row implementation is the reason they cannot
  diverge, and a special case for one group is how that stops being true.
- **Below 640px the row is a card, and nothing is dropped.** Assert branch,
  plan, phase, PR and age are all still present at 375px — the plan name in
  particular, which `showPlanHeading` just made a row's own responsibility.
- **Above the threshold the card does not appear.** The pairing: a fix that
  renders cards everywhere passes every mobile assertion above.
- **`draft` and the PR state are separate.** Assert a draft PR with CI running
  shows BOTH — folding draft into the state enum silently rebuilds the
  short-circuit that kept WAITING ON A MACHINE empty.
- **A Draft card shows its interrogation round.** Assert against a real plan
  file carrying `"round": 2` — the parser skips that block today, so a test
  built on a hand-made fixture would pass while the real format failed.
- **A plan with NO metadata block shows no badge at all.** Assert the absence,
  not a zero: `0 rounds` reads as *interrogated and found empty* rather than
  *never interrogated*, and absent is not zero is the rule this repo applies
  everywhere else.
- **The badge appears only on Draft cards.** Assert an Approved card does not
  carry it: past Discovery the count is history, and a number nobody acts on is
  the crowding this board keeps removing.
- **The agent row does NOT gain it.** The pairing that matters: 34 of the
  pulse's rows carry a plan name whose plan is long settled, and putting the
  count there would attach it to every one of them.
- **The row is announced by column, not as a run of words.** Assert the
  accessible name of a cell includes its column, and that the phase's `sr-only`
  prefix is gone rather than duplicated by the header.
- **A conflicting PR says `conflicts`, not `no checks`.** Assert against the
  live shape from PR #149 and PR #160: `mergeable=CONFLICTING`,
  `statusCheckRollup` empty.
- **A workflow awaiting human approval still says `no checks`.** The pairing
  that matters: one label for both is the defect, and a fix that renames all of
  them to `conflicts` is the same defect mirrored.
- **Unknown mergeability is not reported as clean.** Assert Bitbucket's path —
  no mergeability field — falls back rather than claiming a state.
- **The PR cell renders from fields, not from `row.note`.** Assert a note whose
  wording does not contain `PR #<n>` still produces a linked PR cell: the
  `indexOf` version silently drops the link.
- **The note still carries what a PR state cannot say.** Assert
  *uncommitted work*, *blocked by an earlier wave* and *claimed elsewhere*
  survive — the note is not being replaced, only relieved of one duty.
- **The icon is not the sole carrier.** Assert the number and the state word are
  both present, and that the icon has an accessible label — a bare `157`
  announces nothing.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.

## Notes

The `no checks` ambiguity was recorded in the plot-board story on 2026-08-16 and
has been hit three times since, most recently on this session's own PR #160 —
which is what moved it from a note to a plan.

Deliberately out of scope: the two-clock effect where a freshly opened PR is
invisible for up to two minutes because PR data refreshes at 60–120 s against
the git pulse's 4 s. Measured while writing this plan (`prAgeSeconds: 34` against
`ageSeconds: 1`), it is correct behaviour with a visible countdown already in
the footer, and #123's backoff is why the interval is what it is.

Also out of scope: the board tab's cards. This is the agents tab's row, and the
two surfaces answer different questions.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "You asked for the grid 'in the other sections too'. Measured: AgentList.tsx:945 maps GROUPS and :1043 renders ONE <Row> inside it — all six waiting-groups share a single implementation.", "a": "The six waiting-groups, and it comes free. Pinned in Done when anyway, because the cheap way to fix one group's alignment is a special case, and a special case is how six sections stop agreeing. PlanCard is a different surface — cards in kanban columns, not rows — and out of scope", "category": "technical-architecture"},
    {"q": "The plan gave pr.state seven values including 'draft'. But draft is its own field today, and classify() handles drafts before anything else.", "a": "draft stays separate. A draft has CI like anything else — draftNote() already writes 'draft, CI running' — and folding it into the enum would move the short-circuit that kept WAITING ON A MACHINE empty from the classifier into the contract, where it is harder to see", "category": "domain-data"},
    {"q": "The branch gets 1fr and truncates. Measured: feature/opus5-longhorizon-hardening is 35 chars against changeset-release/main's 22.", "a": "Elide the MIDDLE, keep both ends. Branch names here share long prefixes and differ at the tail — feature/opus5-hardening-* covers six branches, and end-truncation renders all six identically, which reads as duplicate rows rather than as truncation", "category": "ux-happyPath"},
    {"q": "Both waves touch fleet.ts and schema.ts, and #160/#161 just collided in four files for exactly that reason.", "a": "Sequential as planned. The badge cannot be rendered from a sentence, so the field must exist first — a real dependency. And every one of those four conflicts resolved to a union with no genuine contradiction, yet still cost four manual resolutions and two rebuilds", "category": "tradeOffs"},
    {"q": "What would the mobile view look like with very little space? Cards?", "a": "Cards below 640px. Measured: the tab has ZERO breakpoints, its only concession is flex-wrap, and the code says why that works — 'nothing depends on the position'. A grid inverts that. Fixed tracks need 544px before the branch gets one pixel; a 375px phone is 169px short. Dropping columns instead would re-open the plan-name defect closed an hour earlier", "category": "ux-edgeCases"},
    {"q": "Is the board used on a phone at all? /api/dispatch is localhost-gated.", "a": "Yes, for reading. The server already detects a Tailscale address, so it is meant to be reachable over a private network, and 'what are my agents doing' is the question asked away from the desk. Acting stays impossible there by construction — which is why losing the action column below sm costs nothing", "category": "domain-workflows"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": {"rules": false, "workflows": true, "data": true},
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": true},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
