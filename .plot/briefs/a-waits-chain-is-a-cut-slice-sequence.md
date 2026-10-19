## Implementation brief — chain-under-one-heading-reads-as (wave 1: Chain detection)

- **Plan (canonical):** `docs/plans/2026-10-19-chain-under-one-heading-reads-as.md` on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2095 merged
- **Branch:** `bug/a-waits-chain-is-a-cut-slice-sequence` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/an-unmerged-waits-target-blocks-eligibility`, waits on this branch. Nothing waits on wave 2.

### What to build

A heading whose branches each wait for the one before reads `slice not cut` today. Measured 2026-10-19: `manifest-retry-and-race-findings` showed the state on two rows. Under `### Continuation`, `bug/an-unstarted-continue-resumes-no-stranger` carries `<!-- waits: bug/a-continuation-obeys-the-limits -->`, so the two branches already run in sequence. `### Start and stop` in the same plan has the same shape, and both its branches delivered (#2034, #2052).

Two places decide "uncut" by branch-line count alone:

- `skills/plot/scripts/plot-reconcile-scan.sh` section 7 (`:1443-1475`): `jq` selects waves with `(.branches | length) > 1`.
- The board: `packages/board/src/server/fleet.ts:6203` sets `sliceSiblings` to every branch of a wave with more than one; `packages/board/src/server/stuck.ts:244` turns `sliceSiblings.length > 1` into `unsliced-wave`; `packages/board/src/app/lib/agent-rows/stuck.ts:145` prints `slice not cut`.

Add a domain rule in `packages/domain/src/rules/` that takes a heading's branches with their `waits_on` targets and answers whether they form one chain, each branch waiting for the one before. A chain is a cut sequence; two branches with no `waits:` between them stay uncut. Both consumers ask the rule. Branch lists come from `plot-plan-meta.sh` as `waves[].branches[].waits_on`, a list that is absent, not empty, when a branch waits on nothing.

### Decisions the plan settles — do not re-derive them

**The plan leaves three questions open and this slice answers them in its tests.** Chains of three or more count as one chain (the issue says "each branch waiting for the one before", not "pairs"). A `waits:` target under another heading does not link two branches inside this heading. Whether the order of the branch lines must equal the order of the chain is yours to decide and test; state the choice in the rule's TSDoc as behaviour, not history.

**Do not touch eligibility.** Reading `eligible` while the `waits:` target is an open draft is wave 2's defect, and wave 2 starts by reproducing it. This slice changes only whether a chained heading reads uncut.

**Two implementations of one rule need a declared pair.** The scan decides in `jq`, the board in TypeScript. `docs/shell-and-domain.md` requires a corpus test for a declared duplicate: put the cases in `packages/domain/corpus/` so a disagreement names both answers, and stop on a disagreement rather than adjusting a side. Prefer the scan calling the rule through a bundle if `scripts/check-shell-lines.sh` would otherwise force a net growth in shell; that gate stores no number and has no override.

Rules carried over unchanged:

- `packages/domain/**` is arrow functions with factual TSDoc; decision history goes in the commit message.
- Absent is not false: a branch with no `waits_on` key waits on nothing, so it does not extend a chain.
- The view decides nothing: `.tsx` reads the domain's answer.

### Done when

The plan's `## Done when` list for this slice is the specification. Assertions that exist because a naive implementation would pass without them:

- **Two branches with no `waits:` between them stay `slice not cut`.** A rule that only checks for any `waits_on` on any branch passes the headline case and hides real uncut slices.
- **A heading of three where only two chain stays uncut.** Catches a rule that tests pairs.
- **A `waits:` naming a branch under another heading does not make the heading a chain.**
- **Scan and board agree** on the same fixtures through the corpus test; the scan's section 7 output and the board's `unsliced-wave` state both drop the chained heading.
- **`### Continuation` and `### Start and stop` from the `manifest-retry-and-race-findings` plan as fixtures**, read through the scan and through `rowsFromPulse`: neither row reads `slice not cut`.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. The board changes, so `pnpm build:board` locally to test, but restore generated bundles before pushing (`scripts/check-no-bundle-diff.sh`). Add one changeset, description first, `bumps:` last, with a `plot` entry beside `'@plot-pm/board'` since the scan changes. Nothing may add `Wave` where `Slice` is meant.

### Bookkeeping

- Push the first real commit as soon as it exists. An empty claim ref is the row this plan is about.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the plan's `## Slices` section: `### Chain detection (Branch: bug/a-waits-chain-is-a-cut-slice-sequence, PR: #N)`.

### Scope guard

This branch owns:

- the new rule in `packages/domain/src/rules/`, its unit test, and its corpus test in `packages/domain/corpus/`
- `skills/plot/scripts/plot-reconcile-scan.sh` section 7 only
- `packages/board/src/server/fleet.ts` (the `sliceSiblings` line near `:6203`), `packages/board/src/server/stuck.ts` (the `unsliced-wave` arm) and `packages/board/src/app/lib/agent-rows/stuck.ts` only as far as the rule requires
- `test/reconcile/` cases for section 7, one `.changeset/*.md`, the rebuilt artifacts as CI builds them

Not this branch: eligibility and `prereq_missing` in `plot-fleet-scan.sh` and `packages/domain/src/workflows/` (wave 2), `/plot-reslice`.

Other branches in flight, verified 2026-10-19: `git ls-remote --heads origin` lists no branch naming `waits` or `chain`. `idea/a-click-on-a-plan-story` and `bug/the-board-shows-no-rows-when` are in flight on other plans; check `git diff origin/main...origin/<branch> --stat` for `fleet.ts` and `stuck.ts` before the first push, since whichever lands second rebases.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
