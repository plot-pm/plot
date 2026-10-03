## Implementation brief — the-queue-reads-the-order-the-scan-reads (slice 2: a hand-over is checked before it is made)

- **Plan (canonical):** `docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-hand-over-is-checked-before-it-is-made` (base: `main`)
- **Ends as:** one PR to `main`. Open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- **Review of the code:** a person reviews the PR. Issue #1149.

Slice 1 (`bug/the-queue-reads-the-scans-order`, #1247) merged on 2026-10-03, so this slice is unblocked. `bug/a-release-and-a-rejected-push-name-the-agent` (plan `an-assignment-is-read-where-it-is-recorded`, slice 2) waits on this branch, because both change the rejection branch of the claim push in `plot-worker-loop.sh`.

### What to build

Issue #1149, measured 2026-10-01: a Bitbucket tick of `cost=4692236ms` (78 minutes) then handed `feature/ewzkus-3845-ueberwachung` to an agent. That branch had merged by PR #3662 and its remote ref was gone. The agent's claim push was rejected three times, and the loop logged `REGISTRY LOCK VIOLATION` about a second agent that did not exist. The tick's readings were 78 minutes old at the moment of the write, and `startAgents` asked nothing before `performer.assignSlice`.

Four pieces close the gap. The plan's `### Slice 2` section is canonical; this brief is orientation.

1. **`handOverCheck(reading)`** in `packages/domain/src/rules/queue.ts`, with `reading = { ageMs, refNow, landedNow }`. It answers `stale`, `landed`, `unknown`, `claimed` or `hand-over`, tested in exactly that order, and exports `HAND_OVER_MAX_AGE_MS = 300_000`. Write it as an arrow. `landedNow` is the existing `LandedAnswer` (`rules/landed.ts:21`); `refNow` is `present | absent | unknown`.
2. **`remoteHead(branch)`** on the refs port (`packages/domain/src/ports/refs.ts`), implemented in `packages/domain/src/adapters/refs/refs-git.ts` as `git ls-remote --heads origin <branch>`. It answers `present`, `absent`, or `unknown` on a failed call. It is a git call and spends no host budget. Add it to `refs-fixture.ts` too.
3. **The check in `startAgents`** (`packages/board/src/server/entry/registryd-main.ts:968`). Before each `performer.assignSlice` (`:978`), ask `remoteHead` and `queuedHasLanded` for that branch, call `handOverCheck`, and where the answer is not `hand-over` write `  <branch>: not handed — <answer>\n` and `continue`. Both readings are asked only for a branch about to be handed over, so at most the tick's free agents.
4. **The rejection message** in `skills/plot/scripts/plot-worker-loop.sh` (claim push at `:2965`). Keep git's stderr instead of `2>/dev/null`, then run `git ls-remote --heads origin <branch>`. An absent ref prints `the claim push for <branch> was rejected and origin has no such branch: <stderr>`. A present ref keeps today's `REGISTRY LOCK VIOLATION` line unchanged.

### Where the plan's anchors moved — verified on `main` at `76e774813`

The plan cites line numbers from `19f662d1`. These are the current ones:

- `startAgents` is `registryd-main.ts:968`, not `:879-905`. The claim push is `plot-worker-loop.sh:2965`, not `:2290`.
- **`TickReport` already carries `startedAt`** (`registryd.ts:83`, set at `:233`). The plan says the tick must pass it through; it does already, so no change to `tick` is needed. Measure the age as `Date.now() - report.startedAt`, taking `now` as a parameter so the test can pin it.
- **`startAgents` has no world.** Its signature is `(report, performer, write, warn)`. `queuedHasLanded` is built inline at `registryd-main.ts:707` from `askMerged`, inside the world the queue reads. Do not duplicate that join. Extract it, or pass a small `HandOverWorld` (`{ remoteHead, queuedHasLanded, now }`) from the caller at `:1263`, so the host question has one construction. A second copy of the `LookupReading` mapping is exactly the drift the comment at `:714-722` warns about.

### The decisions the plan settles — do not re-derive them

**The age test is first.** No fresh answer about one branch makes a 78-minute reading of the other branches current. A `handOverCheck` that tests `landed` before `stale` passes every single-branch case and still hands out from a stale reading.

**The bound is a measurement, not a preference.** From `.plot/logs/registryd.log`, 2026-10-01: this repository logged 7 167 ticks, median 14.4 s, p95 115 s, 83 ticks (1.2%) over 300 s, maximum 2 479 s. `ewz-kus-portal` logged 1 592 ticks, 8 (0.5%) over 300 s, maximum 4 692 s. So 300 000 ms withholds about 1% of ticks, and the next tick hands them over. `startAgents` makes no comparison of its own: the constant and the rule live in `rules/queue.ts`.

**A withheld hand-over costs one tick and nothing else.** The next tick re-derives the queue from disk, which is the recovery `startAgents`' own doc comment already states (`:942-945`). Do not retry, remember or queue anything.

**`unknown` withholds.** A ref that could not be asked, or a host that could not answer `landed`, is not permission. This is the repo's rule that absence is not falsehood. The Bitbucket tick that caused #1149 ran at a time its host was slow.

**`remoteHead` is a git call, not a host call.** A host question would spend rate-limit budget on the fleet's hot path, and `refs` is the adapter that spends none. Do not route it through `plot-host.sh`.

**Telling a stale empty claim from another agent's claim is #1152's.** The rejection message in this slice distinguishes only `absent` from `present`. Do not add a `claim-only` reading to the loop. `an-assignment-is-read-where-it-is-recorded` slice 2 does that, and it rewrites the branch you are editing.

**No other hand-over path needs a change.** The plan's `### The other hand-over paths` section measured four: board auto-dispatch (queues for the registry and pushes no claim), `/api/claim` (starts no worker), the loop's hop (seconds-old reading, rejected push is the lock), and `plot-dispatch.sh --restart` (a person names the branch). Outside tests, only `registryd-main.ts` and the performer port and adapter name `assignSlice`. `startAgents` is the one place that gives a queued slice to an agent, so add no check anywhere else.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **One `handOverCheck` case per answer, plus the ordering cases.** `ageMs: 300_001` with `landedNow: 'landed'` answers `stale`, not `landed`. `landedNow: 'landed'` with `refNow: 'present'` answers `landed`, not `claimed`. `landedNow: 'unknown'` with `refNow: 'present'` answers `unknown`, not `claimed`. Each catches a reordered test list. `ageMs: 300_000` exactly answers `hand-over`, which catches `>=` for `>`. Domain branch coverage is 100% for `src/!(adapters)/**`, and an unreached branch fails the coverage gate.
- **A `startAgents` test with a stub world whose branch merged after the reading.** It asserts no `assignSlice` call and the exact line `not handed — landed`. A second test with a reading 301 s old asserts `not handed — stale` and no call to `remoteHead` or `queuedHasLanded` for it. This catches a check that asks the host before testing the age.
- **A hand-over that passes the check still calls `assignSlice`** and writes `handed to <session>`. This lock catches a check that withholds everything.
- **A contract test for the loop.** It pushes a claim for a branch absent on a bare origin's sibling and asserts the output holds `origin has no such branch` and does not hold `REGISTRY LOCK VIOLATION`. A second case with the ref present asserts the violation line is unchanged. The second case catches a message change that swallows the double-assignment report. Clear `PLOT_UNATTENDED` in the child env of a new shell test's `run()`.
- **`remoteHead`** has its own case for each of `present`, `absent` and a failed call answering `unknown`, in `refs-git`'s existing test style.

Plus the repo gates: `nvm use` (Node 24) first. Add a `.changeset/*.md` with `'@plot-pm/board': patch` for the board and `'plot': patch` with a `bumps:` block for `plot-worker-loop.sh`'s skill if the script ships under a skill — copy the format from `git log -- .changeset`, description first, `bumps:` last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`. If `registryd-main.ts` changes, run `pnpm build:board` so the artifact in `skills/plot/scripts/board/` matches; on a conflict in `board-server.mjs`, take either side and rebuild.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/queue.ts` (`handOverCheck`, `HAND_OVER_MAX_AGE_MS`), `packages/domain/src/ports/refs.ts`, `packages/domain/src/adapters/refs/`, `packages/board/src/server/entry/registryd-main.ts` (`startAgents` and its caller), the claim push in `skills/plot/scripts/plot-worker-loop.sh`, and the tests beside each.

In flight or waiting, verified on `origin` at dispatch: no remote branch exists for `bug/the-queue-reads-the-assignment`, so it is not started. It waits on slice 1, which has now merged, so it can start at any time. It adds `commitSubjects` to the same refs port and `refs-git.ts`, and adds a hold to `rules/queue.ts` (`QueueHold`, `HOLD_SCOPE`). Add your members at the end of each list and rebase onto `main` before the PR; the overlap is textual, not semantic. `bug/a-release-and-a-rejected-push-name-the-agent` waits on you and edits the same loop branch.

Do not touch `planQueue`, `settled`, `sliceVerdicts`, `isClaimable`, `waitVerdict` or the fleet scan: slice 1 settled them. If you find something the plan did not anticipate, report it rather than improvising outside scope.
