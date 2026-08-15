# Agent view: the three steps after the first

> PR data, five phase columns, and story swimlanes — the rest of the
> visualisation, reshaped by what step 1 actually taught.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- The Agents tab fills its two empty groups: **waiting on you** (a PR that is
  green and unreviewed, or one whose branch conflicts) and **waiting on a
  machine** (CI still running).
- The board shows the four workflow phases rather than four plan states:
  Discovery · Design · Development · Endgame · Released, colour-coded by who
  leads. `Approved` splits into *Ready* and *In progress* as its own column
  boundary rather than a badge.
- Stories become swimlanes: one row per story, plans in the column their phase
  puts them in, with a `(no story)` row for plans created directly.

Board impact: **yes, throughout.** No plan-format change — `plot-plan-meta.sh`
already emits `started_raw` and `story`, verified — but the board's column
contract (`BOARD_PHASES`) changes, which is a breaking change for anything
reading `/api/board`. Nothing outside this repo does today.

## Motivation

Step 1 delivered the Agents tab and, as intended, taught things the design draft
could not know. Three of them reshape what remains.

**The board reads no PR state at all.** The draft described step 2 as adding "a
host cache", implying something to extend. There is nothing: `board.ts` never
calls `plot-host.sh`. Step 2 is therefore a new capability rather than a
completion, and its cost lands where the fleet cache already is.

**A bundled PR query costs 0.80 s** — the same order as the scan itself (0.5–1.05 s).
The draft proposed two poll rates for two data sources: 4 s for git, 30 s for the
host. That distinction dissolves once both live behind the same
server-refreshed cache, which is where step 1 put the scan. One refresh cycle,
two sources, one age on screen.

**Rendering something is how you learn whether it answers the question.** Step 1
shipped with merged branches classified as *quiet* and an age reading
`no commit for 30300 min`; both were obvious on screen and invisible to fourteen
passing unit tests. Steps 3 and 4 change what the board *shows* rather than what
it computes, so they need the same treatment: build, look, fix what reads wrong.

**The repo now has exactly one story**, written yesterday. Step 4 was untestable
before that — swimlanes with nothing to lane. It is still thin evidence: one
story proves the row renders, not that the layout survives several.

## Design

### Approach

Three branches in three waves, ordered by what each one unblocks.

**Step 2 — PR data in the existing cache.**

`plot-host.sh pr-list` returns `number`, `head`, `state`, `draft` for every open
PR in one call (measured: 0.80 s). The fleet refresh cycle gains a second
`execFile` beside the scan, and the resulting map is keyed by branch.

Two groups fill:

| Group | Rule |
|---|---|
| ⚠ waiting on you | PR open, not draft, checks green, no approving review |
| ⏳ waiting on a machine | PR open with checks pending |

The classifier stays a pure function — it takes the PR record as another
argument, which keeps the 14 existing tests meaningful and makes the new rules
testable the same way.

**Degradation is not an afterthought here.** `plot-host.sh` may be absent,
unauthenticated, or offline. The cache already carries `error` and `ageSeconds`;
PR data gets its own `prSource` field with the same honesty: when it is
unavailable, the two groups stay empty **and say why** rather than looking
settled. An empty *waiting on you* that means "no host CLI" must not read as
"nothing needs your review".

**Step 3 — phase columns.**

The board shows plan states (`Draft`/`Approved`/`Delivered`/`Released`). The
workflow has four phases that differ by **who leads**: Discovery, Design,
Development, Endgame — three human-led, exactly one agent-led.

| Column | Contains | Leadership |
|---|---|---|
| Discovery | stories with no plans yet | 👤 human-led |
| Design | Draft plans, and Approved without a `Started:` record | 👤 human-led |
| Development | Approved *with* a `Started:` record, plus Delivered-not-Released | 🤖 agent-led |
| Endgame | Delivered, release checklist open | 👤 human-led |
| Released | Released | — |

`Approved` spans a phase boundary, which is the substantive change: a plan
without `Started:` sits at the end of Design; one with it is in Development. The
board already draws that split as a *Ready*/*In progress* badge, so the data is
there (`started_raw`, verified present) — it simply is not read as a phase
change.

`BOARD_PHASES` changes shape, which breaks `/api/board` consumers. Only this
repo's own client reads it today, so the migration is internal — but it is a
contract change and gets called out rather than slipped in.

**Step 4 — story swimlanes.**

Stories become rows; the Discovery column doubles as the row header. A story
with no plans is a row with no cards, which reads correctly as "still in
discovery". Plans created directly land in a `(no story)` row.

This is the largest rebuild and the least certain, because the repo has **one**
story. One story proves a row renders; it does not prove the layout survives
five. The branch therefore ships behind nothing — it is simply last, and if it
reads badly with one story it can wait for a second.

**Manifesto check.** Principle 1: PR state is fetched, not stored — the cache is
derived and disposable. Principle 3: the host adapter collects, the board
interprets. Principle 5: no plot-specific names; phases come from the workflow
model, not from this repo. Principle 12: each step ends by looking at the
rendered result, because step 1 proved that is where display defects live.

### Open Questions

- [ ] Does "checks green, no approving review" need the review query at all?
      `gh pr list` does not return review state; a second call per PR would
      reintroduce the per-item cost that step 1 removed. Possibly *waiting on
      you* means only "green and open" at this step.
- [ ] Should Discovery show stories from `docs/stories/` when the repo has no
      story directory configured? An empty first column on every adopter repo
      would be worse than no column.
- [ ] Does the Endgame column need release-checklist parsing (`15/27`), or is
      "Delivered, not Released" enough? The draft left this open and step 1 did
      not touch it.

## Branches

### PR data

- `feature/fleet-pr-data` — bundled PR fetch in the refresh cycle, two groups filled, `prSource` honesty

### Columns

- `feature/board-phase-columns` — five columns, leadership colour, Approved split on `started_raw`

### Swimlanes

- `feature/board-swimlanes` — stories as rows, Discovery as row header, `(no story)` row

<!-- Three waves, one branch each. All three rebuild the checked-in board
     bundle, so none may run concurrently — the same collision that shaped
     the fleet-agent-view plan, and the reason its waves were split. -->

All three touch `packages/board` and therefore rebuild
`skills/plot/scripts/board/board-server.mjs` — a checked-in 690 KB artifact with
no merge driver. They are serialised for that reason alone, not because of a
logical dependency. Step 3 does not need step 2's data, and step 4 needs
neither.

## Notes

Follows `fleet-agent-view` (delivered 2026-08-15, #102–#104), which built step 1
of the design draft `docs/research/2026-08-15-agent-visualisation.md`. This plan
is steps 2–4, deliberately left unplanned until step 1 had run.

The known limit recorded there still stands and is **not** addressed here:
the view is git-only, so unpushed local work is invisible. PR data does not
change that — an agent that has neither pushed nor opened a PR remains
`not started`.

Definition of Done: `docs/definition-of-done.md`.
