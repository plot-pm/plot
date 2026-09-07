# plot-idea

Create a plan for review: idea branch, plan file, and draft PR.

## Purpose

Spoke of the Plot workflow. Handles the first phase of git-native planning: creates an `idea/<slug>` branch, writes a plan file from template in `docs/plans/`, commits, pushes, and opens a draft PR. The plan is then refined on the branch before review.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md`.

## Testing

Validated as part of the Plot end-to-end lifecycle tests:

- **test-plot (v1):** Full lifecycle from `/plot-idea` through `/plot-ship`. Found and fixed input parsing and empty branch issues.
- **test-v2:** Full 4-phase lifecycle (Draft through Released). Verified the v2 refactoring works with the dispatcher and helper scripts.
- Used for real work: planned BDD test coverage via `/plot-idea development`.

## Provenance

Originated as part of the Plot workflow in a private project across 5 Claude Code sessions on 2026-02-07. Initially the `/idea` command (session 1), renamed to `/plot-idea` during the v2 refactoring (session 4). Migrated to a standalone skill in this repo.

See [plot/README.md](../plot/README.md) for the full development history and [plot/changelog.md](../plot/changelog.md) for commit-level details.

## Deliverable search

Step 3 searches the estate for what each slice declares it will build, through
[`plot-deliverable-search.sh`](../plot/scripts/plot-deliverable-search.sh), and
records the answer as the slice's `builds:` annotation in step 5.

**Measured over one week on the Plot repo:** five plans proposed something the
estate already had — `normalizeVersion` (10 callers),
`check-host-cli-callers.sh`, reconcile scan section 7, `readingLoss`,
`computeStatusDrift` — plus a sixth that spent two interrogation rounds on a
gate that had already moved. Every one was found by a grep and none by a round.

**It reports and refuses nothing.** A plan may legitimately propose replacing
something that exists, so the output names the file and line and the author
decides — the same posture as the title-similarity warning beside it.

**The search runs at creation rather than at approval** because the cost of a
duplicated deliverable is paid in the writing: the plan's prose, its rounds, its
brief. Two of the five were caught at approval only because somebody happened to
grep.

Contract tests: `test/reconcile/deliverable-search.test.mjs`.

## Known Gaps

- Input parsing is heuristic-based (slug extraction, title splitting) — unusual formats may need manual correction.
- No validation that `gh auth status` has sufficient scopes before attempting PR creation.

## Planned Improvements

- Configurable plan templates for different plan types (feature, bug, docs, infra).
- Pre-flight scope validation for GitHub CLI authentication.
