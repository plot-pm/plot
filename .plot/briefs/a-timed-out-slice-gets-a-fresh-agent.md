## Implementation brief — no-controller-resumes-a-claimed-slice (wave 3: A timed-out slice gets a fresh agent)

- **Plan (canonical):** `docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-timed-out-slice-gets-a-fresh-agent` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issues #1420, #1409

Both earlier waves merged on 2026-10-09: `bug/a-working-desk-never-reads-free` (#1429) and `feature/a-time-out-writes-its-ending` (#1431). Nothing waits on this branch.

### What to build

On 2026-10-09 the agent on `feature/the-fleet-package-exists` ended with exit 124 and left one unpushed commit and 50 uncommitted files at its desk. The board read "worker crashed — exited 124". The supervisor did nothing, and a master session committed the tree by hand. After that, `POST /api/dispatch` answered `dispatched=0` (the slice reads as claimed), `POST /api/continue` answered `no-question` (no `PLOT-BLOCKED` marker), and `releaseClaim` was not called because it would send a fresh dispatch back to the default branch.

Wave 2 settled that every exit-124 path already writes an ending (`bound`, `unreadable`, or `quiet`). The ending exists; nothing acts on it. `endingAction` (`packages/domain/src/rules/ending-action.ts`, `endingTableAnswer`) answers `leave` for `bound` and `unreadable` because no row names them. Build the rows, in this order:

1. **The `bound` and `unreadable` rows in `endingAction`**, per the plan's table: a first time-out on a branch with a commit beyond the claim, an open PR, or a dirty tree answers `start-fresh`; a branch with none of the three answers `release-claim`; after one fresh session it answers `needs-a-person`. `unreadable` shares the `bound` row (the plan's Open Questions leave this to be confirmed in review; the work on the desk is the same).
2. **Join the shared fresh-session count.** `bound` and `unreadable` draw on the same `priorFreshSessions` as `corrections-spent`, `turn-limit` and an after-prompt `holding-work`. Update `FRESH_SESSION_ENDINGS` or add a parallel set. Whichever you choose, `endingAsksFreshStart` (same file, read by `continueOnDesk` at `packages/fleet/src/shared/continuation.ts:630`) must name `bound` and `unreadable` too, or the registry's fresh start is refused `no-question`.
3. **A composer for the fresh agent's answer**, in the family of `holdingWorkAnswer`: commit, check and push what the timed-out agent left, name the held files, then continue the slice. `needsPersonMarker` and `secondFreshSessionMarker` take `bound` and `unreadable` for the second time-out.
4. **The registry tick reads the real branch facts for this ending.** See the second decision below; this is where the slice can go wrong.

### Settled decisions — do not re-derive them

- **A dirty tree needs its own reading in `EndingActionReadings`.** Today the rule has `commitBeyondClaim` and `prOpen`, and the fresh-agent step passes filler (`commitBeyondClaim: 'no'`, `prOpen: false`, `registryd.ts:863-873`) because none of its endings read them. The 2026-10-09 desk held a commit and 50 dirty files; a branch with only a dirty tree and no commit must still answer `start-fresh`, so the rule needs a third reading (`Trees.dirtyPaths`, which the fresh-agent step already reads as `heldFiles`). Model it like `commitBeyondClaim`: three values, and `'unanswerable'` takes the arm that protects the work (`start-fresh`), never `release-claim`. An unreadable tree is not a clean tree.
- **Filler readings are the trap.** `nothingDoneDecisions` and `freshAgentDecisions` both call `endingAction` for the same desks (`nothingDoneCandidateTrees` and `freshAgentCandidateTrees` are the same filter). If the fresh-agent step keeps its filler `'no'`/`false` while a `bound` row answers `release-claim` on "nothing beyond the claim", a timed-out desk full of work is read as empty and its claim released. Give the fresh-agent step the real readings for `bound` and `unreadable`, or keep `release-claim` for these endings in the nothing-done step alone. Either way one desk gets one verdict per tick, and a test must prove the fresh-agent step cannot release a claim on filler. `releaseClaim` also refuses unpushed or dirty desk work (`registryd.ts` docblock on `applyNothingDoneDecisions`), but that is a backstop. The decision belongs to the rule.
- **`quiet` stays `leave`.** The 09:27 case itself ended `quiet`/`monitor` and its cause was fixed by #1429. The plan names `bound` and `unreadable` only, and its Open Questions do not ask for `quiet`. Do not widen the table. If you think `quiet` earns a row, report it in the PR description and leave it.
- **The fresh agent does not get a shorter or longer bound.** `Worker bound` stays 28800 s for the fresh session (plan Open Question, kept unchanged).
- **A manifest-named desk answers `leave` for every ending**, `bound` included. The ending and the manifest's removal are not one atomic write, and a second start would put two agents in one worktree.
- **One fresh session per slice, whichever ending asked first.** A slice that spent its fresh session on `holding-work` and then times out gets `needs-a-person`, not a second agent. A per-ending counter would pass every single-ending test.
- **The second time-out asks through the existing path**: `needs-a-person` writes a `PLOT-BLOCKED.md` marker once (`escalate: verdict === 'needs-a-person' && !escalated`), records the ask, and `endingAsked` turns a repeat into `leave`. Do not build a second escalation.
- **The rule stays pure.** It reads the ending and the readings and no disk, so a restarted supervisor reaches the same action from the same files. A failed or missing count reads as zero fresh sessions and never as "already had one". Absent is not false.
- **`prMerged`.** `bound` is not one of the five outright `needs-a-person` endings, so the tick does not need to ask the host whether the PR merged for it. A merged branch whose desk still holds a `bound` ending is the one case to think through: do not start a fresh agent on a merged slice. Read `readFreshAgentCandidates` (`prMerged` is `'unanswerable'` for non-outright endings today) and decide with a test, naming the choice in the PR.

### Done when

The plan's `## Done when` list is the specification. Two bullets belong to this branch: the `endingAction` table for `bound` and `unreadable`, and the registry tick starting one fresh agent whose answer names the held files with `continueOnDesk` not refusing it `no-question`. The first wave's bullet (every exit-124 path writes an ending) is already met.

Assertions that exist because a naive implementation passes without them:

- **Dirty tree and no commit answers `start-fresh`.** A row that reads only `commitBeyondClaim` and `prOpen` passes the commit case and releases the claim on the 50-file case.
- **A branch with nothing beyond the claim answers `release-claim`, and `'unanswerable'` on any of the three readings does not.** Catches the destructive direction on a failed read.
- **The fresh-agent step cannot release a claim from filler readings.** Run a `bound` desk with held files through the tick and assert a start and no release.
- **`holding-work` or `corrections-spent`, then `bound`, answers `needs-a-person`.** Catches a per-ending counter.
- **`endingAsksFreshStart` answers true for `bound` and `unreadable` on the ending's own branch and false for another branch.** Without it the tick's start is refused `no-question` and the unit tests of the rule still pass. Assert through `continueOnDesk`, not only the rule.
- **The fresh agent's answer contains each held path**, and an unreadable listing says so instead of listing nothing. A fixed text passes "starts a fresh agent" and fails the 2026-10-09 complaint.
- **A manifest-named desk answers `leave` for `bound`.**
- **A second tick on the same ending starts no third agent and writes no second marker.**

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `test:e2e` locally. New domain code is arrow functions with factual TSDoc (behaviour only, history in the commit message); the domain imports `zod` and nothing else outside `adapters/`. Add a changeset: description first, the `bumps:` block last, the `plan:` line inside the comment block and never first. A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, and set the PR to "Ready" if a project board is configured. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ending-action.ts` and `packages/domain/test/rules-ending-action.test.ts`; in `packages/fleet`, `src/server/entry/registryd.ts`, `src/server/entry/registryd-main.ts` (the two tick steps) and `src/shared/continuation.ts` (only the `endingAsksFreshStart` caller, if it needs a change), with `test/unit/fresh-agent-tick.test.ts` and `test/unit/nothing-done-tick.test.ts`. `agent-loop.ts`, `worker-loop.ts` and `entities/ending.ts` are read-only: the endings they write are waves 1 and 2's.

Branches in flight, verified 2026-10-09 with `git ls-remote --heads origin`: `feature/a-merged-pending-check-is-asked-again`, `feature/the-reaper-becomes-a-command`, `feature/the-row-shows-the-brief-writer` and `feature/the-supervisor-is-plot-fleetd`, none named by this plan. Check each one's diff against `registryd.ts`, `registryd-main.ts` and `ending-action.ts` before the PR (`the-supervisor-is-plot-fleetd` is the likeliest to touch the registry entry), and rebase onto `main`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
