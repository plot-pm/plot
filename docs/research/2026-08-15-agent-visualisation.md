# Design: seeing agents, stories, and plans in one board

> **Design draft — agreed in conversation, not yet a plan.** Shaped with Jan on
> 2026-08-15. Step 1 is ready to become a `/plot-idea`; steps 2–4 are sketched
> deliberately loosely, because what step 1 teaches should reshape them.

**The question:** the board shows plans moving through phases. It does not show
*agents* — who is working, on what, and what they are waiting for. That
information exists today only as terminal output from `/plot-fleet` and
`/plot-dispatch --status`.

## The framing that decides everything else

Two things were conflated at the start of the discussion, and separating them is
the design:

| | Artifact status | Agent status |
|---|---|---|
| Moves in | days | minutes |
| States | few, well separated | many, transient |
| Lives in | git, permanently | processes and refs, briefly |
| Answers | "where does this work stand?" | "what is running, what is stuck?" |

Forcing both onto one surface produces a board that answers each question
halfway. **They become two tabs**, and the split also gives them different poll
rates — the quiet board does not pay the price of the live one.

## The four phases, and where they meet Plot's states

From the [workflow deck](https://www.wloka.org:444/cpq-agentic-workflow.html),
the phases differ by **who leads**, not by artifact:

| Phase | Produces | Leadership | Plot state |
|---|---|---|---|
| **i Discovery** | `STORY-<slug>.md` | 👤 human-led · agent-assisted | *before* Draft |
| **ii Design** | reviewed plan | 👤 human-led · agent-assisted | Draft → Approved |
| **iii Development** | merged branches | 🤖 **agent-led** · human-supervised | Approved → Delivered |
| **iv Endgame** | smoke evidence, signoff | 👤 human-led · agent-assisted | Delivered → Released |

Two consequences the board must reflect:

**Agents exist in every phase, but only lead in one.** In i, ii and iv they
assist inside a human's session — no worktree, no pid, nothing to display but
"waiting for a person". Only phase iii has real processes with runtime and logs.
This is why an agent view would be mostly empty if it tried to cover all four.

**`Approved` spans a phase boundary.** A plan with no `Started:` record sits at
the end of Design; one with a `Started:` record is in Development. The board
already draws this as *Ready* vs *In progress* — it simply is not read as a
phase change today.

## Tab 1 — Board (artifacts)

Five columns, leadership colour-coded, stories as swimlanes:

```
                👤 DESIGN      🤖 DEVELOP.    👤 ENDGAME     ✓ RELEASED
┌──────────────┬─────────────┬─────────────┬─────────────┬───────────┐
│ 📖 Customer  │ ┌─────────┐ │ ┌─────────┐ │             │           │
│    portal v2 │ │ auth    │ │ │ checkout│ │             │           │
│    3 plans   │ │ 🔍 PR#70│ │ │ ●●○ W2/4│ │             │           │
├──────────────┼─────────────┼─────────────┼─────────────┼───────────┤
│ 📖 Migration │             │ ┌─────────┐ │ ┌─────────┐ │           │
│    2 plans   │             │ │ schema  │ │ │ import  │ │           │
│              │             │ │ ●○○ W1/3│ │ │ ☑ 15/27 │ │           │
├──────────────┼─────────────┼─────────────┼─────────────┼───────────┤
│ (no story)   │ ┌─────────┐ │             │             │ ┌───────┐ │
│              │ │ hotfix  │ │             │             │ │v2.1.0 │ │
└──────────────┴─────────────┴─────────────┴─────────────┴───────────┘
```

The first column doubles as **Discovery and swimlane header**: a story with no
plans is a row with no cards, which reads correctly as "still in discovery".
The `(no story)` row catches plans created directly — Discovery is optional.

Each column answers a different waiting question, so each carries different card
information:

| Column | Card shows | Answers |
|---|---|---|
| Discovery | story title, derived plan count, age | "is this ripe enough?" |
| Design | plan, PR number, review state | "is this waiting on me?" |
| Development | wave progress `●●○`, active agents, blocked PRs | "is anything running or stuck?" |
| Endgame | checklist progress `15/27`, RC tag | "what is left before signoff?" |

**Only Development carries process state.** In the other three the answer is
always "waiting for a person", and an agent indicator would be empty.

## Tab 2 — Agents (what they do, what they wait for)

Grouped by **reason for waiting**, not by plan, because each group implies a
different action:

```
⚠ WAITING ON YOU (2)
   plot        checkout/api      PR #84 green, no review        2h
   plot        schema/migration  PR #79 conflicts with main     20min

🤖 WORKING (2)
   plot        checkout/ui       building · "adding form validation"  12min
   plot        schema/backfill   building · 3 commits                  4min

⏳ WAITING ON A MACHINE (1)
   plot        checkout/tests    CI running (2 of 3 checks)            6min

💤 QUIET (1)
   plot        auth/tokens       claimed, no commits                   4h  ⚠
```

| Group | What you do |
|---|---|
| Waiting on you | review, merge, decide |
| Working | nothing — just look |
| Waiting on a machine | nothing — CI will finish |
| Quiet | check: still thinking, or dead? |

Sorting by plan would mix these. Sorted by waiting reason the list is workable
top to bottom, and when only "working" is populated you can walk away.

**Quiet is the group that matters most** — a claim with no progress is what the
reaper reports, but here it carries an age and sits in view.

The leading **repo column** is constant today and visually quiet. It exists now
so the list does not need rebuilding when a second repo appears.

## Data: three sources, unequal reliability

```
/api/board?repo=<id>     30s   artifacts       plot-plan-meta.sh (21ms)
/api/fleet?repo=<id>      4s   agents          plot-fleet-scan.sh (526ms)
/api/repos                 —   list (one, today)
```

Measured on this repo: plan parsing 21 ms, a full fleet scan 526 ms across four
plans and eight branches. A 4-second poll therefore costs roughly a tenth of a
core — acceptable for a local tool held open during work, and cheap enough that
websockets or file watchers would be machinery without a visible difference.

| Source | Provides | Available |
|---|---|---|
| `plot-fleet-scan.sh` | claimed / open / merged, waves | **everywhere** — pure git |
| `plot-dispatch --status` | running / finished / failed, pid, log | **local only** — reads `../plot-wt-*` |
| git host (`gh`/`bb`) | PR green, review pending | **needs CLI and network** |

**PR data is cached on a slower beat.** The fleet poll (4 s) refreshes git state;
the host query runs at 30 s. Between host queries the list shows the last known
PR state with its age — "green, checked 20s ago" is more honest than a spinner
every four seconds.

**Degrade, do not hide.** Where the local source is missing — board and workers
on different machines — Tab 2 still derives *waiting on you* and *quiet* from
git alone, and says in its header that process state is unavailable. An empty
tab or a confident guess would both be worse.

## One repo now, many repos meant

`buildBoard` already takes `repoRoot` as a parameter with a `PLOT_REPO_ROOT`
override; the single-repo assumption lives in exactly one line of `index.ts`.
The design keeps every data function repo-parameterised even while the UI shows
one, so the second repo is an addition rather than a rebuild.

`/api/repos` returns one entry today. That is the seam, not ballast: the UI
already asks "which repos exist", gets a single-element answer, and renders no
switcher. When a second appears, the switcher appears.

Note the asymmetry this implies: **Tab 1 stays per-repo** (a kanban across three
projects is mush), while **Tab 2 becomes cross-repo** — "what are my agents
waiting for" is a question about a person, not a repository.

## Build order

Deliberately not one step. The order is chosen so the first delivery teaches
something before the larger rebuild:

1. **Tab 2, git-only** — the four groups from fleet-scan alone. The biggest gain,
   because this information is currently invisible; needs no host CLI and no
   board changes.
2. **PR data** — the host cache, completing *waiting on you* and *waiting on a
   machine*.
3. **Board columns** — five instead of four, leadership colour, `Approved` split
   on `started_raw`.
4. **Swimlanes** — stories as rows. The largest rebuild, last.

Step 1 is usable on its own, and what it teaches should reshape 2–4.

## Open questions

- **Checklist parsing for Endgame.** The card wants `15/27`; the checklist is
  markdown with `- [ ]` items. Parsing it is easy, but it makes the board depend
  on a document format nothing else reads. Worth it, or is a link enough?
- **What counts as "working" without a local pid?** Commits in the last *n*
  minutes is the obvious git-only proxy. What is *n*, and does a worker that
  thinks for twenty minutes read as quiet?
- **Story states.** A story has a status field, but the board has no notion of a
  story being *done*. A finished story with all plans released should presumably
  leave the swimlane view.
