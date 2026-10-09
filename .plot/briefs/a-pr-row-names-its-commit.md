## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 1: PR rows name their commit)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/a-pr-row-names-its-commit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 1 of 8 and waits on nothing. Waves 2 and 3 read `headSha`, `headSince` and `mergedAt` from the rows this wave writes, so the field names and meanings below are the contract they build on. Wave 8 (the merge controller) is the only wave that waits on another plan.

### What to build

A PR row in the index records `checks: green` and no commit, so no reader can say which commit was green. Measured 2026-10-09: the #1444 merge watcher aborted twice when the head moved, and a temp script compared the head SHA by hand, because `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30`) holds `head` as the branch name and nothing else.

Four changes, in this order:

1. **Schema.** `PrIndexRowSchema` gains four optional fields: `headSha`, `headSince`, `checksSha`, `mergedAt`. `PR_INDEX_VERSION` moves from 3 to 4. A v3 store fails the literal parse and reads as "ask the host", as every mismatch does.
2. **Shell.** `plot-host.sh pr-list` requests `headRefOid` and `mergedAt` in its three GitHub calls (Jenkins arm near `:4103`, rollup arm near `:4136`, plain arm near `:4182`) and emits them. The Bitbucket arm emits its head commit (`.source.commit.hash`) and merge time where it has them. Offsets drift; grep for `--json number,title,state,headRefName`.
3. **Fold.** `storeRow` and `recordOf` in `packages/fleet/src/shared/pr-refresh.ts` (`:1052`, `:1081`) carry the fields. `PrRecord` (`:340-385`) gains them. Note the path: this code lives in `packages/fleet`, not `packages/domain`.
4. **Re-ask.** `PR_PENDING_REASK_LIMIT` (`:233`) stays the count bound for the first five re-asks on a refresh. After that the re-ask repeats every 5 minutes while any open, non-draft PR is `pending` or `failing` and its `headSince` is younger than `Checks wait` (3600 s, `plot-config.sh get "Checks wait"`). `pendingOpenPrNumbers` (`packages/domain/src/rules/pr-index.ts:292`) selects only `pending`; it also selects `failing` after this change.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Meaning per arm, and each arm states it in a comment next to its jq.**

| Arm | `headSha` | `checksSha` | `mergedAt` |
|---|---|---|---|
| GitHub rollup | `headRefOid` | equals `headSha` — `statusCheckRollup` belongs to the head commit | the host's `mergedAt` |
| Jenkins (GitHub PRs, Jenkins checks) | `headRefOid` | **absent** — the job colours are per branch and carry no commit; binding a build to a commit costs one Jenkins request per branch per refresh, out of scope | the host's `mergedAt` |
| Plain listing | `headRefOid` | **absent** — it reads no checks | the host's `mergedAt` |
| Bitbucket | `.source.commit.hash` if the listing carries it | absent | `.updated_on` only for a MERGED state if the endpoint gives no `merged_on`; otherwise absent |

For Bitbucket, check what the listing and `bb_state_listing` actually return before writing the arm, and record what it answers. The plan says "absent where it answers nothing". Do not invent a field the endpoint did not give.

**Absent is absent, never `''`.** The schema's own rule for `author`: `storeRow` guards each field with `typeof … === 'string' && !== ''` and omits it. The shell emits `(.headRefOid // "")`, as `updatedAt` does, and `storeRow` drops the empty string. A test with a row whose host omitted the field must round-trip without it. Writing `''` is the failure `an-unasked-host-is-not-an-absent-pr` exists to remove.

**`headSince` is the fold's clock, not the host's.** It is "when the fold first saw this `headSha`" — this machine's `Date.now()` ISO stamp, carried forward unchanged while `headSha` is unchanged, and reset when `headSha` moves. This differs from `updatedAt`, which is the host's clock and must never be `Date.now()`. A new PR or a row with no stored predecessor gets `headSince = now`. A row with no `headSha` gets no `headSince`. The first fold after v3 → v4 has no predecessor for any row, so every `headSince` starts at that fold's time; the bound is therefore conservative (it re-asks up to `Checks wait` longer than strictly needed), never short.

**The re-ask is bounded by time and covers red.** Today a completed check does not touch `updatedAt`, so a delta never sees it, and the re-ask stops after 5 consecutive no-progress answers — about 5 minutes. CI here runs up to 25 minutes (`validate`), so a result waits for the next full read, up to 24 h. `failing` is re-asked because a re-run can turn it green. The streak (`pr-refresh.ts:1508-1517`) must grow for `failing` as for `pending` while state and `headSha` are unchanged. Without that, a failing PR is re-asked on every refresh. That is the second mutation the Done-when names.

**The re-ask stays one rich listing per refresh for all such PRs** (`pr-refresh.ts:1478`, `['pr-list','--rich','--state','open']`). Do not make it per-PR. Cost ceiling from the plan: at most 12 GraphQL listings per hour while any PR is pending or failing, against 60 per hour for the refresh today.

**`mergedAt` is host-written and read in wave 3.** This wave only stores it. A MERGED row carries it; an OPEN row does not (gh answers null — emit nothing, not `''`).

**Rules carried from the index work, so they are not rediscovered by breaking them:**

- The index supplies `pr: 'MERGED'` and never `pr: 'none'`. A missing store, row, wrong version or unparseable file all mean ask the host (CLAUDE.md, *A Decision Reads The Index*).
- `fleet.ts` and `pr-refresh.ts` are the one writer; do not add a writer.
- `PrIndexRowSchema` is `.strict()` and has no `.default()` anywhere. Do not add one.
- Both shell consumers (`plot-impl-status.sh`, `plot-reconcile-scan.sh`) read through `board/plot-pr-index-lookup.mjs`, which calls `decodePrIndex`. They hold a `v` check inside the bundle, not in shell. After the version moves, a v3 file on disk makes them fall through to the host; that is correct, not a bug. Several fixtures write `v: 3` literally and need regenerating — see Done when.
- Write new functions as arrow functions (`export const f = (…) => …`), including helpers in tests. TSDoc states what an export does and returns; reasoning goes in the commit message and the plan.

### Done when

The plan's wave line is the specification: a fold over a fixture with a rollup row, a Jenkins row and a plain row stores the three meanings and a merged row's `mergedAt`, and a re-ask test fails with the count bound restored and with a failing PR re-asked on every refresh.

The assertions that exist because a naive implementation would pass without them:

- **Rollup row:** `headSha === checksSha`, both the fixture's SHA. Catches a mapping that fills `checksSha` from nothing or from the wrong field.
- **Jenkins row:** `headSha` present and `checksSha` **undefined** (`'checksSha' in row` is false). Catches a mapping that copies `headSha` into `checksSha` for every arm, which would claim a Jenkins colour is bound to a commit.
- **Plain row:** `headSha` present, `checksSha` absent, `checks` untouched.
- **Merged row:** `mergedAt` equals the host's string byte-for-byte.
- **Host omitted the field:** no `''` in the stored row. Catches the `?? ''` shortcut.
- **`headSince` carried:** the same `headSha` across two folds keeps the first fold's `headSince`; a changed `headSha` resets it. Catches a fold that rewrites `headSince` every refresh and so never lets the time bound expire.
- **Version:** a store file with `v: 3` fails `decodePrIndex` and a v4 file round-trips. Existing fixtures that hard-code `v: 3` are updated to import or follow `PR_INDEX_VERSION` where they can: `test/reconcile/impl-status-index.test.mjs`, `test/reconcile/scan-index.test.mjs`, `packages/board/test/unit/deliverability.test.ts`, `packages/domain/test/merged-row.test.ts`, `packages/fleet/test/unit/registryd-main.test.ts`. A fixture that stays at 3 must say why. This is the *a-version-default-hides-stale-store-fixtures* trap in memory.
- **Re-ask bound (mutation 1):** with `PR_PENDING_REASK_LIMIT` restored as the only bound, a pending PR whose `headSince` is younger than `Checks wait` is still re-asked on the sixth refresh. The new test fails against the old code. Prove it: run it against `main`'s `pr-refresh.ts` in a pristine worktree and read the failure.
- **Re-ask bound (mutation 2):** a `failing` PR with unchanged state and `headSha` is not re-asked on every refresh — its streak grows. Make the test fail when the `failing` streak branch is removed.
- **Time bound ends:** a PR whose `headSince` is older than `Checks wait` is not re-asked after the five-count is spent.
- **Cadence:** after the five re-asks the next re-ask is no sooner than 5 minutes later. Use an injected clock; do not sleep.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally.

**Shell-line gate.** This slice touches `plot-host.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base — non-comment, non-blank lines. The new `headRefOid` and `mergedAt` fields add lines to the jq programs, and that growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Measure with `scripts/check-shell-lines.sh --per-file` before and after; the plan's table row 1 says "with an equal shell-line removal". Prefer folding the three GitHub arms' repeated field lists together over deleting a comment (comments are not counted).

**Other gates:**

- A changeset in `.changeset/` for package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- `pnpm build:board` only to test locally; restore the generated bundle paths from the merge base before you push (`scripts/check-no-bundle-diff.sh`). Never commit a rebuild of `board-server.mjs` or `plot-*.mjs` bundles.
- `packages/fleet`: `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .` — the root `pnpm run typecheck` skips it.
- `packages/domain`: `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`.
- `skills/plot/scripts/README.md` has a row per script; add nothing there unless a script is new (none should be).
- Board tests: do not run them while the operator's board is open, and wait for spawned processes by exit.
- Node 24 (`nvm use`). Install dependencies if `node_modules` is missing.

### Bookkeeping

When the PR opens, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`; none is configured in this repo.

Push the first real commit as soon as it exists. Use `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.

### Scope guard

This branch owns:

- `packages/domain/src/entities/pr-index.ts` and `packages/domain/src/rules/pr-index.ts` (schema, version, `pendingOpenPrNumbers`)
- `packages/fleet/src/shared/pr-refresh.ts` (`PrRecord`, `storeRow`, `recordOf`, the re-ask and its streak)
- the `pr-list` arms of `skills/plot/scripts/plot-host.sh`
- tests and fixtures that name the store version

It does not own, and must not touch:

- `BuildPort`, `runsForSha`, `foldRuns`, `DefaultBranchReading` — wave 2.
- `startChannel`, `IndexMonitor`, `MonitorNameSchema`, `FindingNameSchema`, `rules/attention.ts` — wave 3.
- the Desk port and `board/src/server/findings.ts` — wave 4.
- `checksVerdict`, `PlanCard.tsx`, `StatusPanel.tsx`, `/api/board` payload fields — wave 6. `headSha` and `checksSha` do not reach the payload in this wave.
- `pr-state` and `pr-merge` in `plot-host.sh` — wave 8.

Waves 2–8 each hold one branch; none are open yet (verified at brief time: `git ls-remote --heads origin` shows no ref for this branch, and the plan lists no `→ #` PR). A collision is possible only on `plot-host.sh` and `pr-refresh.ts` with wave 2 (`runs-for-sha` verb, cadence) — wave 2 waits until this wave merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
