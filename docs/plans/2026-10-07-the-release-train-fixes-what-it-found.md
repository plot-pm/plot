# The release train fixes what it found

> Twelve defects that the fleet found while it delivered v2.22 to v2.24: each one gets its own slice, ordered by severity, and each slice fixes one behaviour and adds the test that fails on `main` today.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1280, #1336, #1165, #1294, #1307, #1259, #1319, #1295, #1276, #1328, #1338, #1169, #1166, #1317, #1343, #1344
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `POST /api/deliver` finds a plan through its dated plan file and reads its phase at the ref the pulse was read from, so a plan whose slices all merged is deliverable, and a plan that `origin` already delivered answers `already-delivered`.
- Delivery counts a slice as merged from the PR store's `MERGED` rows first and asks the host only for the rest. A host answer of `unknown` refuses as "cannot tell", never as "not merged", and the refusal names the real merged count.
- `POST /api/continue` refuses a desk whose loop is still alive, and starts the continued loop outside the board's process tree, so a board restart does not stop a continued agent.
- The refs corpus test does not write `origin/HEAD` in the shared repository, and `default_branch` refuses a symref that names `plot-corpus-pin` whether it resolves or not.
- A CI run that no runner took (0 steps, or the "not acquired" annotation) reads as no answer yet and spends no correction.
- `POST /api/release-claim {branch}` releases a branch claim through the domain, refuses a branch with a live agent or an open PR, and is reachable through `plot-ask.mjs`.
- `Slice max spend: $20` and `Agent max spend: $5` read as 20 and 5 dollars. A value the loop cannot read is logged and refused, never read as "no limit".
- The board shows "build needs approval" for a run that waits for approval, and "head moved" for a run of a commit that is not the pushed one.
- A free agent that takes up a handed slice runs it with the slice's charter, and the board's `.plot-worker.continue.md` no longer holds a merged desk from the reaper.
- `plot-local-checks.mjs` finds the related tests in a worktree under a symlinked `TMPDIR` on macOS.
- The reconcile sweep does not report a listing moved to another plan, or a pair of finished plans, as a double claim.
- A board build removes a helper copy that it no longer vendors, so no untracked helper stays in `packages/board/`.

<!-- Board impact: slices 1, 3, 5, 9 and 10 change board server code and rebuild the shipped bundles on main after merge. Slice 9 adds one route, `POST /api/release-claim`. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Auto-dispatch delivered three releases between 2026-10-03 and 2026-10-07. The defects below came up while it ran. Each one is small, and each one stopped the release train or made it lie about its state:

- **Delivery refuses finished plans.** `resolvePlanBySlug` returns the active symlink first (`packages/board/src/server/deliver.ts:162-163`). `landed()` and `deliveryPulse` join on that basename (`packages/domain/src/rules/deliverable.ts:133`, `:254`), and the pulse names the dated file, so every Approved plan reads `not-merged` (#1280). The phase comes from the working tree (`deliver.ts:214-231`), while the pulse comes from `origin/main`, so a stale checkout refuses a plan that `origin` already delivered (#1336).
- **A 429 reads as "not merged".** `controllers/deliverability.ts:86` asks `host.prMerged` once per branch. An `unknown` answer counts as not merged. A 12-slice plan on Bitbucket sends about 60 requests and gets 12 `unknown` answers (#1165).
- **Continue runs two loops on one desk.** `continueOnDesk` never stops or refuses a live loop (`packages/board/src/server/continue.ts:457`, `:802`). On 2026-10-05 three loops ran on one desk (#1294). The continued loop is a child of the board, and `plot-boardctl.sh` stop sends TERM to the whole tree (`tree_pids`, `plot-boardctl.sh:173`, `:532-536`), so a board restart stops every continued agent (#1307).
- **A test moves the machine's default branch.** `packages/domain/corpus/refs.corpus.test.ts:219-251` re-points the shared repository's `origin/HEAD`. On 2026-10-03 an interrupted run left it on `plot-corpus-pin`, and three lifecycle pushes went there (#1259). `repair_origin_head` (`skills/plot/scripts/plot-default-branch.sh:72`) accepts the name once it resolves. Two parallel corpus runs also collide (#1319).
- **A host outage spends corrections.** A run that no runner took concludes `failure` with 0 steps. `checks-verdict.ts:137`, `:186` read it as a build failure, and `worker-loop.ts:808-818` hands the agent a correction for it (#1295).
- **No controller releases a claim.** A master agent needs the counted bypass to release a stale claim (#1276).
- **`$20` removes the spend limit.** `dollarsOrUnset` (`packages/board/src/server/entry/worker-loop.ts:1656-1659`) reads `Number('$20')` as `NaN` and answers no limit (#1328).
- **"Build needs approval" never shows.** `buildRun` is set only when the checks settle (`worker-loop.ts:821`), so the `waiting` arm of `buildFindingFor` (`checks-verdict.ts:234`) is dead. The "head moved" finding has no test. Stale comments name removed code (`plot-agent-manifest.sh:117-123`), 9 tests in `usage-limit.test.mjs` are always skipped by `shellOnly`, and `continue.ts:534` stops only the agent monitor (#1338).
- **A handed slice runs without its charter.** The JS loop resolves the charter once from the start-time `PLOT_AGENT` (`worker-loop.ts:1762`, `:2039`) and not at hand-over (#1169). The board writes `.plot-worker.continue.md` (`continue.ts:64`), which is not in `.gitignore` and is not excused in `plot-desk-dirt.sh:102`, so a merged desk that holds it is never reaped (#1166).
- **Local checks pass with no test.** `packages/board/src/server/entry/local-checks.ts:84` takes `repoRoot` from git and does not realpath-normalise the `{changed}` paths. Under `/var` against `/private/var` on macOS, `vitest related` finds no test and the check reads as a pass (#1317).
- **The sweep reports 9 double claims and none needs a person.** Section 14 of `plot-reconcile-scan.sh` counts a listing marked `deferred: moved to …` as a claim, and reports pairs where both plans are `Released`. On 2026-10-07, 3 of the 9 are moved listings and all 9 are pairs of released plans (#1343).
- **Stale helpers appear in `packages/board/`.** `build.mjs` copies every name in `vendoredScripts` to the package root and never removes a copy whose name left the list. Four copies stayed as untracked files after `b6aedfb73`, `1d4cff764` and `f60a9da75` removed their names (#1344).

## Design

### Approach

**One slice per fix, one branch per slice.** The fixes do not share code, and each slice carries its own test, changeset and bundle rebuild where it touches the board. A slice is eligible only when every prior slice has merged (`packages/domain/src/rules/eligible.ts:131-134`, `plot-fleet-scan.sh:236-238`), so the slices run in heading order. The order is by severity: a slice that stops delivery or writes to the wrong branch comes first, and a report that only misleads comes last.

**Slice 1, the plan at the pulse ref (#1280, #1336).** `deliverability()` resolves the real plan file (`docs/plans/<date>-<slug>.md`) and never the active symlink, and it reads the plan's phase with `git show <readRef>:<plan file>`, where `readRef` is the ref the pulse was read from. `landed()` and `deliveryPulse` then join on the same dated basename the pulse uses. A plan that `origin` delivered while the checkout is behind answers `already-delivered`.

**Slice 2, the corpus pin (#1259, #1319).** `refs.corpus.test.ts` clones the repository into its own temp directory and sets `origin/HEAD` there, or it passes the pin to its reads through an argument. It never writes a ref in the shared `.git`. `default_branch` treats a symref that names `plot-corpus-pin` as corrupt whether it resolves or not, and `repair_origin_head` repairs it.

**Slice 3, continue owns its desk (#1294, #1307).** `continueOnDesk` reads the desk manifest's `pid` and `wrapperPid`. While that loop is alive, it refuses with `loop-alive` and names the pid. When no loop is alive, it starts the new loop through the registry supervisor's start path, detached in its own session, with its pid in the manifest as a dispatched loop has. `plot-boardctl.sh` stop then finds no agent in the board's tree.

**Slice 4, a run no runner took (#1295).** A rule in `checks-verdict.ts` reads a run whose failed or cancelled jobs ran 0 steps, or carry the "not acquired by Runner" annotation, as `no-answer`. `checksFromRuns` keeps waiting, and the loop hands back no correction.

**Slice 5, the PR index first (#1165).** `mergedBranches` in `controllers/deliverability.ts` reads the PR store's `MERGED` rows through `decodePrIndex` and asks `host.prMerged` only for the branches the store does not answer, as `plot-impl-status.sh` does. Only a terminal `MERGED` row answers, as *A Decision Reads The Index* in `CLAUDE.md` requires. Any `unknown` answer refuses as `cannot-tell` and names the host's words. The refusal reports the real merged count.

**Slice 6, the spend limit (#1328).** `dollarsOrUnset` accepts a leading `$` and a trailing ` USD`. A value it still cannot read is logged with the key and the raw value, and the loop refuses to start, because a cap that disappears in silence is worse than a stopped loop.

**Slice 7, local checks in a temp worktree (#1317).** `local-checks.ts` resolves `repoRoot` and every `{changed}` path through `realpath` before it builds the commands.

**Slice 8, the charter at hand-over (#1169, #1166).** The JS loop resolves the slice's `agent:` charter through `rules/prompt.ts` when it takes up a slice, and runs that prompt with the charter's prompt file, harness, model and effort. A slice with no annotation keeps the start-time values. A charter the loop cannot read refuses the slice, and the slice goes back to the queue. `.plot-worker.continue.md` goes into `.gitignore`, and `plot-desk-dirt.sh` excuses a root `?? .plot-worker.continue.md` line as it excuses `PLOT-CORRECTION.md`.

**Slice 9, the claim release controller (#1276).** A domain workflow `releaseClaim` takes the branch, the readings of its agent and its PR, and answers `release` or a refusal: `agent-live` or `pr-open`. `POST /api/release-claim {branch}` calls it and runs the release through the adapter that `--release` uses today. `plot-ask.mjs release-claim <branch>` reaches the same route without HTTP.

**Slice 10, a waiting run (#1338).** `buildRun` carries the run whenever the wait reads one, not only when it settles, so `buildFindingFor` answers `build needs approval` for `status: waiting`. A test covers "head moved". The slice also removes the stale comments at `plot-agent-manifest.sh:117-123`, the 9 `shellOnly` tests in `usage-limit.test.mjs`, and makes `continue.ts:534` stop the build monitor as well as the agent monitor.

**Slice 11, the sweep (#1343).** Section 14 skips a listing whose `deferred_reason` starts with `moved to`, and skips a pair whose claimant plans are all terminal.

**Slice 12, the vendored helpers (#1344).** `build.mjs` removes every `plot-*.sh` at the package root that `vendoredScripts` does not name, and logs each removal. `packages/board/.gitignore` ignores the vendored set by one pattern.

### Open Questions

- [ ] Slice 3: should `continue` stop a live loop and then start, instead of refusing? The issue allows both. The plan refuses, because a stop can lose a turn in progress.
- [ ] Slice 4: should the loop re-run the workflow once after a run no runner took, or only wait? The plan waits, because a re-run spends CI minutes during a host outage.

## Slices

### Deliver reads the plan at the pulse ref

- `bug/deliver-reads-the-plan-at-the-pulse-ref` — resolve the dated plan file, read its phase at the pulse's read ref, join `landed()` and `deliveryPulse` on the dated basename; tests through `docs/plans/active/` and with a stale checkout <!-- builds: the plan phase read at the pulse's read ref -->

### The corpus never moves origin/HEAD

- `bug/the-corpus-never-moves-origin-head` — the refs corpus works on its own clone or an injected pin; `default_branch` refuses `plot-corpus-pin` <!-- builds: a corpus pin that writes no shared ref -->

### Continue owns the desk it starts

- `bug/continue-owns-the-desk-it-starts` — refuse a desk with a live loop; start the continued loop detached, outside the board's process tree <!-- builds: the loop-alive refusal and a detached continue -->

### A run no runner took is no answer

- `bug/a-run-no-runner-took-is-no-answer` — a 0-step or not-acquired run reads `no-answer` and spends no correction <!-- builds: the unacquired-run reading in checks-verdict.ts -->

### Deliver reads the PR index first

- `bug/deliver-reads-the-pr-index-first` — `MERGED` rows from the PR store first, the host for the rest, `unknown` refuses as `cannot-tell` with the real merged count <!-- builds: mergedBranches over the PR store -->

### A spend limit reads its dollars

- `bug/a-spend-limit-reads-its-dollars` — `dollarsOrUnset` accepts `$20` and `20 USD`; an unreadable value is logged and refused <!-- builds: a dollar parser that never drops a cap -->

### Local checks in a temp worktree

- `bug/local-checks-find-tests-in-a-temp-worktree` — realpath-normalise `repoRoot` and the `{changed}` paths <!-- builds: realpath-normalised changed paths -->

### A handed slice carries its charter

- `bug/a-handed-slice-carries-its-charter` — resolve the charter at take-up; ignore and excuse `.plot-worker.continue.md` <!-- builds: the charter resolved at take-up -->

### A claim has a release controller

- `bug/a-claim-has-a-release-controller` — `releaseClaim` in the domain, `POST /api/release-claim`, `plot-ask.mjs release-claim` <!-- builds: POST /api/release-claim -->

### A waiting run needs approval again

- `bug/a-waiting-run-needs-approval-again` — `buildRun` for a waiting run, the head-moved test, the stale comments and skipped tests removed, continue stops the build monitor <!-- builds: buildRun for an unsettled run -->

### The sweep counts a moved claim once

- `bug/the-sweep-counts-a-moved-claim-once` — section 14 skips moved listings and pairs of terminal plans <!-- builds: the moved-listing filter in reconcile section 14 -->

### Helpers stay out of packages/board

- `bug/helpers-stay-out-of-the-board-package` — `build.mjs` prunes helper copies it no longer vendors; one `.gitignore` pattern <!-- builds: the vendored-helper prune in build.mjs -->

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- Slice 1: a deliver-route test resolves a plan through `docs/plans/active/` and answers `deliverable` for a plan whose slices all merged; a second test holds the plan Delivered at the read ref and Approved in the working tree, and answers `already-delivered`.
- Slice 2: a corpus run leaves `git symbolic-ref refs/remotes/origin/HEAD` of the shared repository unchanged; `default_branch` with a symref to an existing `origin/plot-corpus-pin` answers the real default branch.
- Slice 3: a test starts a loop on a desk and calls continue; continue refuses with `loop-alive`, exactly one loop runs, and the manifest survives. A continued loop survives `plot-boardctl.sh` stop.
- Slice 4: `checksFromRuns` over a failed run with 0 steps answers `no-answer`, and the loop hands back no correction for it.
- Slice 5: a 12-branch plan whose store holds 12 `MERGED` rows is deliverable with zero host calls; a host `unknown` for one branch refuses as `cannot-tell` with `merged: 11`.
- Slice 6: `dollarsOrUnset('$20')` answers 20; `dollarsOrUnset('x')` is logged and refused.
- Slice 7: a worktree under a symlinked temp directory prints a `vitest related` command that names the changed file's real path, and the command finds its test.
- Slice 8: a free agent handed a slice annotated with a charter that names a model runs the prompt with `--model <that model>`; a merged desk that holds only `.plot-worker.continue.md` is reaped.
- Slice 9: `releaseClaim` refuses `agent-live` and `pr-open` and answers `release` otherwise; `plot-ask.mjs release-claim <branch>` removes the claim ref.
- Slice 10: a run with `status: waiting` gives the finding `build needs approval`; a run of another commit gives `head moved`.
- Slice 11: a fixture with one moved listing, one pair of released plans and one live collision prints `double_claims=1`.
- Slice 12: a build with a stray `plot-gone.sh` at the package root removes it.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the release train's open findings ship as one bug plan with one slice per fix, each fix as the triage on `a778bda0d` stated it; Type bug; reviewed in-session; own branches.
- The slices run one after another. `sliceVerdict` makes a slice eligible only when every prior slice is `complete` (`packages/domain/src/rules/eligible.ts:131-134`), and the fleet scan applies the same rule per `###` heading (`plot-fleet-scan.sh:236-238`). Two branches under one heading would run together, but a heading with several branches is an unsliced plan that `/plot-reslice` repairs (`DESIGN-slice.md` §1). The order is therefore by severity.
- #1343 and #1344 were filed on 2026-10-07 for slices 11 and 12. The four stray copies of #1344 were gone from the checkout by the time the issue was written; the cause in `build.mjs` stays.
- Deliverable search, 2026-10-07:
  - Slice 1: `resolvePlanBySlug` has private copies in `approve.ts:120`, `commission.ts:117` and `deliver.ts:147`, each a copy of `transition.ts`'s. The fix changes the deliver copy; the other two resolve the same symlink and are a candidate for one shared resolver.
  - Slice 2: `plot-default-branch.sh:11-38` documents two earlier `plot-corpus-pin` leaks; `repair_origin_head` at `:72`.
  - Slice 3: `continueOnDesk` (`continue.ts:596`) is also called by the supervisor (`entry/registryd-main.ts:1562`), so the refusal reaches both callers.
  - Slice 4: no existing unacquired-run reading.
  - Slice 5: `mergedBranches` exists twice with different inputs: `auto-dispatch.ts:162` over the pulse and `controllers/deliverability.ts:80` over the host. `decodePrIndex` is read through `entry/pr-index-lookup.ts`.
  - Slice 6: `dollarsOrUnset` is the only dollar parser (`worker-loop.ts:1656`, callers `:1825`, `:2074`).
  - Slice 7: `realpath` is already applied to desks in `rules/desk-manifest.ts` and `rules/desk-worker.ts`, not to changed paths.
  - Slice 8: no existing take-up charter resolution; `readAgentCharter` is called once at `worker-loop.ts:1762`.
  - Slice 9: no `releaseClaim` or `/api/release-claim`; `/api/release` cuts a version release, a different act.
  - Slice 10: `buildFindingFor` (`checks-verdict.ts:232`) has one caller (`worker-loop.ts:1437`).
  - Slice 11: `deferred_reason` is already in the parser output and in `BranchSchema` (`packages/board/src/contract/schema.ts:106`).
  - Slice 12: nothing prunes vendored copies; `scripts/release-smoke.sh:96` tests that the vendored helpers run.
