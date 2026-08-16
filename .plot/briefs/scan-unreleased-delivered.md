## Implementation brief — release-closes-the-loop, branch 1 of 2

- **Plan (canonical):** `docs/plans/2026-08-16-release-closes-the-loop.md` on `main`
  — https://github.com/plot-pm/plot/blob/main/docs/plans/2026-08-16-release-closes-the-loop.md
- **Approved:** 2026-08-16, jwloka, plan-PR #110 merged
- **Branch:** `bug/scan-unreleased-delivered` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Check — `feature/release-marks-plans` is blocked until this merges,
  because this branch **is** that branch's gate.

### What to build

Three things, in one branch because they are one idea: find the drift, count it,
clear it.

**1. A reconcile section for delivered-but-shipped plans.**

A plan at `Phase: Delivered` whose merge commit is already inside a release tag
is drift — the release happened and the plan never heard about it. This went
unnoticed for **sixteen releases** because nothing compared the two facts.

The rule, and it must be exactly this rule:

    resolve the plan's last `→ #N` annotation to its merge SHA
    tag = lowest `git tag --contains <sha>` matching ^v[0-9]+\.[0-9]+\.[0-9]+$
    tag found → DRIFT, name the version
    no tag     → fine, the plan genuinely is not released yet

**Do not use dates.** The plan documents why at length: the delivery date
records when a plan was *booked*, not when its code merged — `board-sync` sat
five months between the two — and v2.1.0 and v2.2.0 share a tag date, so day
resolution cannot separate them even in principle. A prototype using dates got
three of five wrong.

**Skip `docs` and `infra` plans by type.** `/plot-deliver` already tells their
authors "live on main — no release needed"; reporting them as drift would
contradict a message Plot itself sends, permanently.

**A plan with no PR annotation is `unresolvable`, not skipped.** "Cannot tell"
and "nothing wrong" must not look the same — that indistinguishability is the
whole finding. (No plan in this repo is currently in this state; the branch is
for other repos.)

**2. The footer counter.** `unreleased_delivered=N`, so the sweep stays
machine-countable like every other section.

**3. Back-fill the six existing plans.** Verified by prototype — all six
resolve:

    board-sync            → v1.0.0     kanban-board-v1       → v1.7.0
    reconcile-drift-loop  → v1.6.0     parallel-agent-fleet  → v2.1.0
    fleet-agent-view      → v2.2.0     agent-view-completion → in no release yet

Five need `Phase: Released` plus `- **Released:** <date>, <version>`; the sixth
is correctly unreleased and gets nothing. Re-run the resolution yourself rather
than trusting this list — it is evidence that the rule works, not input data.

**4. `plot-plan-meta.sh` gains `released_raw`**, in the same shape as
`approved_raw` and `started_raw` (verified absent today). Without it the version
is written but unreadable, and the board would re-derive what the record
already states. This is the **plan-format contract**, so:
- `test/reconcile/parser.test.mjs` gains a fixture carrying a `Released:` record
- `packages/board/src/contract/schema.ts` — `PlanMetaSchema` gains the field
- the board artifact is rebuilt (`pnpm build:board`)

### Done when

- The scan reports exactly the five drift cases on this repo **before** the
  back-fill, and **zero** after it. Both numbers are the evidence; show them.
- A fixture repo covers: a released-and-marked plan (no finding), a
  delivered-but-shipped plan (finding), a docs plan (skipped), and a plan with
  no annotation (unresolvable).
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`,
  `pnpm run typecheck`, `pnpm run validate` all pass.
- A changeset is present — this changes helper scripts and the plan-format
  contract, so the plugin version bumps per CLAUDE.md › Versioning.
- macOS ships bash 3.2: **no `declare -A`**, no bash-4-only constructs. A test
  already enforces this.
- **Assert per line, not with whole-output regexes.** This suite has been fooled
  three times by patterns matching across report lines or the summary footer.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section (under `### Check`) on `main`.

### Scope guard

This branch does **not** touch `/plot-release` — that is
`feature/release-marks-plans`, deliberately blocked behind this one so it lands
in a repo where its gate already works. Also out of scope: the twelve
branch-protection bypasses recorded as an open question. Drift → back to the
plan.
