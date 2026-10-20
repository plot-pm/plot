## Implementation brief — bitbucket-jenkins-pr-list-rows-past (wave 1: Unbound rows)

- **Plan (canonical):** `docs/plans/2026-10-20-bitbucket-jenkins-pr-list-rows-past.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2157 merged
- **Branch:** `bug/bitbucket-jenkins-pr-list-rows-past` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Nothing waits on it and it waits on nothing; the two plans it follows (#2053, #2075) are delivered.

### What to build

`plot-host.sh pr-list --state open --rich` on Bitbucket with `CI: jenkins` binds the checks of at most `SHA_LOOKUPS_PER_PASS = 5` rows to their head (`packages/domain/src/rules/jenkins-pr-checks.ts:38`) and leaves every other row on the branch colour. Measured 2026-10-20 on ewz-kus-portal: 11 rows, 7.5 s, 5 rows with `checksSha == headSha`, 4 rows (PRs 3509, 3094, 3237, 3210) reading `green` or `failing` with `checksSha: ""`. A branch colour names no commit, so after a push it is the previous head's result, and the board shows it as the head's.

The change: a row whose checks are not bound to its head does not read `green` or `failing`. The mechanism sits in the `jq` projection at `plot-host.sh:~4264-4285` (`checks:(if $jstatus != "ok" then "unknown" elif $eff == null then "none" else $eff.checks end)`), where `$eff` falls back to `$jmap[.headRefName]` when `$shamap` has no entry for the row. `rowsToBind` (`:57-75`) already knows which rows it dropped; `packages/board/src/server/entry/jenkins-pr-checks.ts:89` feeds it from the `rows` verb. The plan's `Design` section leaves the choice open (Option A: an honest word for a dropped row; Option B: a higher cap; or both). The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Option B alone does not meet the target.** A cap, at any number, leaves rows unbound on a repository with more open PRs than the cap. The first bullet of the plan's Approach holds whatever number is chosen, so a raised cap is an addition to an honest word, never a replacement.

**Measure the lookup cost before choosing a cap.** The 11-row run took 7.5 s with 5 lookups, so a lookup is not free. The repo rule is measure before implementing an optimisation (`measure-before-implementing-a-plot-optimisation`). Measure against a real Jenkins, report the per-lookup figure in the PR, and do not raise `SHA_LOOKUPS_PER_PASS` on a guess. If no Jenkins is reachable, leave the cap at 5 and say so.

**The word is decided by its readers, not by taste.** `unknown` already exists and `bindChecks` uses it for "no build of this commit". A new `unbound` changes the `checks` vocabulary that the board, the merge queue (`packages/domain/src/workflows/merge.ts`, including `checks-unbound` at `:107`) and `pr-refresh.ts` read. List every reader of `checks` first, with grep output in the PR. Prefer `unknown` unless a reader must tell the two apart. Keep `pending` out: `bindChecks`' own doc comment records that `pending` holds the merge queue on a head Jenkins may never report.

**`checksSha` stays `""` for an unbound row.** `merge` refuses a green whose `checksSha` names another commit; an empty `checksSha` must continue to read as unbound there.

**A lookup that cannot ask is not an answer.** Carried over unchanged from #2053/#2075: `bindChecks(null, …)` returns `null` and the branch colour stands; a lookup that exits non-zero ends the pass and no later row is asked. Do not turn an unreadable lookup into `none` or `failing`. Absent is not false.

**Open question to close in this slice:** does the GitHub arm of `pr-list` share the cap? Read the arm at `plot-host.sh:~4290` — it sets `checksSha:(.headRefOid // "")` from the rollup, which names its own commit. State the finding in the PR; change the arm only if it shows the same gap.

### Done when

The plan's `## Slices` line is the specification: rows past the lookup cap no longer report a branch colour as their head's checks, and the Changelog line holds. Beyond that, these assertions exist because a naive change would pass without them:

- **A test with more than `SHA_LOOKUPS_PER_PASS` ambiguous rows.** A fixture with five or fewer rows passes on today's code; the case needs rows 6 and up, each with a `green` or `failing` branch colour and a head sha, and asserts none of them reads `green` or `failing` with an empty `checksSha`. Mutation-test it: revert the fix and watch the case fail (`mutation-test-a-gate-before-believing-its-tests`).
- **A row inside the cap still reads its bound colour.** Catches a fix that blanks every row.
- **`packages/domain/test/jenkins-pr-checks.test.ts` and `test/reconcile/host.test.mjs` change together.** The first holds the rule, the second holds the `jq` projection; a fix to one alone leaves the other asserting the old behaviour. `host.test.mjs:3641` selects only ambiguous rows, so a fixture needs a head sha and a green colour.
- **`rowsToBind`'s doc comment is rewritten.** It currently states "A row past the limit keeps its branch colour, unbound", which is the defect. TSDoc states behaviour, not history.

Plus: if a bundle source under `packages/board/src/server/entry/` changes, `pnpm build:board` to test locally and restore the generated paths before pushing (`scripts/check-no-bundle-diff.sh`); a changeset with the description first and the `bumps:` block last, naming `plot-host`'s skill (`plot`) at `patch`; arrow functions for every function written. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`: prefer the rule in the domain and a changed bundle answer over added `jq`; growth is paid for in the same change.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/jenkins-pr-checks.ts`, its test, `packages/board/src/server/entry/jenkins-pr-checks.ts`, the `pr-list` Bitbucket+Jenkins arm of `plot-host.sh`, `test/reconcile/host.test.mjs`, and the changeset. Other branches in flight touch the tracker (`bug/plot-reads-as-an-unknown-tracker`) and timeouts (`infra/a-timeout-reads-as-a-timeout`); neither holds these files as far as the dispatch showed, but `plot-host.sh` is large and shared, so rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
