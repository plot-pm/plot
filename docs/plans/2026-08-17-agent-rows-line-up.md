# The agent rows line up, and the PR column says what it means

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
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
Overflow truncates with the full value in `title`, which is what the phase cell
already does.

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

### The PR cell gets fields instead of a sentence

`AgentPr` grows from `{ number, url }` to carry its own state:

```ts
pr: { number, url, state: 'green' | 'pending' | 'failing' | 'none'
                        | 'conflicts' | 'draft' | 'unknown' }
```

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
  `conflicts` becomes distinguishable from `no checks`

### Presentation

- `feature/agent-rows-line-up` — the row becomes a grid with fixed tracks and
  gains `role="grid"` semantics; the PR cell renders number, icon and state
  badge from the fields rather than searching a sentence

Two waves, and the order is a real dependency rather than a preference: the
badge cannot be rendered from a sentence, so the field has to exist before the
cell can use it. Both touch `fleet.ts` and `schema.ts`, which is the second
reason not to run them together.

## Done when

- **Every row's branch cell starts at the same x**, whether or not the row has a
  phase and whether or not its plan name sits in the group heading. Assert
  against a mixed section — the case #160 introduced.
- **An empty cell leaves a gap, not a shift.** Assert a row with no phase aligns
  with one that has a phase: the flex version has no way to express this, so a
  test that only checks "the phase is absent" passes today.
- **A long branch name truncates rather than pushing the PR cell.** Assert the
  PR and age cells sit at the same x for a short and a very long branch.
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
