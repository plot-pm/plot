## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 2: The default branch has its own reading)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/the-default-branch-has-its-own-reading` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 2 of 8. Wave 1 (`feature/a-pr-row-names-its-commit`) merged as #1455 and this wave builds on `PR_INDEX_VERSION = 4`; it reads no PR row field itself. Wave 3 (the IndexMonitor) reads `DefaultBranchReading` from the file this wave writes, so the field names below are the contract it builds on. The wave waits on nothing else.

### What to build

Nothing reads the default branch's CI. Measured 2026-10-09 in the master session: `main` went red after #1432 (a missing README row), #1435 stayed red behind it, and the master agent found the red by reading #1435's failed check. Auto-dispatch kept handing out slices while `main` was red, and each new PR started from a red base.

Five changes, in this order:

1. **Entity.** `DefaultBranchReading` in a new file `packages/domain/src/entities/default-branch.ts`, with its own zod schema and its own version constant (`DEFAULT_BRANCH_VERSION = 1`). Fields: `branch`, `headSha`, `head` (the state of the HEAD SHA's runs), `settled` (the newest SHA whose runs all concluded, with its state, or absent when none has), `failingRuns`, `at`. The file is `.plot/state/default-branch.json`, written by fleetd and nothing else. It is not part of the PR store (`entities/pr-index.ts`): that store holds the git host's answers, and this reading is the build connector's.
2. **Rule.** `foldRuns(runs)` and `defaultBranchRed(reading)` in `packages/domain/src/rules/` (a new file, `default-branch.ts`, beside `checks-verdict.ts`). Arrow functions, TSDoc that states behaviour only.
3. **Port and adapters.** `BuildPort.runsForSha(branch, sha)` in `packages/domain/src/ports/build.ts`, implemented in `adapters/build/build-actions.ts`, `build-jenkins.ts`, `build-none.ts` and `build-fixture.ts` (and `build-shell.ts` if the port's other operations route through it). A new refs operation `remoteHead(branch)` in `ports/refs.ts`, implemented in `adapters/refs/refs-git.ts` and `refs-fixture.ts` (check `refs-remote-git.ts` for the board-instance variant that answers `unaskable`).
4. **Shell.** A new `plot-host.sh runs-for-sha <branch> <sha>` verb, beside `run-for-sha` (about `:4405`). It prints every run for the SHA as a JSON array and spends one listing call. The change carries data and decides nothing.
5. **Fleetd and queue.** `packages/fleet` reads the HEAD SHA once per refresh, reads the runs when the SHA changes, writes the file, and passes the hold into the queue. `QUEUE_HOLDS` (`rules/queue.ts:333`) gains `default-branch-red`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`run-for-sha` cannot answer this, because it takes the first matching run.** `plot-host.sh` takes `.[0]` of the runs whose `headSha` equals the SHA (about `:4573`), and `main` runs three workflows (`ci.yml`, `build-bundles.yml`, `release.yml`). A green first run hides a red second one. `runs-for-sha` returns all of them and makes one listing call. It makes no per-run `gh run view`, which `run-for-sha` pays for a concluded failure (`:4590`): a failing run's job list is not needed to fold `red`. Do not reuse `run-for-sha` with a loop.

**`checksFromRuns` (`rules/checks-verdict.ts:209`) cannot fold this, because it reads one run and returns a wait verdict** (`settled | wait | tip-moved | no-answer | none`). The new `foldRuns(runs)` answers `red | green | pending | unknown`:

| Input | Answer |
|---|---|
| any run concluded `failure`, `timed_out` or `startup_failure` | `red` |
| none failed, and any run is queued, in progress or `action_required` | `pending` |
| at least one run exists and every run concluded `success`, `neutral` or `skipped` | `green` |
| no runs, a `cancelled` run with nothing failed, or an unreadable answer | `unknown` |

`red` is tested first, so a failed run beside a pending one reads `red`. `action_required` reads `pending`, not `red`: it is a build waiting for a person's click, the `build needs approval` finding the BuildMonitor already names. Jenkins results arrive in their own words (`plot-host.sh:4526`), and the Jenkins adapter maps them before `foldRuns` sees them: `SUCCESS` to success; `FAILURE` and `UNSTABLE` to failure; `ABORTED` to cancelled; `NOT_BUILT` to unknown. Put the mapping in `build-jenkins.ts`, with a test per word. The shell keeps the host's words and decides nothing.

**`remoteHead(branch)` cannot reuse `remoteTip`, because `remoteTip(branch, pushedSha)` answers equality and not the SHA.** `remoteHead` returns the SHA from `git ls-remote origin refs/heads/<branch>`. It is a git-protocol call (about 459 ms, measured at `packages/board/src/server/board.ts:163`) and spends no API budget. It runs once per refresh, in fleetd only. The board's instance answers `unaskable`, as `fetchRemoteHead` does, because `/api/board` is polled every few seconds and a network call there makes the poll depend on the git host. A failed `ls-remote` is `unknown`, never "the SHA did not move".

**The hold reads the newest SETTLED SHA, not the HEAD SHA.** `main` moves faster than CI finishes: on 2026-10-09, 103 of 121 commit gaps were under 20 minutes, and `validate` runs up to 25. Keyed on the HEAD SHA alone, a red SHA followed by a newer pending SHA would lift the hold while `main` is still broken. So the reading keeps two parts — the HEAD SHA's state, and the newest SHA whose runs all concluded, with its state — and `defaultBranchRed` answers from the settled part: `red` when the settled SHA is red, `false` otherwise, including when no SHA has settled (`unknown` holds nothing). The settled part advances only when a SHA's runs have all concluded; a pending HEAD never overwrites it. Do not read `head` in `defaultBranchRed`.

**The hold is reversible, and that is why it may read a non-terminal answer.** CLAUDE.md's *A Decision Reads The Index* says only a terminal answer is read from the PR index. That rule is about the PR index and decisions that cannot be undone. The next settled-green reading lifts this hold, and a slice already handed over is not recalled. This slice adds one sentence to that section saying so, then runs `./scripts/check-agents-md.sh --write` to regenerate the `AGENTS.md` mirror. Edit `CLAUDE.md`, not `AGENTS.md`.

**`default-branch-red` is a pass-level hold, not a slice property.** Every other `QueueHold` is a fact about one slice. This one is the same for every slice in the pass. Decide where it enters `whyNotReady` (`rules/queue.ts:441`) and write the decision in the commit message: either a `QueuedSlice` field set the same way for each slice, or a check before the per-slice loop. Whichever you choose, `QUEUE_HOLDS` lists it, `holdCounts` (`:675`) reports it every pass, and the registryd log line (`registryd.ts:515`) therefore prints `default-branch-red=<n>` even at zero. Place it after `merge-unknown` and before `assigned`: a landed slice leaves the queue for good whatever `main` says, so the two landing holds keep outranking it. A test pins the order.

**Cadence, and who pays.** Fleetd reads the runs when the HEAD SHA changes, and re-asks while the reading is `pending` or `red`, every 5 minutes, measured from when the SHA first appeared (the `headSince` logic from wave 1, applied to this reading), until `Checks wait` (3600 s) has passed. Each read takes a host slot by the rule `refreshRuns` uses (`packages/board/src/server/fleet.ts:1324`). Cost ceiling from the plan: up to about 400 REST requests per day (about 17 per hour against 5000). A refresh in which the SHA did not change and the reading is settled makes zero `runs-for-sha` calls; a test counts them.

**Arms.** GitHub Actions and Jenkins answer runs for a SHA (`build-jenkins.ts:29-59`). Bitbucket Pipelines has no arm: `runsForSha` answers `unaskable`, the reading's state is `unknown`, and nothing is held. A repository that declared no CI (`build-none.ts`) answers `unaskable` too. `unaskable` is not `green`.

**Rules carried from the index work, so they are not rediscovered by breaking them:**

- Absent is not false, and an outage is not an empty history. A failed `gh run list` exits 4 and reads `unknown`; an empty array from a host that answered reads `unknown` too, and only a non-empty all-concluded-success array reads `green`. Never write `green` from silence.
- Read the exit code, not the emptiness (`an-outage-is-not-an-answer`).
- Fleetd is the one writer of the file. The board, the shell and any later subscriber read it and never write it. `one-pr-index-writer.test.ts` is the model: add a sibling test that names the new file.
- The file has its own version, and a wrong-version or unparseable file reads as "no reading" — which holds nothing. A reader that cannot parse the file must not hold dispatch.
- Write new functions as arrow functions (`export const f = (…) => …`), including helpers in tests. No `.default()` in the schema; optional fields stay absent, never `''`.
- Facts, never a verdict, in the shell (Manifesto Principle 3): `runs-for-sha` reports `status` and `conclusion` as the host gives them.

### Done when

The plan's wave line is the specification: `foldRuns` has a test per GitHub and Jenkins conclusion, a three-workflow fixture with one failure reads `red`, a red SHA followed by a newer pending SHA still holds, and a queue test releases the hold when a newer SHA settles green.

The assertions that exist because a naive implementation would pass without them:

- **Three-workflow fixture, failure in the second or third run, not the first.** Catches `.[0]` — the `run-for-sha` shape — reading only the first run and answering `green`.
- **Red SHA, then a newer pending HEAD.** `defaultBranchRed` is true. Catches a rule keyed on the HEAD SHA, which lifts the hold the moment the next commit lands.
- **Newer SHA settles green.** `defaultBranchRed` is false and the queue releases the hold. Catches a hold that latches.
- **A pending HEAD does not overwrite the settled part.** Fold twice with a pending HEAD between two settled SHAs and assert the settled part. Catches a write that replaces the whole reading.
- **No runs, a host failure, and a `cancelled`-only answer each read `unknown`, and `unknown` holds nothing.** Catches `[]` read as green and an outage read as red.
- **`action_required` reads `pending`, and a failure beside it reads `red`.** Pins the table's order.
- **One conclusion per word, GitHub and Jenkins,** each asserted separately. Catches a mapping that handles `FAILURE` and forgets `UNSTABLE`.
- **Unchanged SHA, settled reading: zero `runs-for-sha` calls.** Count the port's calls with a fixture. Catches a fold that asks every refresh and spends the day's budget in an hour.
- **Pending reading: re-asked no sooner than 5 minutes after the last ask, and not after `Checks wait`.** Use an injected clock; do not sleep.
- **Hold order.** `landed` beats `default-branch-red`; `default-branch-red` beats `assigned`. Catches a hold added at the end of the list.
- **`QUEUE_HOLDS` and the log line.** A test that `default-branch-red=0` appears on a pass that held nothing.
- **Version.** A file with another `v` reads as no reading and holds nothing.
- **`remoteHead` on a failed `ls-remote` answers `unknown`,** not an empty SHA.

Mutation-test the gates you add: revert the settled-part rule and the first-run fix in place and read the failures before you trust the tests (`mutation-test-a-gate-before-believing-its-tests`). Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. This slice touches `packages/domain`, `packages/fleet` and `skills/plot/scripts/plot-host.sh`, so expect the domain and fleet vitest runs, both `tsc --noEmit` projects, and the `scripts/check-*.sh` gates to be on the list; the root `pnpm run typecheck` skips the domain package.

**Shell-line gate.** The slice touches `plot-host.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, counting non-comment, non-blank lines. The `runs-for-sha` verb adds lines, and that growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Measure with `scripts/check-shell-lines.sh --per-file` before and after. The Jenkins arm of `run-for-sha` and the new verb share the credential, URL and `curl` block (about 70 lines); folding that block into one function both verbs call is the first place to look, and comments do not count.

**Other gates:**

- A changeset in `.changeset/` for package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- The CLAUDE.md sentence and the `AGENTS.md` mirror (`./scripts/check-agents-md.sh --write`, then without `--write` to confirm).
- `skills/plot/scripts/README.md` gets a row only if a new script file appears. A new verb in `plot-host.sh` needs none; if you add a bundle entry, the row is required (`scripts/check-helper-table.sh`).
- `pnpm build:board` only to test locally; restore the generated bundle paths from the merge base before you push (`scripts/check-no-bundle-diff.sh`). Never commit a rebuild of `board-server.mjs` or `plot-*.mjs` bundles.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Where a project board is configured, set the new PR to "Ready" with `../plot/scripts/plot-update-board.sh <pr-url> "Ready" <owner> <number>`; skip it otherwise.
- Do not edit the plan's `State:` line or any `Started:` record by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- `packages/domain/src/entities/default-branch.ts` (new) and its test
- `packages/domain/src/rules/default-branch.ts` (new), `rules/queue.ts` (the hold) and their tests
- `packages/domain/src/ports/build.ts`, `ports/refs.ts`, and the adapters under `adapters/build/` and `adapters/refs/`
- `packages/fleet/src/shared/` — the writer of the file and the queue reading (`queue-reading.ts`); a new file there is better than growing `pr-refresh.ts`
- `skills/plot/scripts/plot-host.sh` — the `runs-for-sha` verb and the shell-line offset
- `CLAUDE.md` (one sentence), the `AGENTS.md` mirror, and the changeset

Branches in flight, verified against `origin` at dispatch:

- `feature/a-merged-pending-check-is-asked-again` (a different plan) touches `packages/board/src/server/fleet.ts` (+138), `packages/domain/src/rules/pr-index.ts` and their tests. This branch must not edit `fleet.ts` or `rules/pr-index.ts`. If the slice needs `refreshRuns`'s slot rule, import or copy the rule's call shape from `packages/fleet`, and do not change the board's file. Expect a textual conflict only if you touch either file.
- `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`) adds `packages/fleet/src/server/entry/*-command.ts`, `shared/implement-run.ts`, `shared/dispatch-command.ts` and edits `packages/board/build.mjs`, `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`. This branch adds no entry point, so it does not edit those; a new shared module is not a bundle.
- Waves 3 to 8 of this plan are not started. Do not add the IndexMonitor, the channel publisher, a `default branch red` finding name, a board payload field or a status-panel line here; wave 3 and wave 6 own them. `DefaultBranchReading` is written and read in this wave and published in the next.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
