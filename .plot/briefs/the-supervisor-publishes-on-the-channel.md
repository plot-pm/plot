## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 3: The supervisor publishes on the channel)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/the-supervisor-publishes-on-the-channel` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 3 of 8. Waves 1 and 2 merged (#1455, #1460): the PR index is at `PR_INDEX_VERSION = 4` with `headSha`, `headSince`, `checksSha` and `mergedAt`, and `DefaultBranchReading` is written to `.plot/state/default-branch.json` with `defaultBranchRed` in `rules/default-branch.ts`. This wave publishes both. Wave 4 (the desk relay) reuses the in-process `publish` and `seen` calls added here, and wave 5 (`/api/events`) subscribes to the socket this wave opens. The wave waits on nothing else.

### What to build

The channel has a transport and no caller. `startChannel` (`packages/domain/src/adapters/channel/channel-socket.ts`) has no production caller (measured: only tests import it), so no subscriber can connect to a running one. Three consequences measured on 2026-10-09: the master agent polled `gh pr list` with `sleep 90` for PR state, a waiter failed after its PR merged and nothing told it, and `rules/channel.ts` refuses `ci is green` because "no monitor asks the host about a check run". Nothing in the supervisor's own reads reaches a subscriber.

Five changes, in this order:

1. **Vocabulary.** `MonitorNameSchema` (`entities/finding.ts`) gains `IndexMonitor`. `FindingNameSchema` gains `checks green`, `checks failing`, `pr merged` and `default branch red`. `MEASURED_BY` maps all four to `IndexMonitor`, which makes `MEASURABLE` (`rules/channel.ts:25`) list them with no further edit. `monitorSubject` (`rules/attention.ts`) switches exhaustively over `MonitorName`, so the compiler names the missing case; its sentence is `the pull request`.
2. **The rule.** A pure function in `packages/domain/src/rules/` takes the PR index, the `DefaultBranchReading`, the clock and the set of slice branches, and returns the findings that hold now: at most one per slot. A second pure function takes the findings the channel holds and the findings that should hold, and returns the publishes and the `clear`s. Both are arrow functions with TSDoc that states behaviour only.
3. **The channel's in-process surface.** `RunningChannel` gains `publish(finding)` and `seen(monitor)`. `lastSeen` becomes the time the channel received a reading (`now()`), not the reading's `measuredAt` (`channel-socket.ts:151`).
4. **The alias.** `ci is green` is served as `checks green` and `ci is red` as `checks failing`. The two `REFUSED_BY_DESIGN` entries (`rules/channel.ts:36`) go, and the comment above them says why.
5. **Fleetd.** `registryd-main.ts` starts the channel on `.plot/fleet.sock` in loop mode, runs the monitor after each PR and default-branch read, calls `seen('IndexMonitor')` after every fold, writes one `fleetd.log` line per publish, and stops the channel where the loop stops. Plus the `CLAUDE.md` row and the `AGENTS.md` mirror.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**One slot per branch, so one finding per branch.** `findingKey` is `monitor + branch` (`entities/finding.ts`). `checks green`, `checks failing` and `pr merged` for one branch share the slot `IndexMonitor feature/x`, and a new one replaces the old. That is the design, not a collision: the slot holds the newest thing true of the PR. Precedence per branch, highest first: `pr merged` (a merged row with `mergedAt` inside 24 h), `checks failing`, `checks green`; `pending`, `none` and `unknown` hold no finding and the slot is cleared. `default branch red` has its own slot, `IndexMonitor <default branch name>`, and holds exactly while `defaultBranchRed(reading)` is true. `worktree` is `''` on all four, because they describe a PR or a branch and no desk.

**Compare against the channel, not against a second memory.** The monitor computes what should hold, reads `channel.findings()` for what does hold, and publishes only the difference. After a restart the channel is empty, so the first fold publishes the current state with no special case: this is what the plan means by "the first fold after a start, a cold store or a version mismatch publishes the current state", and it is why no row becomes a transition without a readable previous state. The same diff clears a `pr merged` slot 24 h after `mergedAt`, because the rule stops returning it. **The comparison covers `finding` and `evidence` and excludes `since` and `measuredAt`.** Evidence therefore carries the head SHA, the check word and nothing that changes per fold (no timestamps, no counts that drift), or an unchanged fold republishes. `since` is the row's `headSince` where the finding is about checks, and `mergedAt` for `pr merged`; it keeps its first value while the finding holds.

**Only open slice PRs, plus 24 h of merges.** "Tens of findings, not one per stored row" is a requirement: the store holds hundreds of rows. A finding is published for an open PR whose head is a branch some plan names under `## Slices`, and for such a PR merged inside the last 24 h. Find the set from what fleetd already holds (the fleet scan state or the plans it reads); do not add a host call for it. If no cheap source exists, stop and report it rather than publishing for every row.

**Evidence says whether the checks name a commit.** `checks green` and `checks failing` publish from the row's `checks` word. Where `checksSha` equals `headSha` the evidence names that SHA. Where `checksSha` is absent (Jenkins, the plain listing, Bitbucket) the evidence says the checks are not bound to a commit. It does not refuse and it does not claim a SHA: wave 1 settled that an absent SHA is absent, and the merge controller in wave 8 is what refuses an unbound row. `checks failing` evidence lists `failing_checks` when the row has them.

**Why the refusal could go.** The refusal said a monitor asking the host about a check run would "put a host question on a fast loop". The IndexMonitor asks the host nothing: it reads the index and the default-branch file that fleetd already wrote. Do not add a `runsForSha` or `pr-list` call to the monitor. A test fails the build if the monitor's module imports a host port.

**The alias is a translation before admission, not a fifth finding name.** `admit` judges the asked condition before the shape (`rules/channel.ts:66-81`), so removing the two refusals alone makes `ci is green` fall into `this channel does not measure 'ci is green'`. Add a closed map `{ 'ci is green': 'checks green', 'ci is red': 'checks failing' }` and translate the purpose's finding before the `MEASURABLE` test, so the held `Subscription` carries the canonical name. `until ci is green` then serves from a held `checks green` the moment it joins (`onJoin`). The `welcome`'s `measurable` list shows canonical names only.

**The attention list takes the four names out of the errands, as `build passed` is.** The plan says the four names "join the exhaustive `READINGS` record as readings that ask nothing of a person". `READINGS` is `Record<Errand, FindingReading>` and every `FindingReading` has a `list` of `needsAgent | needsHuman | waiting`, so no entry can say "nothing". The precedent is `build passed`: `Errand` and `isErrand` (`rules/attention.ts:81`, `:149`) exclude it, and the board's attention lists never carry it. Extend both exclusions to the four new names, add a test that `findingReading` returns `null` for each, and say in the PR description that the plan's wording was met by the exclusion. If you think `default branch red` belongs in `needsHuman`, do not decide that here: the plan chose "asks nothing", the board shows the red in wave 6, and a person-asking finding is a plan amendment.

**Channel failure never stops fleetd.** `startChannel` rejects on a bind error (macOS limits a socket path to 104 bytes; a leftover live process on the path is another cause). Catch it, write one warning through `warn`, and run without the channel. The board reads the desk files on purpose so that nothing depends on the channel (`board/src/server/findings.ts:3-15`), and the PR index and the default-branch file are written whether or not anyone listens. A test starts fleetd's wiring with a bind that rejects and asserts the tick still runs. `--once` starts no channel: `defaultBranchWorld` is already `null` there, and a one-shot tick that opened a socket would leave a stale file.

**The monitor reads the stored index; it does not hook `pr-refresh.ts`.** `pr-refresh.ts` is 1.6k lines with `PR_PENDING_REASK_LIMIT` and the fold in it. Run the monitor in the `prs` callback of `startFleetClock` (`registryd-main.ts`, after `readPrs()` and `readDefaultBranch()`), reading through `prIndexFile` and `defaultBranchFile`. Write the choice and the one cost of it in the commit message: a fold whose write failed shows the last written state. If the monitor needs a field `pr-refresh.ts` does not return, report it rather than widening that file.

**Audit is the existing log.** One line per publish and per clear through the `fleetd.log` `processLog` (`LOG_MAX_BYTES` ceiling, `process-log.ts`). No event file. The line names the slot, the finding and the evidence.

**The CLAUDE.md row.** In *A Decision Reads The Index*, the part-3 row reads "Not built. No subscription exists." Change it to say that the IndexMonitor publishes on a change of the index and that a subscriber can wait on it, and name what is still not built (a shell consumer that waits). Edit `CLAUDE.md`, then run `./scripts/check-agents-md.sh --write` and confirm with `./scripts/check-agents-md.sh`. Do not edit `AGENTS.md` by hand.

**Rules carried from the index work, so they are not rediscovered by breaking them:**

- The index never says no. `pr: 'none'` is never published; a missing row, a v3 store, an unparseable store and a missing default-branch file each produce no finding and clear nothing the monitor did not publish. A store that cannot be read is not a store with no PRs: do not `clear` every slot because a read failed.
- Only a terminal answer is read from the index for a decision. This monitor makes no decision: it reports. A `checks green` finding is not a licence to merge; the merge controller (wave 8) re-asks the host.
- Fleetd stays the one writer of both files. The monitor reads them. `one-pr-index-writer.test.ts` and `one-default-branch-writer.test.ts` must still pass.
- Arrow functions for everything you write, tests included. No `.default()` in a schema; optional fields stay absent, never `''`. `worktree: ''` is the one empty string, and it is the schema's required field.

### Done when

The plan's wave line is the specification: a subscriber test receives one finding per change and none for an unchanged fold, a cold-store test publishes current state only and `pr merged` only for rows merged in the last 24 h, and a heartbeat test shows the IndexMonitor seen with no publish.

The assertions that exist because a naive implementation would pass without them:

- **Fold twice with an identical index: the second fold publishes nothing.** Count the subscriber's received messages. Catches a monitor that publishes every fold, which sends a message per PR every five minutes.
- **A head SHA change with the same check word.** Assert the behaviour the evidence comparison implies and state it in the test name. Catches an evidence string that includes a timestamp (republishes on every fold) or one that omits the SHA (stays silent on a new commit that is still failing).
- **Cold start with 200 rows, 3 of them open slice PRs and 1 merged 2 h ago.** Exactly 4 findings plus the default branch's. Catches publishing one finding per stored row.
- **A PR merged 25 h ago.** No `pr merged`; and a held `pr merged` is cleared once `mergedAt` passes 24 h. Catches a window that only opens.
- **`pr merged` replaces `checks green` in the same slot,** and a later `checks failing` on another branch leaves the first slot alone. Catches a slot keyed on the finding name.
- **A pending PR holds no finding and clears a held `checks green`** (a re-run turning green to pending). Catches a monitor that can only add.
- **Unreadable index and v3 index: no publish and no clear.** Hold a `checks failing`, make the store unreadable, fold, and assert the finding is still held. Catches `[]` read as "nothing holds".
- **Heartbeat.** A fold that publishes nothing still moves `IndexMonitor`'s `lastSeen`, and a relayed finding with an old `measuredAt` does not make a live monitor read as silent. Catches `lastSeen` taken from `measuredAt`.
- **`seen` is called after a fold that threw halfway.** Decide and test what the monitor reports when the fold fails: it must not read as alive after a failed fold. Say which in the test name.
- **`until ci is green` is served from a held `checks green`,** and `ci is red` from `checks failing`; `until clear` is still refused; the refusal text for a truly unknown condition still lists `MEASURABLE`. Catches the alias dropped between admission and `isServed`.
- **Bind failure.** `startChannel` rejecting does not end the tick (see above).
- **`startChannel` has one production caller.** A sibling test in the style of `one-default-branch-writer.test.ts` that greps `packages/*/src` and expects only `fleet/src/server/entry/registryd-main.ts`. Catches a second starter, which races for the same socket path.
- **The monitor imports no host port.** Catches a later "small" `pr-state` call on the fast loop.
- **The four names are not errands.** `findingReading` returns `null` for each, and the board's attention lists carry none of them.

Mutation-test the gates you add: break the evidence comparison, the precedence order and the 24 h window in place, and read the failures before you trust the tests (`mutation-test-a-gate-before-believing-its-tests`). Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. This slice touches `packages/domain`, `packages/fleet` and `CLAUDE.md`, so expect the domain and fleet vitest runs, both `tsc --noEmit` projects, and the `scripts/check-*.sh` gates to be on the list; the root `pnpm run typecheck` skips the domain package. The channel tests open a unix socket: use a path under the test's own temp directory, and wait for the process or the server's close, not a sleep.

**Shell-line gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

**Other gates:**

- A changeset in `.changeset/` for package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` inside the comment block. Run `./scripts/check-changeset-packages.sh`.
- The `CLAUDE.md` row and the `AGENTS.md` mirror (above).
- `.plot/fleet.sock` is not ignored by git today (`git check-ignore` prints nothing for it; only `.plot/state/` is). Add `.plot/fleet.sock` to `.gitignore` beside the `.plot/state/` entry.
- `skills/plot/scripts/README.md` gets a row only if a new script file appears; this slice adds none.
- `pnpm build:board` only to test locally. The fleetd bundle under `skills/plot/scripts/board/` is generated: restore every generated path from the merge base before you push (`scripts/check-no-bundle-diff.sh`), and never commit a rebuild.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Where a project board is configured, set the new PR to "Ready" with `../plot/scripts/plot-update-board.sh <pr-url> "Ready" <owner> <number>`; skip it otherwise.
- Do not edit the plan's `State:` line or any `Started:` record by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- `packages/domain/src/entities/finding.ts`, `rules/channel.ts`, `rules/attention.ts`, a new rule file for the index findings, and their tests
- `packages/domain/src/adapters/channel/channel-socket.ts` (`publish`, `seen`, `lastSeen`) and its test
- `packages/fleet/src/shared/` — a new file for the monitor's world and its run; a new file there is better than growing `pr-refresh.ts`
- `packages/fleet/src/server/entry/registryd-main.ts` — the start, the run after the reads, the stop. Keep the edit to those three sites.
- `CLAUDE.md` (one row), the `AGENTS.md` mirror, `.gitignore` if needed, and the changeset

Branches in flight, verified against `origin` at dispatch: no open PR touches `registryd-main.ts`, `entities/finding.ts`, `rules/channel.ts`, `rules/attention.ts`, `channel-socket.ts`, `pr-refresh.ts`, `rules/queue.ts` or `CLAUDE.md`, and no branch exists for waves 4 to 8. `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`) is the one branch the plan names as in flight elsewhere; it adds entry points under `packages/fleet/src/server/entry/` and edits `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`. This branch adds no entry point and edits neither build file. Both branches edit `registryd-main.ts` only if the other lands a wiring change there; keep your edit small so a rebase is mechanical.

Out of scope, owned by later waves, and not to be started here:

- Relaying desk findings, the Desk port read and moving the board's file reads (wave 4). The WorkerMonitor, AgentMonitor and BuildMonitor do not change.
- `/api/events`, any board subscription or page change (wave 5), `defaultBranchStatus` and badge changes (wave 6), the mod (wave 7), the merge controller and `--match-head` (wave 8).
- Any change to the PR index schema, `refreshDefaultBranch` or the re-ask rules (waves 1 and 2, merged).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
