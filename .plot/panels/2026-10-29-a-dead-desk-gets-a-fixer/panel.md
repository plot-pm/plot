# Panel moderation: a-dead-desk-gets-a-fixer

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: every juror ran a probe against the real `endingAction`, `restartWorker` and `restartOffered` (layering 3/3, seams, safety, testability via esbuild); testability ran 129 domain and 123 fleet tests.

## Agreed by all four

1. **The plan names the wrong rule.** `rules/fresh-agent.ts` only writes prompt text, and `ports/fresh-agent-record.ts` records starts, not failures. The "second failure asks a person" decision is `endingTableAnswer` in `rules/ending-action.ts:347-370`, applied by the tick at `registryd.ts:1012-1063,1175-1177`, which writes a `PLOT-BLOCKED` marker. Executed: with `priorFreshSessions: 1`, `endingAction` answers `needs-a-person` for six ending reasons, not one; the plan does not say which of them get the fixer.
2. **A second rule beside `endingAction` would act on the same desks.** Executed: `endingAction` already answers every dead desk with no PR and no marker (`release-claim`, `start-fresh` or `needs-a-person`). The plan's restart rule answers `restart` for the same desks, so one tick can release a claim and restart the branch, or put two writers on it. Fix: `start-fixer` and `restart` become answers inside `endingAction`, replacing its `needs-a-person` arms, with precedence against `deadClaims` named. One complete table, one test.
3. **The restart rule has no bound and ignores the ending.** It reads worker state, PR and marker but not the ending reason, so it restarts `spend-limit`, `unstarted`, `permission-denied` and the other `NEEDS_PERSON_ENDINGS` every tick, up to `Slice max runs` (12 paid runs). Nothing counts restarts; `restart-command.ts` writes no record. A refused restart re-asks the host every tick unless the refusal is recorded.
4. **Desks with a PR go to #2903.** #2903's arm "CI red, desk dead or corrections spent → fixer" matches the same red-PR desk; two rules would start two fixers. This plan's fixer covers only desks with no PR, and then #2903's per-PR attempt count has no key, so the plan names one. The unattended lift on `restart` belongs to #2898; the fixer runner and `fixer.md` come from #2898, not #2903; the restart slice does not need #2903 at all.

## Executed findings one juror raised

- **The restart undoes a person's stop** (testability, executed): a worker stopped by `--stop` (exit 143, no PR) reads `failed`; `endingAction` answers `leave`; with the unattended refusal lifted, `restartWorker` answers `worker-start`. A person's stop must be a recorded ending the restart reads.
- **The fixer start skips the per-desk continue lock** (safety): restart and the fresh session take `takeContinueLock` (`continuation.ts:854`); a fixer through `agent-run` takes none and writes no manifest, so a person's restart, this plan's restart, or #2901's unblocker can start a second writer. Append the attempt before the start; a failed append refuses it, as `beforeStart` does for the fresh session.
- **Collision with #2901** (seams): the `needs-a-person` marker this plan replaces is exactly what #2901's unblocker answers. Once both land, the unblocker continues the desk while this plan's fixer writes the branch. #2901 skips fleet-written markers (its own panel), and this plan names #2901.
- **"After both fail, the PR merges with the HIGH ticketed" is wrong for a red build** (safety): under the anti-goal a red build holds and notifies; it never takes the merge arm.

## Settled facts

- Open question 3's premise is wrong: the domain does not read `Claim stale after` (24 h; only `plot-reconcile-scan.sh:374` does). Use `ORPHANED_CLAIM_AGE_MS` (60 s, `rules/claim.ts:77`) with the `hasManifest` reading.
- `elsewhere` cannot arise: the tick reads only this machine's worktrees (`registryd.ts:660-663`).
- fleetd restarts in process through `fleet/src/shared/restart-command.ts` (`restartBranch`), not the board's HTTP route, and reuses `restartOffered` (which accepts `stalled`). `RESTART_ANSWER` says "A person restarted"; fleetd needs its own text.
- The refusal is at `dispatch-verbs.ts:194`; `dispatch.ts:42` is a comment.
- Once folded into `ending-action.ts` and `registryd.ts`, the two slices run in sequence.
- The plan never names #2899's run log, so the stall rule cannot see its starts.

## Shared blind spot

All four treat a dead desk as a mechanical failure to restart or fix. None asked why the desk died: the ending reasons that reach `needs-a-person` (spend-limit, permission-denied, unstarted) are mostly configuration or budget faults a fixer cannot clear, so the plan may automate a small population at the cost of a large table change. Count the endings on this estate before building the fixer arm.
