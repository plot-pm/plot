## Implementation brief — a-pr-refresh-reads-the-history-once-a-day (slice 2: The full read asks verdicts of open PRs only)

- **Plan (canonical):** `docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-full-read-asks-verdicts-of-open-prs-only` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; issue #1087

Slice 2 of 3. It waited on `bug/a-delta-keeps-the-store-whole`, which merged as #1180 (merge commit `884fe152c`), so `PrIndexUpdate.kind`, `PrIndex.wholeAt`, `answerKind` and `PR_INDEX_VERSION` 3 are on `main` and this branch builds on them. `bug/a-host-timeout-names-no-login` is independent and touches only `plot-host.sh`'s failure kinds.

### What to build

Slice 1 made the board's full PR read happen once per 24 h. It did not shorten that read. Measured 2026-10-01 on this repository, through `plot-host.sh pr-list` in the board's own argument order:

| Call | Time | Rows |
|---|---|---|
| `--rich --state all --limit 1000` (the full read) | 43.0 s | 1000 |
| `--state all --limit 1000` (no `--rich`) | 7.3 s | 1000 |
| `--rich --state all --limit 100` | 3.4 s | 100 |

The `--rich` fields cost about 36 s of the 43. They are verdicts about a PR's head: `checks`, `mergeable`, `review`, `failing_checks`. For a `MERGED` or `CLOSED` row they cannot change, and all 1000 rows in the measured read were terminal (964 `MERGED`, 36 `CLOSED`, 0 `OPEN`). The full read pays 36 s for answers that nobody can use.

Build the split in two halves, in this order:

- **The adapter: `pr-list --rich-open`.** A new flag on the existing op in `skills/plot/scripts/plot-host.sh` (flag parsing near `:3727`). On GitHub the GitHub arm makes two calls: `--state open` with the rich fields, and `--state all` with the plain fields. The board still makes one `pr-list` call per refresh, so `PR_REQUESTS_PER_REFRESH` (`fleet.ts:202-246`) needs no new arithmetic. On Bitbucket `--rich-open` answers exactly as `--rich` does, because that arm asks no verdict of the host.
- **The terminal rows the plain call produces.** A terminal row must carry every field a rich row carries (`packages/domain/src/entities/pr-index.ts:38-42`). `draft` comes from `isDraft`, and `url` and `updatedAt` come from the `--json` field list, which the plain GitHub arm lacks today (`plot-host.sh:3945`). The verdict fields take the absent values the Bitbucket arm already emits: `checks: "unknown"`, `mergeable: "unknown"`, `review: ""`, `failing_checks: []`. The schema accepts these, so **no second `PR_INDEX_VERSION` bump follows**.
- **The domain: `foldPrIndex` carries held verdicts.** In `packages/domain/src/rules/pr-index.ts:146`, an incoming `MERGED` or `CLOSED` row whose verdict fields hold the absent values takes `checks`, `mergeable`, `review` and `failing_checks` from the held row with the same number. A terminal row with no held row keeps the absent values. An `OPEN` row never takes held verdicts. Only the fold reads `held`, so the rule lives there and nowhere else.
- **`refreshPrs` passes `--rich-open` on the full read.** `fleet.ts:2926` builds `['pr-list', '--rich', '--state', 'all', '--limit', …]` and appends `--since` only where `window.since !== null`. Replace `--rich` with `--rich-open` **only when there is no window**. The delta keeps `--rich`: it answered 0 rows in 0.8 s, and a delta row that changed is exactly the row whose verdicts are worth asking.
- **One answer from two calls.** The answer is `whole` only when both calls answered. When either call fails, `pr-list` prints no rows and exits non-zero, so `refreshPrs` throws into its existing catch and the store is untouched.

### The decisions the plan settles — do not re-derive them

**The split lives in two places, and each half is needed.** The adapter cannot decide which verdicts to keep, because it holds no store: a plain row has absent verdicts and the adapter cannot tell whether the board already holds real ones. The domain cannot make the cheap call, because it reaches no host. Taking only the adapter half would overwrite every held `MERGED` row's verdicts with `unknown` on the next full read.

**One flag on `pr-list`, no new op and no new script.** `scripts/check-host-cli-callers.sh` and the layering rule keep every host call inside `plot-host.sh`. A second script that listed PRs would be a second caller of the host CLI.

**Not a smaller page.** `gh pr list` pages internally and has no page-size flag. 100 rich rows took 3.4 s and 1000 took 43.0 s, so the cost is per row and a page size cannot be tuned. `PR_LIMIT` stays 1000: the truncation at 1000 is #333's and is reported already.

**Not a retry on a 504.** A retry doubles the cost of a request that already ran too long. Slice 1's fallback already answers a delta after a failed full read.

**The delta window and slice 1's rules are not touched.** `prWindowFor`, `answerKind`, `wholeAt` and the one-hour failed-full-read fallback are slice 1's and are on `main`. This branch changes what the full read asks, not when it is made.

**Rules carried over from slice 1 and the PR-index work:**

- **Absent is not false.** A terminal row's `checks: "unknown"` means *not asked*, never *no checks*. The held row's real value wins in the fold, and a row with no held counterpart reads as unavailable.
- **The store never says no.** A failed call writes nothing. Do not write a partial store to make a failure look like progress.
- **Serve the map by answer kind.** `fleet.ts:3039` tests `kind === 'whole'`, never the folded store's `complete`.
- **Read the exit code, not the emptiness.** A failing open call and a failing all call each exit non-zero and print no rows. An empty open list from a healthy call is a valid answer (the store measured 0 `OPEN`).

### Open Points the plan hands to this slice

1. **Name which readers can receive a terminal row, and assert each renders `checks: "unknown"` as unavailable.** The plan lists `prsByHead` (`fleet.ts:2946`, read at `fleet.ts:6506`) and `pr.checks` at `fleet.ts:2233`, `:4572` and `:5555`. Line numbers moved with slice 1; grep again. A first reading from `origin/main` at `d61aa4e31`: `prsByHead` holds every state for the branch link only, and at `fleet.ts:6647` a `held` row feeds `linked` while `classify` receives the open-only `pr`. The `pr.checks` reads at `:2266`, `:4635`, `:5618` and `:5744` take `pr` from the open map. Verify this, name each reader in the PR body, and write the assertion for any that a terminal row can reach.
2. **No measurement of `--state open --rich` with open PRs present** — the store showed 0 `OPEN`. The issue measured 2.5 s for it on 2026-09-30. Take the measurement while at least one PR is open, and put it in the PR body.

### Done when

The plan's `## Done when` list is the specification, and the lines this slice owns are:

- The full read on this repository takes at most 15 s over at least three runs, and spends fewer GraphQL points than the old full read.
- On GitHub, while the host answers, `prAgeSeconds` stays at or below 120 s for one hour on a running board, including the refresh that makes the full read.

The tests the plan names:

- **`packages/domain/test/pr-index.test.ts`:** a `MERGED` row with absent verdicts keeps the held row's `checks`, `mergeable`, `review` and `failing_checks`; a terminal row with no held row keeps the absent values; an `OPEN` row never takes held verdicts.
- **`packages/board/test/unit/pr-store.test.ts`:** a full read sends one `pr-list --rich-open` call; a non-zero exit from it leaves the store untouched. A delta call still sends `--rich` with `--since`.
- **`test/reconcile/host.test.mjs`:** on GitHub `--rich-open` sends `--state open` with the rich fields and `--state all` with the plain fields, and each terminal row carries `draft`, `url`, `updatedAt`, `checks: "unknown"`, `mergeable: "unknown"`, `review: ""` and `failing_checks: []`; a failing open call and a failing all call each exit non-zero and print no rows; on Bitbucket `--rich-open` emits the same rows as `--rich`.

Assertions that exist because a naive implementation would pass without them:

- **A held `MERGED` row keeps its verdicts across a full read.** Without it, the adapter half alone passes every adapter test and silently erases every held verdict on the next whole fold.
- **An `OPEN` row from the plain call never takes held verdicts.** The open call is the rich one, so a plain `OPEN` row means the two calls disagreed about the same PR. Carrying stale verdicts onto it would show a green check on a PR whose head moved.
- **A failed `--state all` call leaves the store byte-identical.** A fixture where the open call succeeds and the all call fails catches an implementation that prints the open rows and exits 0.
- **The delta still sends `--rich`.** A test that checks only the full read passes if the flag change leaks into the delta, which would drop verdicts for every changed PR.

Two measurements go in the PR body, and the plan treats them as part of done:

- At least three runs each of the old full read and the new one on this repository, with the time and the GraphQL `used` delta from `gh api rate_limit` for each run.
- `prAgeSeconds` from `/api/board`, sampled every 10 s for one hour on a running board with both slices built, and the largest value seen. The hour holds at least one full read, forced by aging `wholeAt`.

Plus the repo's gates, on Node 24 (`nvm use`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do **not** run `pnpm run test:e2e` locally.

- `pnpm build:board` and commit the rebuilt bundles that change; CI's no-diff gate fails a stale one. `plot-host.sh` is not a bundle, but `foldPrIndex` is embedded in `board-server.mjs` and `plot-pr-index-lookup.mjs`.
- A changeset: description first, `bumps:` block last, `plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md` in the block. Package `@plot-pm/board` for the board and domain change, `'plot': patch` with a `plot` skill bump for the `plot-host.sh` change. Run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` inside this slice's heading in the plan's `## Slices`. The heading carries a `<!-- waits: … -->` annotation, so keep it and add the PR to the parenthesis: `(Branch: bug/the-full-read-asks-verdicts-of-open-prs-only, PR: #N)`. A trailing `→ #N` does not parse for a heading-annotated slice.
- Name `Issue: #1087` in the PR body. Do not close #1087: slice 3 remains.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` — the `pr-list` flag parsing and the GitHub arm only; not the failure kinds near `:474-564`, which are slice 3's
- `packages/domain/src/rules/pr-index.ts` and `packages/domain/test/pr-index.test.ts` — `foldPrIndex` and its tests
- `packages/board/src/server/fleet.ts` — the `args` line in `refreshPrs` only, plus any reader named under Open Point 1
- `packages/board/test/unit/pr-store.test.ts` and `test/reconcile/host.test.mjs`
- the rebuilt bundles under `skills/plot/scripts/board/`

In flight, read at dispatch from `origin/main` on 2026-10-02: `bug/a-host-timeout-names-no-login` has no ref yet, and slice 3 will touch `plot-host.sh` near `:474-564`, away from this branch's lines. The generated bundles conflict with any sibling branch that rebuilds them. They are `-merge` in `.gitattributes`: take either side, run `pnpm build:board`, commit the result. Re-check every remote branch's diff from its merge base before opening the PR; this list names what was true at write time.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
