---
'@plot-pm/board': minor
---

The six lifecycles `check-state-declarations.sh` found the day it shipped each carry the rule their declaration promised: `transitions/branch.ts`, `worker.ts`, `sprint.ts`, `release.ts`, `pr.ts` and `build.ts`. `LIFECYCLE_DEBT` goes 6 → 0, which turns the ratchet into the gate it was written to become — a lifecycle declared from here needs its rule in the same change.

They are done in the order a wrong answer costs most. `branch` and `worker` are read by the fleet on every dispatch and reap, so they come first; `sprint` and `release` are read at a release gate; `pr` and `build` are readings the host owns.

`transitions/branch.ts` states in one place a question the shell asks twice. Measured 2026-09-06, `plot-reap.sh` and `plot-release-refs.sh` ask about the same branch and each is blind to a guard the other applies — release-refs never asks about a live pid, reap never asks `pr_open`. `rules/reapable.ts` is untouched: it answers whether a re-creatable WORKTREE may be removed, while `refProblems` answers whether a REMOTE REF may be deleted, which is not undoable.

`transitions/worker.ts` declares no second move graph. `entities/fleet.ts:122` already states that the scan's eight are the Agent's eight and that the rule they want is `transitions/agent.ts`; `workerStateSource` reads that file's `STATE_SOURCE` rather than restating it. What it adds is the process half — `exit-code-cannot-decide` refuses a task state read from an exit code, because every worker exits 0.

`observePrState` makes one remembered contradiction refusable: a merged pull request reports `CLOSED`, so that pair refuses with the merge date in the message rather than passing as a legal `OPEN → CLOSED` and losing the landing in a word.

<!--
plan: docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md
-->
