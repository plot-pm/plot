# Agent view — what agents are doing and waiting for

> A second board tab listing every branch an agent could be working on, grouped
> by the reason it is waiting — derived from git alone.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-15, jwloka, plan-PR #97 merged
- **Started:** 2026-08-15, jwloka, `feature/fleet-scan-json`
- **Started:** 2026-08-15, jwloka, `feature/fleet-api`

## Approval

- **Assignee:** jwloka

## Changelog

- The board has a second tab, **Agents**, listing every plan branch grouped by
  why it is waiting: *waiting on you*, *working*, *waiting on a machine*,
  *quiet*, or *not started*. It answers "what are my agents doing" without
  reading terminal output.
- `plot-fleet-scan.sh --json` emits the pulse as machine-readable JSON. The
  human report is unchanged.

Board impact: **yes, and it is the point.** This adds `/api/fleet` and a new
tab. It does not change the plan format, the template, or the `docs/plans`
layout, so the existing board contract is untouched — but it introduces a
*second* contract (fleet JSON) that the board now depends on, which is why
branch 1 exists.

## Motivation

The board shows plans moving through phases. It does not show *agents* — which
branch is claimed, which is progressing, which has been sitting untouched for
four hours. That information exists today only as terminal output from
`/plot-fleet` and `/plot-dispatch --status`: real, but invisible unless you go
looking, and gone the moment the scrollback rolls.

The design draft (`docs/research/2026-08-15-agent-visualisation.md`) argues
that artifact status and agent status are different time axes — days versus
minutes, permanent versus transient — and should therefore be two tabs with
different poll rates. This plan builds the second tab, and only that.

**Why this step first.** Of the draft's four build steps, this is the only one
whose information is currently invisible; the other three re-present things the
board already shows. It also needs no host CLI and changes no existing board
code path, so it can be wrong without breaking what works.

## Design

### Approach

Three layers, each a branch. The seam between them is a JSON contract, which is
what makes branch 1 a tracer rather than a chore.

**The finding that shaped this plan.** `plot-fleet-scan.sh` emits prose, by
design — Manifesto Principle 3 says scripts collect and report, and a human
reading a pulse is the primary case. But prose is not a contract: the board
would have to screen-scrape lines like `  Tracer — eligible` and
`      feature/x — in progress`, and any future wording change would silently
break the tab. Two ways out:

- **Add `--json` to the scan** — one script, one derivation, two renderings.
- **Re-derive waves and claims in TypeScript** — a second implementation of
  wave eligibility and claim detection, guaranteed to drift from the shell one.

The first is right, and cheap: the script already computes a tab-separated
intermediate (`idx / branch / state / deferred / wave / claim`) and only
flattens it to prose at the end. `--json` prints that structure instead of
formatting it.

**Layer 1 — `plot-fleet-scan.sh --json`.** Emits one object per run:

    {
      "main": "main",
      "head": "3801550",
      "plans": [
        { "file": "docs/plans/2026-07-25-opus5-longhorizon-hardening.md",
          "waves": [
            { "name": "Tracer", "verdict": "eligible",
              "branches": [
                { "ref": "feature/opus5-hardening-ralph-bounds",
                  "state": "wip", "deferred": false, "claim": null } ] } ] }
      ],
      "summary": { "plans": 4, "waves": 4, "branches": 8, "claimed": 0,
                   "eligible": 1, "blocked": 1, "deferred": 0 }
    }

Field names above are illustrative; match `plot-plan-meta.sh`'s existing house
style rather than inventing a second convention in the same repo — it emits
`branch` (not `ref`) and an empty string (not `null`) for an absent claim.

The state vocabulary is the script's existing internal one, unchanged and
un-prettified: `open` · `wip` · `merged` · `claimed` · `deferred`; wave verdicts
`complete` · `eligible` · `blocked`. Presentation names ("in progress") stay in
the renderer — the JSON is the raw derivation, so the board is never parsing a
label that exists for humans.

**Layer 2 — `/api/fleet`, served from a cache the server refreshes itself.**
A `buildFleet(opts: BuildBoardOptions)` in `packages/board/src/server/fleet.ts`,
invoked from `src/server/index.ts` alongside `/api/board`.

The endpoint does **not** run the scan. Measured on this repo (4 plans, 8
branches): 1.05 s with its `git fetch`, 0.49 s with `--no-fetch`, 0.53 s with
`--offline`. The board is a single-threaded HTTP server and the existing code
uses `execFileSync`, so a 4 s client poll running a 1.05 s synchronous scan
would block the event loop **26% of the time** — the board would stutter while
the tab is open, and worse as branch count grows.

Instead the server keeps a cached pulse and refreshes it on its own timer with
the **async** `execFile`, so no request ever waits on bash. `/api/fleet` returns
the cached object plus the age of the scan that produced it. Client poll rate
and scan duration are thereby decoupled: a repo with twenty plans gets a
*staler* tab, not a *slower* board — degradation you can see (the age is on
screen) rather than degradation you feel.

The refresh cycle runs the scan in its **default mode, with the fetch**. The
whole point of moving it off the request path is that a second of work is now
free, and the fetch is what lets the board see branches a remote worker pushed
— without it the tab only reflects whatever another process happened to fetch.
`--json` is the only flag it adds.

The cache warms at server start, so the first person to open the tab does not
wait a second for it; until that first scan lands the endpoint reports
*not ready yet* rather than an empty fleet. **A failed refresh never overwrites
a good result**: the tab keeps showing the last successful pulse, with its age
and the error. Replacing real state with emptiness because one scan failed is
the failure mode that makes a monitoring view untrustworthy.

The parse goes through a zod schema in `src/contract/schema.ts` — where the
board's contracts already live — and each branch maps to a **waiting group**.

The grouping rule, git-only:

| Group | Rule at this step |
|---|---|
| ⚠ waiting on you | `state: merged` in a wave that is not yet `complete`, or a branch whose claim is resolved but unmerged |
| 🤖 working | `state: wip` with a commit newer than the freshness window |
| ⏳ waiting on a machine | *empty at this step* — needs PR/CI data (step 2 of the draft) |
| 💤 quiet | `state: claimed`, or `wip` with no commit inside the window |
| 📋 not started | `state: open` — the branch does not exist on origin yet |

Five groups, not the draft's four. The draft's set did not partition the scan's
state vocabulary: `open` — a branch a plan names but nobody has pushed — fell
through into nothing, so a plan with five unstarted branches would have rendered
as a plan with no work. It is a real waiting reason and a distinct one: this
work is not waiting on a machine or on review, it is waiting on the decision to
dispatch it. Folding it into *waiting on you* would merge "review this" with
"start this", which are different actions.

The machine group is rendered but empty, with a one-line note saying PR data is
not wired yet. An absent group would read as "nothing is waiting on CI", which
is a claim this step cannot make.

**Freshness window.** The draft left "what counts as working without a pid"
open. Answer for this step: **a branch is *working* if its tip commit is newer
than `Fleet quiet after`, a `## Plot Config` key defaulting to 30 minutes.**
Config, not a constant, precisely because 30 is a guess — a repo whose agents
think for an hour sets it higher without a code change. The card shows the
commit age either way, so a misjudged window is visible rather than misleading.

**Layer 3 — the tab.** `App.tsx` gains a two-item tab bar; the existing board
becomes the first tab and is otherwise untouched. `AgentList.tsx` renders the
five groups in fixed order (waiting on you → working → machine → quiet → not
started), each row: repo · branch · plan · state · age. Empty groups render
their heading with a muted "none", because a group vanishing is
indistinguishable from a group being empty.

Polls at 4 s, independent of the board's existing 30 s poll. That rate is now
cheap in the way that matters: the request hits a cache, so it costs a JSON
serialisation rather than a scan. The repo column is constant today and stays —
it is where the second repo lands without a rebuild.

**Degrade, do not hide.** If the scan fails or is absent, the tab shows the
error and the last successful result with its age. It never shows an empty list,
which would read as "no agents are working".

### Testing

`test/reconcile/fleet.test.mjs` already covers the scan, so branch 1 extends an
existing suite rather than starting one. Two tests, and the second matters more
than the first:

- **`--json` parses and carries the structure** — a fixture repo, `--json`
  through `JSON.parse`, asserting wave verdicts and per-branch states against
  known refs. Assert per line, not with a whole-output regex: this suite has
  been fooled three times by patterns matching across report lines or the
  summary footer.
- **The human output is byte-identical without `--json`** — the regression that
  actually protects the change. `--json` is worth doing precisely because the
  prose is a human interface and not a contract; a test that pins the prose is
  what keeps adding a machine mode from quietly reshaping it.

Branches 2 and 3 fall under the board's own gates, which the DoD already
names: `pnpm run typecheck`, `pnpm run test:board`, and `pnpm run build:board`
producing no git diff.

**Manifesto check.** Principle 1 (git is the database): every value derives
from refs and commits; nothing new is stored. Principle 3: the script collects,
the board interprets — the grouping heuristic lives in TypeScript, not in the
shell. Principle 5 (project-agnostic): no plot-specific names; the freshness
window is config. Principle 12 (evidence over assertion): the tab shows commit
ages, not inferred activity.

`--json` is an output mode and nothing more: it composes with `--offline`,
`--no-fetch` and the rest rather than implying any of them, and the refresh
cycle passes it alone. A flag that silently changed network behaviour would make
the board's data depend on how it asked rather than on what it asked for.

### Open Questions

- [ ] What is the right default for `Fleet quiet after`? 30 minutes is a guess
      that only real use can correct — deliberately a config key rather than a
      constant for exactly that reason.
- [ ] Does the *not started* group need the wave's verdict on each row
      (`eligible` vs `blocked`)? Eligible-but-unstarted is actionable now;
      blocked-and-unstarted is not, and showing them identically may invite
      dispatching work whose seam has not landed.

## Branches

### Tracer

- `feature/fleet-scan-json` — add `--json` to `plot-fleet-scan.sh`, emitting the
  existing internal state vocabulary; human output unchanged → #102
  Layers: shell derivation → JSON contract → a test that parses it
  Proves: the scan's internal structure survives serialisation without a second
  derivation, which is the assumption the other two branches rest on
  Status: Not started

### Server

- `feature/fleet-api` — `buildFleet()` + cached refresh cycle + `/api/fleet` + zod schema + waiting-group mapping

### Client

- `feature/fleet-tab` — tab bar in `App.tsx`, `AgentList.tsx`, five groups, 4 s poll, degraded states

<!-- Three waves, not two: fleet-api and fleet-tab both rebuild the checked-in
     690 KB bundle skills/plot/scripts/board/board-server.mjs, so running them
     concurrently produces a conflict in a generated file that cannot be
     hand-merged. Serialising them is exactly what waves are for. -->

The wave split between server and client is not thematic. Both branches must
regenerate `skills/plot/scripts/board/board-server.mjs` — a 690 KB bundle that
is checked in, gated by the DoD's no-diff rule, and covered by no merge driver.
Two branches rewriting it concurrently collide in a file nobody can resolve by
hand, so they run in sequence. The cost is small here (two branches, no real
parallelism lost) and the alternative — dropping the artifact from both branches
and rebuilding once at the end — would fail the DoD gate on both PRs.

Worth noting for the plans that follow: a generated artifact is invisible to
"which source files does this branch touch?" reasoning, which is how the
collision got into the first draft of this plan. `/plot-merge-queue` predicts
conflicts from `git merge-tree`, so it would catch this one — but only after
both branches exist.

## Notes

Design draft: `docs/research/2026-08-15-agent-visualisation.md` (merged to main,
PR #96). This plan implements **step 1 of four**; steps 2–4 (PR data, five board
columns, story swimlanes) stay unplanned deliberately, because what this step
teaches should reshape them.

The draft named `index.ts` as the home of the single-repo assumption; the actual
file is `packages/board/src/server/index.ts`, and `BuildBoardOptions` already
carries `repoRoot` + `scriptsDir`. `buildFleet()` takes the same options object,
so the multi-repo seam costs nothing here.

Definition of Done: `docs/definition-of-done.md`.

Interrogated with `/challenge-the-plan` over two rounds before approval. Three
findings changed the plan's structure rather than its wording: the synchronous
scan on a 4 s poll (now a server-side cache), the unassigned `open` state (now a
fifth group), and the shared generated bundle (now three waves instead of two).
The scan timings quoted in the Design were measured on this repo, not estimated.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Synchronous 0.5-1.05s scan on a 4s poll blocks the event loop 13-26%", "a": "Server-side cache, async execFile, endpoint serves cache + age", "category": "nonFunctional"},
    {"q": "State `open` falls through the four-group table", "a": "Fifth group: not started", "category": "domain"},
    {"q": "Plan states no test strategy; DoD gates on tests", "a": "Both: JSON structure test + human-output regression", "category": "technical"},
    {"q": "fleet-api and fleet-tab both rebuild the checked-in 690KB bundle (unresolvable conflict, same wave)", "a": "Serialise into separate waves", "category": "technical"},
    {"q": "Cache behaviour at startup and on failure", "a": "Warm at start; failed refresh never overwrites last good result", "category": "technical"},
    {"q": "Which network mode for the refresh cycle", "a": "Default, with fetch — it no longer blocks anyone", "category": "nonFunctional"}
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
