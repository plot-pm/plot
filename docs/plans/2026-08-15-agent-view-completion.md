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
- `plot-host.sh` gains a richer PR listing (check status, review decision) so
  the board can tell "waiting on a person" from "waiting on a machine" without
  talking to the host itself.
- The board shows the four workflow phases rather than four plan states:
  Discovery · Design · Development · Endgame · Released, colour-coded by who
  leads. `Approved` splits into *Ready* and *In progress* as its own column
  boundary rather than a badge, and Endgame cards count the release checklist.
- Stories become swimlanes: one row per story, plans in the column their phase
  puts them in, with a `(no story)` row for plans created directly.

Board impact: **yes, throughout.** No plan-format change — `plot-plan-meta.sh`
already emits `started_raw` and `story`, verified — but two contracts move.
`plot-host.sh` gains a listing mode (a helper-script change, which the DoD
counts as board-relevant), and `BOARD_PHASES` changes shape, breaking four
readers inside this repo: the client, two test files, and the dev-server
middleware. All four are updated in the branch that changes it.

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

**The adapter needs widening first.** `plot-host.sh pr-list` returns only
`number`, `head`, `state`, `title` — enough to know a PR exists, not enough to
know whether it is waiting on a person or a machine. Meanwhile a single
`gh pr list --json number,headRefName,statusCheckRollup,reviewDecision` returns
all of it in **0.58 s**, faster than the narrower call through the adapter.

So the branch starts in `plot-host.sh`: a richer listing mode that carries check
status and review decision. The board must not call `gh` directly — Principle 3
puts host knowledge in exactly one place, and a board that shells out to `gh`
would silently become GitHub-only, leaving Bitbucket users with two permanently
empty groups and no explanation.

The Bitbucket path degrades explicitly rather than pretending: where the backend
cannot supply check or review state, the adapter says so and the two groups
report *unavailable* rather than *empty*.

Two groups fill:

| Group | Rule |
|---|---|
| ⚠ waiting on you | PR open, not draft, checks green, review not yet approving |
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
| Endgame | Delivered, release checklist open (`15/27`) | 👤 human-led |
| Released | Released | — |

`Approved` spans a phase boundary, which is the substantive change: a plan
without `Started:` sits at the end of Design; one with it is in Development. The
board already draws that split as a *Ready*/*In progress* badge, so the data is
there (`started_raw`, verified present) — it simply is not read as a phase
change.

**The Endgame card counts the release checklist** (`15/27`), parsed from
`docs/releases/v<version>-checklist.md` — `- [x]` over `- [ ]`. "Delivered" does
not answer the question the column asks, which is *what is left before signoff*.

This is a second contract surface: a markdown format no other script reads, and
the class of dependency that let `plot-update-board.sh` sit broken for five
months. It is accepted here on one condition — **a test pins the parse**, over a
fixture carrying checked, unchecked, nested and malformed items. A count nobody
verifies is worse than no count, because a wrong `15/27` looks exactly as
authoritative as a right one. Missing or unparseable file → no badge, never a
guessed number.

`BOARD_PHASES` changes shape, which breaks **four** readers, all inside this
repo: the client (`App.tsx`), the artifact test helper (`test/helpers.mjs`), the
board test (`test/board.test.mjs`), and the dev-server middleware
(`vite.config.ts`) that mirrors the production route. All four change in the
same branch — the tests would otherwise fail on precisely the change they exist
to guard, and a split would leave the dev server disagreeing with production.

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

- [ ] Should Discovery show anything in a repo with no stories at all? Verified:
      `/api/board` already returns a `stories` array, so the data exists — but
      an empty first column on every adopter repo that never adopted stories
      would be a permanent blank. Possibly the column appears only when at least
      one story does.
- [ ] Which checklist does an Endgame card read when several releases are open?
      `docs/releases/` holds one file per version; a plan delivered but not
      released could plausibly belong to more than one.
- [ ] Does the Bitbucket path have any check-status equivalent, or does `bb`
      simply not carry it? Decides whether *unavailable* is a permanent state
      there or a gap to close later.

## Branches

### PR data

- `feature/fleet-pr-data` — widen `plot-host.sh` (checks + review), fetch it in the refresh cycle, fill the two groups, `prSource` honesty

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

Interrogated with `/challenge-the-plan` before approval. Three findings, two of
which corrected the plan rather than filling a gap:

- **An open question dissolved rather than being answered.** It asked whether
  *waiting on you* could skip the review query, assuming a second per-PR call.
  Measured: one `gh pr list --json …statusCheckRollup,reviewDecision` returns
  everything in **0.58 s** — faster than the narrower call through the adapter.
  The real finding sits behind it: `plot-host.sh pr-list` emits only four
  fields, so the adapter must widen first. The board calling `gh` itself would
  break Principle 3 and silently become GitHub-only.
- **"Only this repo's client reads `/api/board`" was wrong.** Three more readers
  exist — `test/helpers.mjs`, `test/board.test.mjs`, and `vite.config.ts`, whose
  dev-server middleware mirrors the production route. A `BOARD_PHASES` change
  breaks all four, so all four move together.
- **Checklist parsing was accepted over the plan's own recommendation.** The
  draft leaned toward "Delivered, not Released" to keep the board free of a
  second document format. Overruled deliberately: `15/27` answers what the
  column asks and "Delivered" does not. The condition attached is a test over a
  fixture, because a count nobody verifies looks exactly as authoritative when
  wrong as when right.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "How should the board get rich PR data, given pr-list returns only 4 fields?", "a": "Widen plot-host.sh — the adapter stays the one place that talks to the host", "category": "technical"},
    {"q": "BOARD_PHASES breaks four readers, not one — how to handle?", "a": "Update all four in the same branch", "category": "technical"},
    {"q": "Should Endgame parse the release checklist or just say Delivered?", "a": "Parse it (15/27) — overrides the plan's recommendation; test pins the parse", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
