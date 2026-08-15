# Agent view: the three steps after the first

> PR data, five phase columns, and story swimlanes — the rest of the
> visualisation, reshaped by what step 1 actually taught.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-15, jwloka, plan-PR #105 merged
- **Started:** 2026-08-15, jwloka, `feature/fleet-pr-data`

## Approval

- **Assignee:** jwloka

## Changelog

- The Agents tab fills its two empty groups: **waiting on you** (a PR that is
  open, not draft, and either green or carrying no checks at all — ready, and
  nobody has merged it) and **waiting on a machine** (CI genuinely running).
- `plot-host.sh` gains a richer PR listing (check status, review decision) so
  the board can tell "waiting on a person" from "waiting on a machine" without
  talking to the host itself. Review state is shown as a note and never gates:
  approved is approved, with or without a review.
- The board shows the four workflow phases rather than four plan states:
  Discovery · Design · Development · Endgame · Released, colour-coded by who
  leads. `Approved` splits into *Ready* and *In progress* as its own column
  boundary rather than a badge, and Endgame cards count the release checklist.
- Stories become swimlanes: one row per story, plans in the column their phase
  puts them in, with a `(no story)` row for plans created directly. Leadership
  reads from a symbol and a word, with colour only reinforcing it.

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
server-refreshed cache, which is where step 1 put the scan — one refresh cycle
rather than two poll rates. The two sources still cache separately, because they
fail separately; what they share is the cycle, not a single age.

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
know whether it is waiting on a person or a machine. A single
`gh pr list --json number,headRefName,statusCheckRollup,reviewDecision` returns
all of it in **0.58 s**, faster than the narrower call through the adapter.

Both fields are carried, but they do different jobs: **check status decides
membership, review state only annotates.** A host that cannot supply review
state costs a note, not a group.

So the branch starts in `plot-host.sh`: a richer listing mode that carries check
status and review decision. The board must not call `gh` directly — Principle 3
puts host knowledge in exactly one place, and a board that shells out to `gh`
would silently become GitHub-only, leaving Bitbucket users with two permanently
empty groups and no explanation.

The Bitbucket path degrades explicitly rather than pretending: where the backend
cannot supply check state, the adapter says so and the two groups report
*unavailable* rather than *empty*. Missing review state is milder — it costs a
note on a row, never a group.

Two groups fill:

| Group | Rule |
|---|---|
| ⚠ waiting on you | PR open, not draft, and checks are green **or absent** |
| ⏳ waiting on a machine | PR open with checks actually pending |

**A PR with no checks is waiting on you, not on a machine.** `statusCheckRollup`
comes back **empty** for bot PRs — GitHub does not start workflows for them
without approval. That happened today: the release PR sat with zero checks until
a person approved the run. Filing it under *waiting on a machine* would have
shown "CI running" forever while nothing ran, and nobody would have looked. It
lands in *waiting on you* with the note **no checks** — which says why it is not
green instead of implying it is.

So the check state has three cases, not two: green, pending, absent. Only
*pending* means a machine is working.

**Review state is shown, but never gates.** The distinction matters and the
first draft got it wrong in both directions — first by making "review not yet
approving" part of the membership rule, then by dropping review entirely.

Membership is plain and checkable: *this PR is ready and nobody has merged it*.
That is what puts a row in the group, and it holds whether or not the repo
reviews through GitHub. Sampled here, `reviewDecision` was **empty on all twelve
PRs, merged ones included** — a membership rule built on it would have been
permanently true and carried no information.

But an agent genuinely waiting for a review is something the board must **say**,
because the person looking at the tab is the one who can end that wait. So the
row carries the review state as a note — *awaiting review*, *changes requested*,
*approved* — alongside the age. Absent review state simply produces no note,
which is the honest rendering of "this host has nothing to say about review".

**Approved is approved, with or without a review.** A recorded approval is the
plan's `Approved:` transition record, not a GitHub review — that is Principle 1
and `/plot-approve`'s whole design. The board must never withhold or downgrade
anything because a review is missing; a missing review is a *note on a row*, and
the user overrides it by merging. Nothing downstream may treat the note as a
condition.

The same holds for whatever orchestrates dispatch: a wave whose prior branches
are merged is eligible, review note or not. Making the note load-bearing would
quietly reintroduce a gate the manifesto removed.

The classifier stays a pure function — it takes the PR record as another
argument, which keeps the 14 existing tests meaningful and makes the new rules
testable the same way.

**Degradation is not an afterthought here.** `plot-host.sh` may be absent,
unauthenticated, or offline. The cache already carries `error` and `ageSeconds`;
PR data gets its own `prSource` field with the same honesty: when it is
unavailable, the two groups stay empty **and say why** rather than looking
settled. An empty *waiting on you* that means "no host CLI" must not read as
"nothing needs your review".

**The two sources cache separately, each with its own age.** They fail
independently — the host can be down while git is fine, and a `git fetch` can
fail behind a VPN while `gh` works — so one failure must not stale the other.
A shared cycle would freeze git state on a transient `gh` hiccup, hiding data
that was available the whole time.

Concretely: the git pulse and the PR map are stored side by side, each with its
own timestamp and error. The tab's footer shows both ages when they differ, and
a row whose PR data is stale says so rather than presenting a five-minute-old
check result as current. More state than a single cycle, and the reason is the
same one that made a failed refresh keep its last good pulse: partial knowledge
reported honestly beats complete knowledge reported late.

**Step 3 — phase columns.**

The board shows plan states (`Draft`/`Approved`/`Delivered`/`Released`). The
workflow has four phases that differ by **who leads**: Discovery, Design,
Development, Endgame — three human-led, exactly one agent-led.

| Column | Contains | Leadership |
|---|---|---|
| Discovery | stories with no plans yet | 👤 human-led |
| Design | Draft plans, and Approved without a `Started:` record | 👤 human-led |
| Development | Approved *with* a `Started:` record | 🤖 agent-led |
| Endgame | Delivered, not yet Released — release checklist open (`15/27`) | 👤 human-led |
| Released | Released | — |

`Approved` spans a phase boundary, which is the substantive change: a plan
without `Started:` sits at the end of Design; one with it is in Development. The
board already draws that split as a *Ready*/*In progress* badge, so the data is
there (`started_raw`, verified present) — it simply is not read as a phase
change.

**Development ends at the merge, not at the release.** The first draft of this
table put Delivered-not-Released in *both* Development and Endgame — the same
plans in two columns, which a kanban column cannot be: it is a partition. The
resolution follows the leadership model rather than convenience. Delivered means
the code landed and the agents are done; what remains is verification and
signoff, which is human-led. So Delivered belongs to **Endgame alone**, and
Development holds exactly the plans an agent is working on right now.

**Leadership is carried by symbol and word, with colour as reinforcement.** The
👤/🤖 distinction is the whole point of the column headers, so it must not
depend on hue: roughly one man in twelve distinguishes red from green poorly,
and the same page turns up in greyscale screenshots and printed handouts. Each
header therefore reads `👤 Design` / `🤖 Development` with the leadership word
in its tooltip, and colour merely repeats what the glyph already said. This
costs nothing — the draft's own sketch already carried the glyphs — and is
cheaper to build now than to retrofit.

**Five columns will be tight**, and the layout question is deliberately not
answered here. The board renders `lg:grid-cols-4` today; five plus a swimlane
row header is a real constraint on a laptop. Step 1 established that display
problems are visible on screen and invisible to passing tests, so this one gets
decided the same way: build five, look at it, then choose between narrowing,
folding Discovery into the row header, or scrolling. Guessing now would only
produce a decision to revisit.

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

**Smaller than the draft assumed.** Cards already carry `story` — verified
against a running `/api/board`, which returns `"story": "plot-board"` on the
plans that have one and `null` on the rest. So this is a grouping change in the
render layer, not a new association: no server work, no contract change. The
draft called it "the largest rebuild" on the assumption that the link had to be
built.

What stays uncertain is the layout, not the data. The repo has **one** story:
that proves a row renders, not that the arrangement survives five. The branch
ships last for that reason and can wait for a second story if it reads badly
with one.

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

Round 2 went after what round 1 had not touched — display, error paths, domain
rules — and found three things, one of them a plain contradiction:

- **The phase table put Delivered-not-Released in two columns at once.** A
  kanban column is a partition, so that is a defect rather than an imprecision.
  Resolved along the leadership model: Development ends at the merge, Endgame
  owns everything from Delivered to Released.
- **The review condition was wrong twice before it was right.** "Review not yet
  approving" read as precise and was noise — `reviewDecision` came back empty on
  all twelve PRs sampled here, merged ones included, so the condition would have
  been permanently true. Dropping review entirely was the opposite error: an
  agent waiting on a review is exactly what the person looking at the tab can
  resolve. Settled as **show, never gate** — the row carries a review note, and
  approved is approved with or without one.
- **Five columns will be tight** on a laptop (`lg:grid-cols-4` today). Left
  undecided on purpose: step 1 established that display problems appear on
  screen and not in tests, so this gets built, looked at, and then decided.

Round 3 took the paths the first two had not: what the new data source does when
it half-fails, and what the display assumes about the person reading it.

- **A PR with no checks is not a PR waiting on a machine.** `statusCheckRollup`
  comes back empty for bot PRs, and today's release PR sat that way until a
  person approved the workflow run. Filing it under *waiting on a machine* would
  have shown "CI running" indefinitely while nothing ran. Check state has three
  cases — green, pending, absent — and only *pending* means a machine is busy.
- **The two sources cache separately.** They fail independently, so a `gh`
  hiccup must not stale git data that was available throughout.
- **Leadership cannot be carried by colour alone.** Symbol and word first,
  colour as reinforcement — the distinction is the column headers' whole point,
  and it has to survive colour blindness and greyscale.
- **Swimlanes turned out smaller than the draft assumed.** Cards already carry
  `story`, verified against a running `/api/board`. Step 4 is a grouping change
  in the render layer, not the new association the draft budgeted for.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "How should the board get rich PR data, given pr-list returns only 4 fields?", "a": "Widen plot-host.sh — the adapter stays the one place that talks to the host", "category": "technical"},
    {"q": "BOARD_PHASES breaks four readers, not one — how to handle?", "a": "Update all four in the same branch", "category": "technical"},
    {"q": "Should Endgame parse the release checklist or just say Delivered?", "a": "Parse it (15/27) — overrides the plan's recommendation; test pins the parse", "category": "tradeOffs"},
    {"q": "Delivered-not-Released appeared in both Development and Endgame — which?", "a": "Endgame alone; Development ends at the merge", "category": "domain"},
    {"q": "reviewDecision is empty on every sampled PR — what does 'waiting on you' mean?", "a": "Membership: open + not draft + checks green. Review state is SHOWN as a note but never gates — approved is approved with or without a review, and nothing downstream may treat the note as a condition", "category": "domain"},
    {"q": "Five columns on a lg:grid-cols-4 board — how?", "a": "Build it, look at it, then decide — display defects are not visible in tests", "category": "ux"},
    {"q": "Bot PRs have zero checks — which group?", "a": "waiting-on-you with a 'no checks' note; only genuinely pending checks mean a machine is busy", "category": "domain"},
    {"q": "Refresh cycle now has two sources — what if one fails?", "a": "Cache them separately, each with its own age and error", "category": "technical"},
    {"q": "Leadership colour and accessibility?", "a": "Symbol + word always; colour reinforces only", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": true},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
