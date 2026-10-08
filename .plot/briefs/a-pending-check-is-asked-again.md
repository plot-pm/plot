## Implementation brief — the-board-reads-a-pr-while-its-ci-runs (wave 2: Pending checks are asked again)

- **Plan (canonical):** `docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-pending-check-is-asked-again` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 2 of 3. Wave 1 (`bug/a-pending-check-outranks-mergeability`) merged as #1352. Wave 3 (`bug/a-pr-fetch-older-than-the-branch-reads-unknown`) waits on this one.

### What to build

The delta refresh asks the host again for the open PRs whose stored `checks` are `pending`, so a PR whose CI finished reads `green` (or `failing`) within one refresh instead of at the next full read.

The failure this fixes (#1277), measured 2026-10-05 on #1271: green at 07:08Z, still "CI running" at 07:31Z. The cause is the window. `refreshPrs` appends `--since <watermark>` (`packages/board/src/server/fleet.ts:3092-3094`), and GitHub's `updated:>` search matches a PR's `updatedAt`. A check run that completes does not change `updatedAt`, so the delta never returns the PR. The stored `pending` is never replaced until `PR_FULL_READ_MS` (24 h, `fleet.ts:317`) falls due.

Two parts, in this order:

1. **A domain rule names the numbers to ask again.** A pure function over the held store, in `packages/domain/src/rules/pr-index.ts` beside `prWindowFor`: it returns the numbers of the rows whose `state` is `OPEN` and whose `checks` is `pending`. It takes the `PrIndex` as a value and reaches nothing.
2. **`refreshPrs` asks about them in the delta.** `window` (`fleet.ts:3065`) and the `args` block (`:3092`) are where the question is built. The rows that come back fold through the same `writePrStore` call (`:3239`), and the fold already lets an `OPEN` row's own answer replace the held one (`withHeldVerdicts` returns an `OPEN` row unchanged). No fold change is needed.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Only `pending` is re-asked, and only for `OPEN` rows.** `pending` is the one non-terminal answer; `green`, `failing`, `none` and `unknown` are asked again by the next `updatedAt` change or the full read, as today. A `MERGED` or `CLOSED` row is terminal (`A Decision Reads The Index`: "A `MERGED` row cannot revert"), and re-asking it spends budget on a head nobody can act on. Test both: a stored `green` open PR and a stored `pending` merged PR are not asked.

**The open question is yours to answer first, with a measurement.** The plan asks: does `pr-list` accept a set of numbers? Read on `main` 2026-10-08: it does not. `plot-host.sh`'s `pr-list` parses `--state --limit --rich --rich-open --repo --since --branch` and `die`s on anything else (`:3822-3862`). GitHub's `--search` ANDs its terms, so there is no `number:1 OR number:2`. That leaves two shapes, and the choice decides the request cost:

- **A. Add `--number` to the adapter.** On GitHub this is one `pr view` per pending PR, so it breaks "one question per refresh". It also grows `plot-host.sh`, and `scripts/check-shell-lines.sh` refuses growth that is not paid for in the same change.
- **B. Re-ask every open PR when any stored open PR is `pending`.** One more `pr-list --rich --state open` with no `--since`. The adapter already answers it (`--rich --state open` measured 2.6–3.3 s on 2026-10-02 with 3 open PRs), and no shell changes. The cost scales with the open-PR count, which is small by nature.

Recommendation: B, unless a probe on this repository shows A cheaper. Run the probe (`plot-host.sh pr-list --rich --state open`, time it, count rows) and put the numbers in the PR description. If you take B, the numbers from part 1 still decide WHETHER to ask; the answer's rows are filtered or folded as they come. If you take A, say how you paid for the shell lines.

**`PR_REQUESTS_PER_REFRESH` counts a second question.** The table at `fleet.ts:208` is a constant per backend, and the comment at `:239` says a delta "changed what each request costs and not how many are made". A second `pr-list` in a pass changes the second half of that sentence. Count it where it happens: a refresh that re-asks costs the backend's number plus one `pr-list` (GitHub: 2, Bitbucket: 4 + 3 or the sweep's figure). Under-declaring is the failure that table's header exists to prevent (the ~1400 requests and the account-wide `HTTP 429` it records). Decide whether the cost is spent per refresh or only on refreshes that re-ask, and say which in the PR.

**A PR stuck `pending` is asked every refresh until it moves.** A queued check that never runs keeps the stored row `pending` and the re-ask repeats at the 60 s cadence. A naive implementation passes every test the plan lists and still hammers the host. Bound it and test the bound — for example, stop re-asking a row whose re-ask returned `pending` N times with the same `updatedAt`, or ask at a slower cadence than the delta. Report the bound you chose; the plan is silent, so this is a decision to record, not to improvise past.

**The watermark must not move backwards.** A re-asked PR carries an old `updatedAt`. `foldPrIndex` takes `watermarkOf(merged)` (`pr-index.ts:173`), the newest over the merged rows, so a re-ask cannot lower it. Keep it that way, and assert it: the next delta's `--since` must equal the one before the re-ask.

**`kind` stays `delta`.** `answerKind(window, partialSaid)` describes the call's window, and a re-ask is not a full read. It must not mark the store partial (that is the 43 s every-second-refresh defect the comment at `fleet.ts:3200` records) and must not move `wholeAt`.

**Rules carried over unchanged.** An absent answer is not a false one: a row with no `checks` is not `pending` and not `green`, and the rule never reads it as either. A failed re-ask keeps the last good map and takes the same backoff path as a failed delta (the catch at `fleet.ts:3280`); it must not clear the stored `pending`, and it must not be recorded as a failed FULL read.

### Done when

The plan's `## Done when` list is the specification. The items that exist because a naive implementation would pass without them:

- **The test's fixture must make the arms disagree.** The plan's item says "a stored PR with `pending` checks and an unchanged `updatedAt` is asked again, and its checks read `green` after one refresh". Build the host double so it returns the PR ONLY when asked for it again and returns nothing for the plain `--since` window. A double that returns the PR for any call passes on `origin/main` and proves nothing. Run the test on `origin/main` first and keep the failing output.
- A stored `green` open PR, and a stored `pending` merged PR, are not asked again. It catches a rule that re-asks everything non-terminal, or everything pending.
- A PR still `pending` after the re-ask stays `pending`, keeps its watermark, and the next delta's `--since` is unchanged. It catches a fold that drops the row or moves the window.
- A failed re-ask leaves the stored `pending` in place and does not record a failed full read.
- The bound on a PR stuck `pending` has a test of its own.
- The domain rule has a unit test with no browser and no server. Per `CLAUDE.md`, a decision that needs a rendered board to assert is a rule not yet extracted.

Plus: a changeset for `@plot-pm/board` (`patch`), description first and the `bumps:` block last, with `plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md`. Do not edit versions by hand. `packages/domain` is arrow-function code; a new helper you write in `fleet.ts` is an arrow too. Do not commit `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Close the board before `pnpm test:board` and run under Node 24 (`nvm use`).

If the slice touches a `.sh` file (shape A), `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Shape B touches no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), not `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Answer the plan's Open Question in the plan itself (tick it and state the shape taken) in the same PR.

### Scope guard

This branch owns:

- `packages/domain/src/rules/pr-index.ts` (the new rule), its export in `packages/domain/src/index.ts`, and its test beside the other rule tests in `packages/domain/test/`.
- In `packages/board/src/server/fleet.ts`: the `window`/`args` region of `refreshPrs` (`:3065-3094`), the write that follows it (`:3239`), and `PR_REQUESTS_PER_REFRESH` with its comment (`:208`). Nothing else in the file.
- `packages/board/test/unit/pr-store.test.ts` and its neighbours (`fleet-pr-store-repo.test.ts`, `pr-concurrency.test.ts`) where they assert the delta.
- `skills/plot/scripts/plot-host.sh` only if you take shape A.
- The changeset, and the plan's Open Questions line.

Not this branch's:

- `prRowPlacement`, `classifyGroup`, `prState` and the PR row's group: merged in #1352. Do not reopen them.
- `bug/a-pr-fetch-older-than-the-branch-reads-unknown` owns `rules/quiet.ts`, `claimedReadings`/`wipReadings` (`fleet.ts:5610-5640`) and `hostUnasked`. Do not touch them.

That branch is unstarted at dispatch (`git ls-remote --heads origin` for both slice-2 and slice-3 names returned nothing on 2026-10-08), so a collision is possible only in `fleet.ts`, in different regions.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
