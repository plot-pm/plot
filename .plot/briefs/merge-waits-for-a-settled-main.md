## Implementation brief — fleetd-merges-slice-prs-one-at (wave 1: Settled main guard)

- **Plan (canonical):** `docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md` on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2914 merged
- **Branch:** `feature/merge-waits-for-a-settled-main` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `feature/fleetd-merges-one-at-a-time`, waits on this branch and on `feature/fleetd-reviews-slice-prs` (#2900). This branch needs neither #2900 nor #2898: it builds only the controller guards, and `slicePrNext` does not exist on `main` yet.

### What to build

`mergeAt` (`packages/board/src/server/entry/merge.ts:48-75`) is the only merge controller, and its one caller is the `merge` arm of `plot-ask.mjs` (`entry/main.ts:151-176`). `@plot-pm/fleet` depends only on `@plot-pm/domain` and `zod`, so fleetd cannot call it. This branch moves `mergeAt` into `packages/domain` as a workflow over the `Host`, `Scripts`, `DefaultBranchStore` and `Refs` ports, and makes `merge()` (`packages/domain/src/workflows/merge.ts`) enforce the two checks it lacks. Round 1 of the panel probed `merge()` and saw it decide *merge* on a head that is `pending` past a green settled commit (live on this machine: head `5163dbee` pending, settled `88ab8e4b`), on a reading that still names the pre-merge head, and on no reading at all.

- `MergeReadings` gains `defaultBranchTip`, read fresh through `Refs.remoteSha(<default branch>)` (`ports/refs.ts:786`, `git ls-remote`, no host API budget). `merge()` refuses `default-branch-unsettled` unless the tip equals the reading's `headSha` AND the reading's `settled.sha` equals that tip. A failed tip read (`unknown` or a failed `PortResult`) refuses as `unaskable`.
- `MergeReadings` gains `review`, re-asked through `Host.prReview` (`ports/host.ts:408`, `PrReviewReading { sha, state, bypass }`). `merge()` refuses `review-not-passed` unless `state` is `success` on the pinned head. `absent`, `failure`, `pending`, a `sha` that differs from the pinned head, and a failed read all refuse. A failed read is never a pass.
- `MergeInput` gains `requireReading`. With it set, a `null` default-branch reading refuses as `default-branch-unread`. Without it, today's rule stands: a missing reading holds nothing (`merge.ts:121`).
- Add `default-branch-unsettled`, `review-not-passed` and `default-branch-unread` to `MergeRefusal`.
- `mergeAt` moves to `packages/domain/src/workflows/` and takes `Refs` in its ports. `plot-ask.mjs merge` keeps its arguments, output JSON and exit codes, and passes a `Refs` from the real estate; it does NOT set `requireReading`. `canPinMerge` (`board/src/server/entry/host-pin.ts`) is also imported by `approve.ts:1070`, so move it with `mergeAt` and let `approve.ts` import it from the domain rather than keeping two copies.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The tip is read at the controller, not taken from the reading.** The reading is written on the PR beat, every twelfth 5 s beat, while the merge runs on every scan beat, so about eleven scans after a merge the file still names the old head as settled green. A reading-only check answers *merge* for the next PR. `Refs.remoteSha` costs `git ls-remote` and no API budget, and it also catches a merge by a person, a direct push, the changesets bot and an auto-merge, because every merge path moves the tip.

**`defaultBranchRed` is not the merge's stale rule.** `defaultBranchRed` reads a stale red as not red and lifts the dispatch hold (`rules/default-branch.ts:262-270`); `merge()` refuses any stale reading as `default-branch-stale` (`merge.ts:121-126`). Keep `merge()`'s own arm. Do not call `defaultBranchRed` from it.

**The checks rollup is not the review.** An absent `plot/review` status is missing from the rollup, which can still fold green, so `merge()` must read `Host.prReview` and never `pr.checks` for this. The index is not a substitute: `mergeAt` re-asks the host, as it does today for `prState`.

**`requireReading` is opt-in because `null` is overloaded.** `decodeDefaultBranch` also answers `null` for a version it does not know (`entities/default-branch.ts:85-95`), so a person's `plot-ask.mjs merge` must keep holding nothing on a missing reading. fleetd (wave 2) sets it.

**No new spawn site.** The write still goes through `scripts.hostSaid`. CI's *One place reaches a process* ratchet (`allowed=28`) must not grow, and the domain purity gate allows only `zod` outside `adapters/`.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; that goes in the commit message and the plan. A moved function stays an arrow.
- Absent is not false: a failed read refuses as `unaskable`, never as a pass and never as a hold-nothing.
- A refusal ends the action; nothing retries with the pin dropped.
- Move the existing `merge-entry.test.ts` cases with `mergeAt` and keep them passing unchanged in meaning.

### Done when

The plan's `## Slices` entry for this branch is the specification: `mergeAt` in the domain; `merge()` refuses `default-branch-unsettled` and `review-not-passed`; `requireReading` holds a merge on a missing reading; domain unit tests for each refusal. The assertions that exist because a naive implementation would pass without them:

- **Pending head past a green settled commit** (head `pending`, `settled.sha` older, tip equal to `headSha`) refuses `default-branch-unsettled`. Catches a check that reads only `settled.state`.
- **Reading on the pre-merge head** (tip moved, reading's `headSha` and `settled.sha` still the old one) refuses `default-branch-unsettled`. Catches a check that compares the reading with itself.
- **`null` reading with `requireReading`** refuses `default-branch-unread`; without it the same input merges. Catches a flag that is ignored or always on.
- **`plot/review` `success` on a different sha than the pinned head** refuses `review-not-passed`, as do `absent`, `failure`, `pending` and a failed `prReview` read. Catches a state check that ignores the sha.
- **A failed `Refs.remoteSha` read** refuses `unaskable`, not `default-branch-unsettled` and not a pass.
- **Green checks rollup plus absent `plot/review`** refuses. Catches reading the rollup instead of the review.
- `plot-ask.mjs merge` output and exit code unchanged for a passing merge and for `host-refused`.

Plus: this moves a board import, so the board artifact rebuilds — run `pnpm build:board` only to test locally and never commit the generated bundle (`scripts/check-no-bundle-diff.sh`). Add a changeset (description first, `bumps:` block last, package `@plot-pm/board` or `plot`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to pay for; if that changes, remove an equal number of shell lines in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` — never `gh pr create` — and append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/workflows/merge.ts` and the moved `mergeAt` beside it, `packages/domain/test/workflows-merge.test.ts`, the moved `host-pin.ts`, and in `packages/board`: `src/server/entry/{merge,main,approve}.ts` and `test/unit/{merge-entry,ask-merge-*,merge-reads-the-estates-default-branch}.test.ts`.

In flight and verified at dispatch: #2919 `feature/role-agents-are-probed` is the only open implementation PR, and it touches none of these files. Plan PRs #2909–#2916 (the rest of the story) add no code. `slicePrNext`, `plotReview` and `plotReviewSha` do not exist on `main`: do not add them, they belong to #2900. The unattended refusal on `merge` belongs to #2898, and the repair-PR exception to #2904 — touch neither.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
