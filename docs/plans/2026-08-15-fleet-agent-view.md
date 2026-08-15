# Agent view — what agents are doing and waiting for

> A second board tab listing every branch an agent could be working on, grouped
> by the reason it is waiting — derived from git alone.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board has a second tab, **Agents**, listing every plan branch grouped by
  why it is waiting: *waiting on you*, *working*, *waiting on a machine*, or
  *quiet*. It answers "what are my agents doing" without reading terminal
  output.
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

**Layer 2 — `/api/fleet`.** A `buildFleet(opts: BuildBoardOptions)` in
`packages/board/src/server/fleet.ts`, invoked from `src/server/index.ts`
alongside `/api/board`. It calls the scan exactly the way `board.ts` already
calls `plot-config.sh` — `execFileSync('bash', [scriptPath, '--json',
'--offline'], { cwd: repoRoot })`, no shell string — parses it through a zod
schema in `src/contract/schema.ts`, and maps each branch to a **waiting
group**.

The grouping rule, git-only:

| Group | Rule at this step |
|---|---|
| ⚠ waiting on you | `state: merged` in a wave that is not yet `complete`, or a branch whose claim is resolved but unmerged |
| 🤖 working | `state: wip` with a commit newer than the freshness window |
| ⏳ waiting on a machine | *empty at this step* — needs PR/CI data (step 2 of the draft) |
| 💤 quiet | `state: claimed`, or `wip` with no commit inside the window |

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
becomes the first tab and is otherwise untouched. `AgentList.tsx` renders four
groups in fixed order (waiting on you → working → machine → quiet), each row:
repo · branch · plan · state · age. Empty groups render their heading with a
muted "none", because a group vanishing is indistinguishable from a group being
empty.

Polls at 4 s (the draft's measurement: a full scan is 526 ms, so ~a tenth of a
core), independent of the board's existing 30 s poll. The repo column is
constant today and stays — it is where the second repo lands without a rebuild.

**Degrade, do not hide.** If the scan fails or is absent, the tab shows the
error and the last successful result with its age. It never shows an empty list,
which would read as "no agents are working".

**Manifesto check.** Principle 1 (git is the database): every value derives
from refs and commits; nothing new is stored. Principle 3: the script collects,
the board interprets — the grouping heuristic lives in TypeScript, not in the
shell. Principle 5 (project-agnostic): no plot-specific names; the freshness
window is config. Principle 12 (evidence over assertion): the tab shows commit
ages, not inferred activity.

### Open Questions

- [ ] Does `--json` belong behind `--offline` too, or should the JSON mode
      always skip the network? Leaning: independent flags, since a board with
      network access wants fresh merge state.
- [ ] Should *waiting on you* include branches whose wave is `eligible` but
      unclaimed — work nobody has picked up? It is a real waiting reason, but a
      different one from "review this". Possibly a fifth group rather than a
      widened first.

## Branches

### Tracer

- `feature/fleet-scan-json` — add `--json` to `plot-fleet-scan.sh`, emitting the
  existing internal state vocabulary; human output unchanged
  Layers: shell derivation → JSON contract → a test that parses it
  Proves: the scan's internal structure survives serialisation without a second
  derivation, which is the assumption the other two branches rest on
  Status: Not started

### Implementation

- `feature/fleet-api` — `buildFleet()` + `/api/fleet` + zod schema + waiting-group mapping
- `feature/fleet-tab` — tab bar in `App.tsx`, `AgentList.tsx`, 4 s poll, degraded states

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
