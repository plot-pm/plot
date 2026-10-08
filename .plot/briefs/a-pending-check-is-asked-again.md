## Implementation brief — the-board-reads-a-pr-while-its-ci-runs (wave 2: Pending checks are asked again)

- **Plan (canonical):** `docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-pending-check-is-asked-again` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 2 of 3. Wave 1 (`bug/a-pending-check-outranks-mergeability`, #1352) merged 2026-10-08. Wave 3 (`bug/a-pr-fetch-older-than-the-branch-reads-unknown`) waits on this one.

### What to build

The delta refresh in `refreshPrs` (`packages/board/src/server/fleet.ts`, window at `prWindowFor(...)`, call at `pr-list ... --since`) also asks the host about every open PR whose stored `checks` are `pending`, so a finished check becomes terminal within one refresh instead of at the next full read.

The failure this fixes (#1277): a check run that completes does not change a PR's `updatedAt`, so `--since` never returns the PR. The stored `pending` stays until `PR_FULL_READ_MS` (24 h, `fleet.ts:317`). Measured 2026-10-05 on #1271: green at 07:08Z, still "CI running" at 07:31Z. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The window cannot carry this.** The delta is keyed on `updatedAt`, and a completing check does not move it. Widening or shortening `--since` does not help. The re-ask is a second population, chosen by the store's own `pending` rows.

**The population comes from the store, as a value.** `prWindowFor` (`packages/domain/src/rules/pr-index.ts:355`) takes readings and returns a window. The pending numbers are another reading of the same held `PrIndex`. Put the selection in the domain (a rule over the held rows: open, `checks === 'pending'`, by number) and hand it to the caller. `fleet.ts` must not decide which rows count (`CLAUDE.md`, *The Layering Rule*; arrow functions in `packages/domain`).

**`pending` is non-terminal and stays so.** *A Decision Reads The Index* keeps `OPEN`, draft and `pending` rows as stale-in-either-direction. Do not teach the store to treat `pending` as terminal. The re-ask is the only way the row becomes terminal.

**Merge the answers, do not replace.** The re-asked rows go through the same fold as delta rows (`foldPrIndex`; `fleet.ts` is its only caller). A re-ask answer that fails or omits a PR keeps the held row. Absent is not green.

**Cost: one question.** `PR_REQUESTS_PER_REFRESH` (`fleet.ts:208`) counts host questions. The plan says the extra numbers go into the same `pr-list` question where the adapter allows it, and that any second question is counted. Do not leave the count at 1 if you add a second `hostSaid` call.

### Open question the slice must close first

The plan asks whether `pr-list` accepts a set of numbers. Measured on `main`: `grep -n -- '--number\|--numbers' skills/plot/scripts/plot-host.sh` returns nothing, and `pr-list`'s documented flags (`plot-host.sh:74`) are `--state`, `--limit`, `--rich`/`--rich-open`, `--since`, `--branch`. So today it does not. Probe `gh pr list --search` with several `number` qualifiers before choosing, and record the answer and its request cost in the PR description. If the adapter needs one `pr-view` per pending PR, count that in `PR_REQUESTS_PER_REFRESH` and bound it. Bitbucket answers no verdict (`unknown` whatever the state), so a re-ask there buys nothing. Skip it for that backend.

### Done when

The plan's `## Done when` list is the specification. The assertion that exists because a naive implementation passes without it:

- A stored PR with `pending` checks and an **unchanged `updatedAt`** is asked again and reads `green` after one refresh. A test whose fixture moves `updatedAt` passes against `main` and proves nothing.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. A changeset with the description first and `bumps:` last. `scripts/check-shell-lines.sh` refuses growth in shipped shell: if the adapter change touches `plot-host.sh`, remove shell elsewhere in the same change or write the rule in the domain.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: the pending-check selection rule in `packages/domain/src/rules/` and its test, the delta call in `fleet.ts`, `PR_REQUESTS_PER_REFRESH` if the question count changes, the `pr-list` arm of `plot-host.sh` only if the probe shows it must change.

Not owned: `prRowPlacement` and `classifyGroup` (wave 1, merged), `rules/quiet.ts` and the `claimedReadings`/`wipReadings` PR-fetch age reading (wave 3).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
