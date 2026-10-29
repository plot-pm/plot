## Implementation brief — fleetd-reviews-every-slice-pr-in (wave 2: Indexed review state)

- **Plan (canonical):** [docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md](../../docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Branch:** `feature/the-index-records-the-review` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR (this repo's ruleset requires it since 2026-10-15)

Wave 1 (`feature/a-review-opens-no-issue`, PR #2928) is merged — `reviewIssue` and the all-severity findings comment already ship. This wave does not depend on wave 1's code; it is independent work on `PrIndexRow` and the fold. Three waves wait on this one: `feature/the-scope-is-read-from-git`, `feature/the-review-run-is-locked` and `feature/fleetd-reviews-slice-prs` all read the fields this wave adds.

### What to build

`pr-refresh.ts`'s fold today stores no review record on a `PrIndexRow`: `review` is GitHub's `reviewDecision` (empty on all live rows), and `plot/review` — the status context the reviewer writes — is folded into `checks` by `checks_of` (`skills/plot/scripts/plot-host.sh:706-707`) along with every other rollup status context. That means the index cannot distinguish "CI red" from "a HIGH review failure" from "no review yet" — all three can read as `checks: failing` or both "no review" and "review success" read `green`. Add four optional fields to `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:29`) — `plotReview`, `plotReviewSha`, `plotReviewAt`, `ciChecks` — bump `PR_INDEX_VERSION` from 5 to 6 (currently `5` at `pr-index.ts:12`), and write them from `pr-refresh.ts` on the GitHub-rollup arm only. Add `reviewReaskPrNumbers` beside `pendingOpenPrNumbers` (`packages/domain/src/rules/pr-index.ts:295`) and union it into the delta re-ask.

### The decisions the plan settles — do not re-derive them

**Four new fields, `checks` unchanged.** `review` keeps meaning GitHub's `reviewDecision`. `checks` keeps folding `plot/review` the way it always has — `pendingOpenPrNumbers` and every existing reader of `checks` key on that behavior, and changing it would silently break them. The four new fields are additive: `plotReview` (`success` · `failure` · `pending` · `error` · `absent`), `plotReviewSha` (the commit the rollup named for `plot/review`), `plotReviewAt` (the `StatusContext.startedAt` ISO time for that status), `ciChecks` (`green` · `pending` · `failing` · `none` · `unknown` — the rollup folded the same way `checks_of` folds it, but with the `plot/review` context excluded, bound to `checksSha`).

**"Not asked" and "asked, found nothing" are different values, and that distinction is the point.** A row the writer could not ask, or an adapter that answers no rollup at all (Jenkins, Bitbucket, the plain listing), carries none of the four fields — missing means "not asked." A row that WAS asked and found no `plot/review` context in the rollup gets `plotReview: absent`. Every arm downstream (the review-start rule in the next wave) must read a missing field as "I don't know" and an `absent` field as "confirmed no review" — collapsing the two reintroduces the exact ambiguity ("no review" vs "review success" both reading `green`) that motivated this plan (Motivation point 2). A failed or partial read must never write `absent` — only a successful, complete rollup read earns that value.

**Where the fields come from.** The GitHub-without-Jenkins rollup arm already requests `statusCheckRollup` in its `pr list --json` call (`skills/plot/scripts/plot-host.sh:4798`) and folds it with `jq` at `plot-host.sh:4803-4812`. The four new fields ride that same call — find `plot/review` in `.statusCheckRollup[]` (matching on `context`/`name`, the same way `checks_of` matches `ck` at `plot-host.sh:706-707`) and emit its state, its target commit, and its `startedAt` as the new fields, plus `ciChecks` as `checks_of` would compute it with that one context filtered out. On `CI: jenkins` (`plot-host.sh:4746`, no `statusCheckRollup` requested) and on Bitbucket, emit none of the four fields — not a defaulted `absent`. A `v5` store file read by `v6` code must decode as `null` (per the schema discipline already established for a version mismatch elsewhere in this file) rather than crash or silently upgrade.

**The re-ask rule, modeled on `pendingOpenPrNumbers`.** `pendingOpenPrNumbers` (`packages/domain/src/rules/pr-index.ts:295-301`) is the shape to follow: filter `held.rows` for `state === 'OPEN'`, map to `.number`, return `readonly number[]`, and answer `[]` on a `null` store — never throw. `reviewReaskPrNumbers(held, branches)` takes the same shape but adds a second input (the in-scope branch list) and a different predicate: an open, non-draft row on one of `branches` whose `ciChecks` is `green` with `checksSha === headSha`, and whose `plotReview` is `absent`, `pending`, or names a SHA older than `headSha`. Union its result with `pendingOpenPrNumbers`'s under the pass's existing streak bound `PR_PENDING_REASK_LIMIT = 5` and slow cadence `PR_PENDING_REASK_SLOW_MS = 300_000` (both at `packages/fleet/src/shared/pr-refresh.ts:281,284`, applied at `pr-refresh.ts:1628,1645-1646`) — do not invent a second bound or cadence for the review re-ask; it rides the same throttle wave 1's sibling plan's merge arm will also read. The re-ask itself is free: it rides the one `pr-list --rich --state open` call the delta pass already makes (`pr-refresh.ts:1654`), so a re-asked number adds no additional host request — this is why the plan's cost section does not count it separately.

**Why a re-ask matters here specifically.** A completed status write (the reviewer finishing and writing `success`/`failure`) does not move the PR's `updatedAt` on GitHub, so the normal `--since` delta would never notice it; the only way the index learns about the written status is by being told to ask this PR again regardless of its watermark. Without `reviewReaskPrNumbers` unioned in, a reviewed head's `pending`/`success`/`failure` would sit outside the index for up to `PR_FULL_READ_MS` (24h) — the exact defect Motivation point 5 measures.

### Done when

The plan's `## Done when` is its Slices entry for this branch (plan line 183) — read it as the spec:
- The fold adds `plotReview`, `plotReviewSha`, `plotReviewAt`, `ciChecks` to `PrIndexRow`, written by `pr-refresh.ts` on the GitHub rollup arm, under `PR_INDEX_VERSION` 6.
- `checks` is unchanged by this work — write a test asserting the existing `checks` fold behavior is untouched, not just that the new fields appear correctly. This is the assertion a naive implementation skips: it's easy to get the four new fields right while accidentally changing what feeds `checks`.
- `reviewReaskPrNumbers` exists as a domain unit with its own test file, and its union with `pendingOpenPrNumbers` is exercised in a fleet-level test showing a delta pass re-asks a green row with an absent review and that `pending` then `success` reach the store within one re-ask — this is the two-step scenario (first re-ask sees `pending`, second sees `success`) that proves the re-ask isn't a one-shot fluke.
- Domain unit tests on the fold use **executed rollups as fixtures**, not hand-built JSON — the plan is explicit about this (plan line 183: "the executed rollups as fixtures"), covering: CI pass with no review → `plotReview: absent`, `ciChecks: green`; a `pending` review → its `plotReviewAt` carried through; a `failure` review → `ciChecks` still reads `green` (proving CI-red and review-failure don't collapse into each other); review-only with no CI run → `ciChecks: none`.
- A `v5` file decodes to `null` under `v6` code (the existing store-version-mismatch behavior, exercised against this specific bump).
- The Jenkins arm carries no review field on any row (test against a Jenkins-shaped rollup response, confirming absence rather than a defaulted `absent`).

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves which tests and typechecks apply to the files this branch touches. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `test/reconcile/*.test.mjs`) run in CI on every PR; do not run them locally as a matter of course (`test:e2e` dispatches real workers into sandbox repos and is CI's gate, not a local one — see CLAUDE.md § Testing). List no full suite in your own PR description.

This branch touches `packages/domain/src/entities/pr-index.ts`, `packages/domain/src/rules/pr-index.ts`, and `packages/fleet/src/shared/pr-refresh.ts` (and the `plot-host.sh` jq extraction for the GitHub rollup arm) — no `.sh` file under `skills/` beyond that shell extraction should need touching, but if a push does touch one, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge-base line count: pay for growth by removing shell elsewhere in the same change, or move the logic into the domain and ask it through a bundle. The gate counts commands, not lines — joining statements with `;`/`&&` or folding `fi`/`done` onto the prior line is not a payment.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` directly. Once the PR exists, append `→ #<number>` to this branch's line under the "Indexed review state" heading in the plan's `## Slices` section (plan line 183), and set it to "Ready" on the project board if one is configured (none is configured on this repo's `## Plot Config` today, so this step is a no-op here).

### Scope guard

This branch owns: `packages/domain/src/entities/pr-index.ts` (schema + `PR_INDEX_VERSION`), `packages/domain/src/rules/pr-index.ts` (`reviewReaskPrNumbers`), `packages/fleet/src/shared/pr-refresh.ts` (the fold's write path for the four new fields and the re-ask union), and the GitHub-rollup jq extraction in `skills/plot/scripts/plot-host.sh` (around line 4798-4812).

Sibling branches in the same plan, not yet started, and what they hold — do not touch their territory:
- `feature/a-review-opens-no-issue` (merged, PR #2928) — `review.ts`'s `reviewIssue` and the findings comment. Already landed; nothing here depends on its code, only on the plan's overall Motivation framing.
- `feature/the-scope-is-read-from-git` — `sprintScope`, the git adapter reading the active sprint, `sprintFrom` moving into the domain. Independent of this wave.
- `feature/the-review-run-is-locked` — the `reviewPr` lock, run-id, and `Host.prReview` widening to carry a description/time. **Reads this wave's `plotReview`/`plotReviewSha`/`plotReviewAt` fields once they exist**, but builds no index code itself.
- `feature/fleetd-reviews-slice-prs` — `rules/slice-pr-next.ts`, `deskDead`, `startReview`. The consumer of this wave's fields in its review arm (plan lines 137, 143). Blocked on this branch merging.

If you find something the plan did not anticipate — e.g. the rollup's `plot/review` context name differs from what's assumed, or `checksSha` binding behaves differently than documented — report it rather than improvising outside scope.
