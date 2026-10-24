# A desk continuation skips its run limits and leaves stale prompts and pids

> A continuation can run a desk past `Slice max runs`, signal a recycled pid, and leave a spent prompt behind; 41 review findings from 16 merged PRs name the causes.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2475
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/continuation-reads-the-loops-run-limits`
- **Started:** 2026-10-24, Jan Wloka, `bug/a-failed-continuation-leaves-the-desk-as-found`
- **Started:** 2026-10-24, Jan Wloka, `bug/drop-reads-the-boards-branch`

## Changelog

- A desk continuation refuses at `Slice max runs` and `Slice max spend` on every path, restores the manifest and removes its prompt when it fails, and signals a wrapper pid only after it confirms the pid belongs to the desk.
- The drop controller and the board read the same branch for a merged waiting desk, so a merged waiting desk can be dropped.
- The worker loop checks mergeability against the PR's own base and re-reads it during the Checks wait.

Board impact: the drop controller (`packages/board/src/server/drop.ts`) and the continue route change behaviour. The plan format, template, helper scripts and `docs/plans` layout are untouched.

## Motivation

Follow-up findings from plot-review on 16 merged PRs (#2059, #2069, #2070, #2071, #2102, #2116, #2129, #2130, #2131, #2143, #2145, #2147, #2175, #2178, #2179, #2183) were collected in #2475 and checked against `origin/main` at `84b1638e4` on 2026-10-24. The list holds 16 MEDIUM and 25 LOW findings. The MEDIUM findings fall into five behaviours, and each is a defect a person can hit:

- **Run limits.** `continue-target.ts:155` accepts a run-limit ending and writes a manifest with no `sliceRuns`. `continuation.ts:800` therefore never fires `Slice max runs` on the registry-tick path. `continuation.ts:576` reads an unreadable `Slice max spend` as no limit.
- **Refusal order.** The run and spend refusals at `continuation.ts:772` run after `beforeStart`, so a refused registry-tick start still writes its fresh-session row.
- **Stale state after failure.** `continuation.ts:845` returns `loop-alive` before `restoreManifest` runs, which leaves a desk with no manifest and no loop. `continuation.ts:920` writes the prompt before three steps that can fail and never removes it, so a later loop resumes the spent session with the answer.
- **Pid reuse.** `continuation.ts:844` sends SIGTERM to the manifest's wrapper pid without checking it, so after pid reuse it can kill an unrelated process.
- **Wrong branch and wrong base.** `drop.ts:188` reads the manifest branch, which is empty after seal, while the board reads the checked-out branch. `trees-git.ts:410` checks a desk against `defaultBase` instead of the PR's base. `worker-loop.ts:965` and `:970` spend a correction under `Checks wait: 0` and never see a conflict that appears during the wait.

Two further MEDIUM findings are test gaps (`continue-route.test.ts:1621`, `:496`, `workflows-agent-loop.test.ts:553`) and one is a refusal reason that always ends in `claim: unknown` (`agent-loop.ts:584`).

## Design

### Approach

Five slices, each over one set of files. Each slice opens by confirming its findings still hold on `main`, because the issue was checked at `84b1638e4` and the line numbers drift.

1. **One limit parser.** `continuation.ts` reads `Slice max runs` and `Slice max spend` with the same parser as the worker loop (`positiveOr` uses `Number()` and accepts `1e1` and `0x5`, where the loop accepts digits only). An unreadable value refuses rather than meaning no limit. The registry-tick path re-registers a manifest that carries `sliceRuns`, and `continue-target.ts` no longer accepts a run-limit ending into a fresh manifest. Both refusals run before `beforeStart` and before any write. The domain gains a corpus test pinning the continuation's parse against the loop's, as *A Shell Script Asks The Domain* requires of a declared duplicate.
2. **Failure leaves the desk as found.** A continuation that fails after it writes the prompt removes the prompt. A failed loop or wrapper stop restores the manifest before it returns `loop-alive`. The board signals the wrapper pid only after it confirms the pid still belongs to the desk. The dead `manifestBeforeStop === null` check goes.
3. **Drop reads the board's branch.** `drop.ts` reads the same branch for `deskBranchMerged` as the board, and the default PR-index reader test asserts a result that failed before the change.
4. **Mergeability.** `trees-git.ts` checks the desk against the PR's own base. The worker loop re-reads mergeability during the Checks wait. `Checks wait: 0` seals through ROW 12b when the PR conflicts. The conflict correction names the true source of the verdict (host or local `git merge-tree`) and carries no estate-specific text (`origin/main`, `board-server.mjs`, `pnpm build:board`). `mergeConflictAtEntry` is removed in favour of `mergeable === 'conflicting'`, and `host.test.mjs` stops excusing `mergeable` from the key-set parity test.
5. **Tests and comments.** Each continue-route and worker-loop test asserts what its name states and prints the refusal body on failure. The fixture pid cannot be alive on a Linux runner. The guard rows cover an unreadable ending record and check the worker log. A hook replaces the copied `continueTwice` setup. The `ending.ts` doc and the comments in `continuation.ts`, `agent-loop.ts` and the continue-route tests state current behaviour only. The missing tests land with the behaviour: row 7's `resumeId`, `continue-target` for spend-limit, run-limit and checks-unanswered, and `correctionHasContinuation` on an identical second answer.

The `agent-loop.ts:584` refusal reason needs the worker loop to read the claim for a desk reset as well as for a refused push, so it joins slice 2.

### Open Questions

- [ ] Does slice 1 share one parser module between `packages/fleet/src/shared/continuation.ts` and `worker-loop.ts`, or keep the declared duplicate plus a corpus test? *The Layering Rule* and the duplicate rule in `CLAUDE.md` favour a shared domain function when both callers are TypeScript.
- [ ] Does the pid-ownership check in slice 2 compare the process start time recorded in the manifest, or the process's working directory? Neither is recorded today.
- [ ] Do slices 1 and 2 conflict in `continuation.ts` enough to need an order? Both edit `continueOnDesk`.

## Slices

### Continuation

- `bug/continuation-reads-the-loops-run-limits` — one limit parser, limits refused before any write on every path <!-- builds: a shared Slice max runs / Slice max spend parser --> → #2511
- `bug/a-failed-continuation-leaves-the-desk-as-found` — prompt removed, manifest restored, wrapper pid verified before SIGTERM <!-- waits: bug/continuation-reads-the-loops-run-limits -->

### Independent

- `bug/drop-reads-the-boards-branch` — `deskBranchMerged` reads the checked-out branch → #2612
- `bug/mergeability-uses-the-prs-own-base` — PR base, re-read during the Checks wait, honest conflict correction

### Tests and comments

- `bug/continuation-tests-assert-their-names` — test fixes and comments that state current behaviour <!-- waits: bug/a-failed-continuation-leaves-the-desk-as-found, bug/mergeability-uses-the-prs-own-base -->

## Notes

- Source: #2475, a plot-review follow-up digest, 2026-10-24. The 16 source PRs are merged; this plan answers their open follow-ups only.
- Deliverable search for the shared limit parser found no existing helper (`plot-deliverable-search.sh "continuation.ts"` returned comment mentions only).
- Unattended run: the review channel (`pr`) and implementation home (`own branches`) follow `Plan PRs: required`, and the design question defaulted to no.
