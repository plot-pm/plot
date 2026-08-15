## Implementation brief — fleet-agent-view, branch 1 of 3

- **Plan (canonical):** `docs/plans/2026-08-15-fleet-agent-view.md` on `main`
  — https://github.com/plot-pm/plot/blob/main/docs/plans/2026-08-15-fleet-agent-view.md
- **Approved:** 2026-08-15, jwloka, plan-PR #97 merged
- **Branch:** `feature/fleet-scan-json` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Tracer — the two branches behind it (`feature/fleet-api`,
  `feature/fleet-tab`) are blocked until this merges. That is deliberate:
  both rebuild the checked-in 690 KB `board-server.mjs` bundle and would
  collide in a file nobody can hand-merge.

### What to build

Add `--json` to `skills/plot/scripts/plot-fleet-scan.sh`. It emits the pulse as
one JSON object instead of prose. Nothing else about the script changes.

The script already computes a tab-separated intermediate — `idx / branch /
state / deferred / wave / claim`, around line 256 (`states+=...`) — and only
flattens it to prose at the end. `--json` serialises **that structure**. Do not
add a second derivation; the whole point of this branch is that the shell keeps
one derivation and gains one more rendering.

**State vocabulary — emit the internal one, unprettified:**
`open` · `wip` · `merged` · `claimed` · `deferred`; wave verdicts
`complete` · `eligible` · `blocked`. Presentation names ("in progress") stay in
the renderer. The board must never parse a label that exists for humans.

**Field naming:** match `plot-plan-meta.sh`'s house style, not the plan's
illustrative sketch — it emits `branch` (not `ref`) and an empty string (not
`null`) for an absent claim. Two JSON conventions in one repo is the thing to
avoid.

**`--json` is a pure output mode.** It composes with `--offline`, `--no-fetch`,
`--loose`, `--slug` and the rest; it implies none of them. A flag that silently
changed network behaviour would make the board's data depend on how it asked
rather than what it asked for.

Include the summary counters that the prose footer already carries
(`plans`, `waves`, `branches`, `claimed`, `eligible`, `blocked`, `deferred`,
`main`), plus the head ref shown in the banner.

### Done when

- `--json` output parses via `JSON.parse` and carries wave verdicts and
  per-branch states matching the refs in a fixture repo.
- **The human output is byte-identical without `--json`.** This is the test that
  matters: `--json` is worth doing precisely *because* the prose is a human
  interface and not a contract, so a test pinning the prose is what stops a
  machine mode from quietly reshaping it.
- Tests extend `test/reconcile/fleet.test.mjs` (22 tests already there).
  **Assert per line, not with a whole-output regex** — this suite has been
  fooled three times by patterns matching across report lines or the summary
  footer.
- `pnpm test` and `pnpm run test:reconcile` pass.
- A changeset is present (`pnpm changeset`) — this changes a skill script, so
  the plugin version bumps per CLAUDE.md › Versioning.
- macOS ships bash 3.2: **no `declare -A`**, no bash-4-only constructs. A test
  already enforces this across all scripts.
- Board impact: this branch adds the contract the board will consume but touches
  no board code, so `skills/plot/scripts/board/board-server.mjs` must **not**
  change here. If a rebuild produces a diff, something is wrong.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section (under `### Tracer`) on `main`. `/plot-deliver` back-fills
missed ones, but written-at-creation keeps the plan current.

### Scope guard

Implement what the plan says. Two things are deliberately **not** in this
branch: the waiting-group mapping (that is `feature/fleet-api`, and it is
TypeScript, not shell) and anything touching the board. Drift → back to the plan.
