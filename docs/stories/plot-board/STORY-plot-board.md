---
title: Making parallel work visible
author: jwloka
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Making parallel work visible

## Objective

Give a person running several agents at once a single place to answer two
questions: **where does this work stand**, and **what is everything waiting
for**. Four plans across five months have each answered part of that; this
story is the frame that makes them one piece of work rather than four.

## Why Now

The parallel fleet landed in August. Agents can now be dispatched across waves,
claim branches by ref push, and run detached — so for the first time it is
normal for five things to be in flight that no human is watching.

That inverted the bottleneck. When one agent worked at a time, watching the
terminal was enough. With a fleet, the scarce resource is no longer execution;
it is **knowing what is happening**. `/plot-fleet` and `/plot-dispatch --status`
answer it in a terminal, once, and the answer is gone when the scrollback rolls.

The board is the surface that could hold the answer, and it is already
first-class — a package, a contract, tests, a Definition of Done gate. What it
shows is plans. What it does not show is agents.

## Decisions Taken in Scoping

**Why one story for four plans?** They were written five months apart and read
as unrelated: a GitHub Projects sync, a package graduation, a dispatch
mechanism, a visualisation. They share one intent — *the state of work should
be visible without asking* — and the later ones only make sense as answers to
gaps the earlier ones left. Naming that intent once is cheaper than
re-deriving it from four Motivation sections.

**Why not fold them into one plan?** Each was independently reviewable and
shipped on its own. Plot's own Principle 4 is one plan, many branches — a story
is the layer above: many plans, one intent. Rewriting history into a single
plan would destroy the record of how the understanding actually developed.

**Why is this story `active` rather than `done`?** Three plans are delivered
and one is approved with a tracer branch in flight. The agent view is the part
that closes the loop, and it has not been built yet.

## Current Plan

### Phase 1: The board becomes real ✅

- ✅ `board-sync` — plan phase transitions drive GitHub Projects columns (#8) — 2026-03-15
- ✅ `kanban-board-v1` — own TypeScript package, one plan parser, story filter, plan viewer, DoD gate (#40) — 2026-07-13

### Phase 2: Parallel work becomes possible ✅

- ✅ `parallel-agent-fleet` — waves, claim-by-ref, worktree dispatch, merge queue, reaper (#72, #75, #76, #77, #78) — 2026-08-14

### Phase 3: Parallel work becomes visible 🔄

- 🔄 `fleet-agent-view` — the agent tab, in four steps; approved and started 2026-08-15
  - 🔄 Step 1 `feature/fleet-scan-json` → `feature/fleet-api` → `feature/fleet-tab` — git-only agent list, three waves
  - ⏸️ Step 2 — PR/CI data, completing *waiting on a machine*
  - ⏸️ Step 3 — five board columns, leadership colour, Approved split
  - ⏸️ Step 4 — story swimlanes

## Open Points

- ⏸️ **Step 4 has no test case in this repo** — story swimlanes need stories, and
  until this file existed there were none. This story is now the first one; a
  single swimlane still does not prove the layout works with several.
- ⏸️ **What counts as "working" without a local pid?** Answered provisionally for
  step 1 (tip commit newer than `Fleet quiet after`, default 30 min) but the
  default is a guess only real use can correct.
- ⏸️ **Does the board stay one-repo?** The design keeps every data function
  repo-parameterised, and tab 2 is meant to go cross-repo — "what are my agents
  waiting for" is a question about a person, not a repository. Not decided.
- ✅ Where does the agent view live — new tab or extended board? → See Decisions

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-12 | Board becomes its own package, ships a prebuilt dependency-free artifact | `pnpm board` must work with no install step; a board nobody can start is not a board |
| 2026-07-12 | Board consumes `plot-plan-meta.sh` rather than parsing plans itself | Plan format changes in one place or it drifts in two |
| 2026-08-14 | Waves gate concurrency; a wave is eligible once every prior non-deferred branch merged | Dispatching everything at once collides; dispatching one at a time is not a fleet |
| 2026-08-14 | A claim is an empty commit pushed to the branch ref, not a bare pointer | Two branches at the same commit do not diverge, so both pushes succeed and both sides think they hold the claim |
| 2026-08-15 | Artifact status and agent status become **two tabs**, not one view | Days versus minutes, permanent versus transient — one surface answers each halfway |
| 2026-08-15 | Tab 2 groups by *reason for waiting*, not by plan | Each group implies a different action: review it, nothing, nothing, go check whether it died |
| 2026-08-15 | `/api/fleet` serves a server-refreshed cache, not a scan per request | A 1.05 s synchronous scan on a 4 s poll blocks the board's event loop 26% of the time |
| 2026-08-15 | One repo now, every data function repo-parameterised | The second repo should be an addition, not a rebuild |

## Key Findings

### 2026-08-15 — Reading is not verifying

**Expected:** Deliverables described in a merged plan are present in the code.

**Discovered:** Refutation passes at delivery time found two gaps in plans whose
work had shipped months earlier. `board-sync` promised five event-to-column
transitions and built four — new implementation PRs never reached *Ready*,
because the plan was written for Plot 1 where `/plot-approve` created the
branches, and Plot 2 moved that to `/plot-implement` without the transition
moving with it. `kanban-board-v1` shipped as `0.3.0`, never the `1.0.0-rc.1` it
chose.

**Impact:** Neither was caught by reading, by CI, or by five months of use. The
board-sync gap was invisible precisely because *a board update that never
happens looks exactly like a board nobody configured*. Delivery-time refutation
is now how these plans get closed, and `plot-update-board.sh` still has no test.

### 2026-08-15 — The reconcile scan checks shapes, not states

**Expected:** `plot-reconcile-scan.sh` surfaces plans whose work has landed but
were never delivered.

**Discovered:** It missed `kanban-board-v1` for five weeks because that plan ran
single-PR on its idea branch — the scan looks for *implementation branches
merged while the plan is still Approved*, a shape that plan never had. It also
reports the seven `opus5-hardening` branches as orphans although all seven are
ancestors of open PR #57.

**Impact:** Two concrete scan improvements, neither built: recognise
single-PR-mode plans, and treat "contained in an open PR" as distinct from
orphaned via `git merge-base --is-ancestor`.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Editing plans from the board | The board is read-only by design; approving from a web page moves a git-native decision off git | A recorded approval in the file can be produced by the board without becoming the source of truth |
| A public board server (`board.plot.pm`) | Local-only keeps the security surface at zero; researched in `docs/research/2026-07-12-board-public-server.md` | Someone needs to watch a fleet they cannot reach from their own machine |
| Websockets / file watching for live updates | Measured: a full fleet scan is ~0.5 s and a 4 s poll costs a tenth of a core — machinery without a visible difference | A repo large enough that polling is felt |
| Cross-repo boards | One repo first, deliberately; the seam is kept open rather than built | A second repo is actually being watched |

## Progress Tracking

Plan phases are the ones Plot records, not a second vocabulary: **Delivered**
means every implementation PR merged and the plan booked; **In progress** means
approved *and* carrying a `Started:` record. The board derives the same split
from the same field.

| Plan | PRs | Phase | Notes |
|------|-----|-------|-------|
| `board-sync` | [#8](https://github.com/plot-pm/plot/pull/8) | ✅ Delivered 2026-08-15 | Merged 2026-03-15; delivered five months later. Gap found at delivery and closed first ([#98](https://github.com/plot-pm/plot/pull/98)) |
| `kanban-board-v1` | [#40](https://github.com/plot-pm/plot/pull/40) | ✅ Delivered 2026-08-15 | Merged 2026-07-13; delivered five weeks later. Shipped as 0.3.0, not the planned 1.0.0-rc.1 |
| ↳ `kanban-board-v1-open-questions` | — | 📋 Decision log | Output of `/challenge-the-plan`; five questions Max decided 2026-07-12. Not a plan — kept as the record behind Q1's deferred `1.0.0-rc.1` |
| `parallel-agent-fleet` | #72, #75, #76, #77, #78 | ✅ Delivered 2026-08-14 | Five stages; three adversarial audits, four defects found by execution |
| `fleet-agent-view` | [#97](https://github.com/plot-pm/plot/pull/97) (plan) | 🔄 In progress | Started 2026-08-15 on `feature/fleet-scan-json`; brief in `.plot/briefs/`. Step 1 of four |

## Session Log

### 2026-08-15 — Consolidating four plans into one story

Written after delivering the two board plans that had been sitting in
*Approved* — one for five months, one for five weeks. Both were booked, not
built: the work had shipped and was in daily use.

**Key outcomes:**

- Four plans named as one intent: the state of work should be visible without
  asking
- Two delivery-time refutation passes found real gaps in shipped work; one was
  fixed before delivery ([#98](https://github.com/plot-pm/plot/pull/98))
- This is the repo's first story — Plot has built story tooling (`Story:` field,
  board filter, `plot-story-lint.sh`, this template) and never used it, which is
  also why step 4 of the agent view had nothing to render
