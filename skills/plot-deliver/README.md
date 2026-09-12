# plot-deliver

Verify all implementation is done, then deliver the plan.

## Purpose

Spoke of the Plot workflow. Handles the delivery phase — verifies all implementation PRs are merged, performs a completeness check (plan deliverables vs actual PR diffs, questioned by a [`/plot-panel`](../plot-panel/SKILL.md) of lenses), and delivers the plan (moves the symlink from `active/` to `delivered/`, updates the Phase field). Plan files never move — they stay at their date-prefixed path. For features/bugs, `/plot-release` follows; for docs/infra, delivery means the work is live.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md`.

## Testing

Validated as part of the Plot end-to-end lifecycle tests:

- **test-v2:** Full 4-phase lifecycle (Draft through Released). Verified PR merge checking, plan delivery with dated prefix, and the completeness verification flow.
- Used for real work: delivered BDD test coverage via `/plot-deliver development`.

## Provenance

Originated as part of the Plot workflow in a private project. Created during the v2 refactoring (session 4, 2026-02-07) as a new command splitting delivery from the original ship flow. Migrated to a standalone skill in this repo.

See [plot/README.md](../plot/README.md) for the full development history and [plot/changelog.md](../plot/changelog.md) for commit-level details.

## Known Gaps

- Completeness verification relies on LLM judgment of PR diffs against plan deliverables — may miss subtle gaps.
- **The `Evidence: executed|read` gate checks the claim, not the command.** Step 5 requires each juror to commit to having executed or only read, and `plot-panel.mjs check` refuses a verdict that omits the line. It cannot verify that the command a juror names actually ran, or that its output matches — a juror writing `executed` having run nothing defeats it, and only a person reading the verdict sees that. Validating the command is a change to `readJuror`, which is deliberately vocabulary-agnostic; it would need its own plan.
- **A delivery with no panel record is unquestioned, not clean.** Step 5 falls back to the per-PR refutation when `skills/plot-panel/` is absent, and reports that it did. Nothing prevents a reader from treating the fallback as equivalent.
- Relies on `../plot/scripts/plot-impl-status.sh` via relative path.

## Planned Improvements

- Structured completeness checklist output for easier review.
- **Whether three lenses is the right number is unmeasured.** `/plot-panel` takes N and says four is a guess; this caller chose three because they are the three ways a delivery is wrong. The first real number comes from running it.
- Support for partial delivery (deliver completed branches, keep plan active for remaining work).
