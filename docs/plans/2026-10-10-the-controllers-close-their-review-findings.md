# The controllers close their review findings

> The approve, deliver, dispatch and merge controllers fix the review findings that did not hold their merges: the approval asks the domain before it merges, the lifecycle entries write through a port, the implement lock survives a process boundary, and the merge controller refuses what it cannot read.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-gates-and-the-review-findings
- **Issue:** #1447, #1458, #1483
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-approve.mjs` asks the domain's `approve` workflow before it merges a plan PR, so the phase and review-channel refusals come from one rule, and its tests prove that the merge is pinned to the head the approval read.
- The approve and deliver entries write the plan, the `.plot/hold` file and the sprint file through a port instead of `node:fs`, and resolve the main checkout through an adapter.
- `plot-dispatch-command.mjs` refuses a second dispatch of a plan whose `/plot-implement` run is still alive in another process, and returns once the implement has started instead of when it ends.
- `plot-ask.mjs merge` refuses when the default-branch reading cannot be read or is older than `Checks wait`, and its argument handling has tests.

<!-- Board impact: none on the plan format, the template or docs/plans. The board package changes in `entry/approve.ts`, `entry/deliver.ts`, `entry/merge.ts`, `entry/main.ts`, `server/implement.ts` and `server/dispatch.ts`; each slice rebuilds the bundles it touches for local tests only and commits no bundle. -->

## Motivation

Three review passes left 21 findings open as issues: #1447 (2 medium, 4 low) on #1446 `approval-becomes-a-command`, #1458 (3 medium, 5 low) on #1457 `the-controllers-are-commands`, and #1483 (2 medium, 5 low) on #1482 `a-merge-is-a-controller`. None held its merge. Measured on `origin/main` at `c9d63311d` (2026-10-10), 20 still hold.

Two of them break the rules this repo states in `CLAUDE.md`:

- *The Layering Rule* says an adapter is the only place that reaches the world. `packages/board/src/server/entry/approve.ts:25` imports `writeFileSync`, `appendFileSync`, `readdirSync` and `readFileSync` from `node:fs` and writes the plan at `:285` and `:292`, the hold file at `:302` and the sprint file at `:323`. `deliver.ts` writes at `:363`, `:372`, `:408`, `:482` and `:696`. `scripts/check-script-names.sh:142-143` names the gap: *"`plan-store` reads only"*.
- *The Master Agent Uses The Controllers* says a refusal names a real route. `skills/plot/scripts/plot-controller-gate.sh:302-306` refuses a direct `plot-approve.mjs` call and then names `node …/board/plot-approve.mjs <slug>` as the route — the same command it just refused. `packages/domain/src/rules/ci-suite.ts:148-155` lists that bundle in `GATED`, and `test/reconcile/controller-gate.test.mjs:132` asserts the refusal. Since 2026-10-10 `the-gates-are-launchers` fixes this finding (see *Findings moved* below).

The other findings are the same kind at smaller scale: a rule repeated outside the domain, a lock that one process cannot see in another, and tests that pass when the line they guard is reverted.

## Design

### Approach

**Every slice is its own wave**, so no two slices run in parallel. The order puts the two slices that both edit `entry/approve.ts` first and second. No slice edits `plot-controller-gate.sh` or `rules/ci-suite.ts`: `the-gates-are-launchers` rewrites both files and carries every controller-gate finding (#1341, #1449, #1458 M1, #1458 L1, #1483 L5).

**The layering rule decides where each fix goes.** A rule moves into or is read from `packages/domain`; a file or process access moves behind a port with an adapter; the entry keeps only argument parsing, the `PLOT_UNATTENDED` check and the mapping of a refusal code to its sentence.

**One rule exists with no production caller.** `packages/domain/src/workflows/approve.ts:143` decides the pre-merge refusals (`state-terminal`, `state-wrong`, `review-human`, `reviewer-undeclared`, `review-unrecognised`, `slice-unnamed`, `pr-closed`, `pr-absent`), and only `packages/domain/test/workflows-approve.test.ts` and `transitions.test.ts` import it. The entry repeats the same decisions in two `switch` statements at `approve.ts:457-469` and `:475-492`. Slice 1 calls the workflow and deletes the switches; it adds no new rule.

**Findings per slice, each checked on `c9d63311d`:**

| Finding | Holds at | Slice |
|---|---|---|
| #1447 M2 — phase and channel rules repeated in the entry | `approve.ts:457-492`; `workflows/approve.ts` has no `src/` caller | The approval asks the domain |
| #1483 M1 — no test proves approve passes its head | stub `approve-entry.test.mjs:69-73` returns no `headRefOid`; pin at `approve.ts:558` | The approval asks the domain |
| #1447 M1 — plan, hold and sprint written with `node:fs` | `approve.ts:285,292,302,323`; `deliver.ts:363,372,408,482,696`; `PlanStore` (`ports/plan-store.ts:94-124`) has four reads and no write | The entries write through a port |
| #1447 L1 — `.git` parsed by hand | `commonDirOf` `approve.ts:340`, `mainRootOf` `:355`, `excludeDeskRoot` `:366` (root `.gitignore` only, no `git check-ignore`) | The entries write through a port |
| #1447 L2 — a receipt keyed by path permits one hand commit | `skills/plot/scripts/README.md:31` and `:32` do not say so | The entries write through a port |
| #1447 L3 — all of `trees-git.ts` exempt from the fetch check | `packages/board/test/unit/no-network.test.ts:94` | The entries write through a port |
| #1447 L4 — TSDoc narrates history | `packages/domain/src/rules/sprint-annotation.ts:7` | The entries write through a port |
| #1458 M2 — the implement lock is a process-local `Set` | `packages/fleet/src/shared/implement-run.ts:138-142`, `:204`, `:229` | The implement lock lives on disk |
| #1458 M3 — the dispatch command blocks for the implement run | `packages/fleet/src/server/entry/dispatch-command.ts:104` awaits `started.ended` | The implement lock lives on disk |
| #1458 L2 — `briefBranchFromPulse` duplicates `nextBriefBranch` | `packages/fleet/src/shared/dispatch-command.ts:74-75`; `packages/board/src/server/implement.ts:78-82` | The implement lock lives on disk |
| #1458 L3 — `function` declarations and a link to a board-only symbol | `implement-run.ts:35,48,101,141`; `{@link implementStatus}` at `:44`, `:153` | The implement lock lives on disk |
| #1458 L4 — no continue test with a `PLOT-BLOCKED` desk | `packages/fleet/test/unit/continue-command.test.ts` has 5 tests and none names `PLOT-BLOCKED`; `dispatch-command.test.ts:65,76,86` inject `pulse: () => null` | The implement lock lives on disk |
| #1483 M2 — the moved-head fixture fails without the pin | `test/reconcile/host.test.mjs:418-424` sets `ghFail` for every call | The merge reads what it claims |
| #1483 L1 — `checks-unbound` has no producer | `workflows/merge.ts:85`; `plot-host.sh:3577` sets `checksSha` to `headRefOid` | The merge reads what it claims |
| #1483 L2 — a failed default-branch read merges | `packages/board/src/server/entry/merge.ts:38` reads `reading.ok ? reading.value : null` | The merge reads what it claims |
| #1483 L3 — no `plot-ask.mjs merge` argv test | `packages/board/src/server/entry/main.ts:144-149`; `merge-entry.test.ts` tests `mergeAt` only | The merge reads what it claims |
| #1483 L4 — the `CLAUDE.md` paragraph contradicts itself | `CLAUDE.md:499`, `AGENTS.md:499` | The merge reads what it claims |
| #1458 M1 — the gate names a route it refuses | `plot-controller-gate.sh:302-306` | moved to `the-gates-are-launchers` |
| #1458 L1 — the release hint omits `version` | `plot-controller-gate.sh:307` | moved to `the-gates-are-launchers` |
| #1483 L5 — nothing stops an unpinned `gh pr merge` | `plot-controller-gate.sh:38-41` | moved to `the-gates-are-launchers` |

**One finding is no longer actionable.** #1458 L5 (the changeset bumps `plot-dispatch: minor` with no file under `skills/plot-dispatch/` changed, and the PR body lists no HTTP-only routes): `release: 2.25.0 (#1411)`, commit `63f47da14`, consumed `.changeset/the-controllers-are-commands.md`, and #1457 is merged. No finding was fixed by a later commit; `git log` on `implement-run.ts` and `entry/dispatch-command.ts` shows only `a16ff26eb` (#1457), and on `entry/merge.ts` and `workflows/merge.ts` only `95356fc3e` (#1482).

**The approval asks the domain.** `approve.ts` builds `ApproveReadings` from the plan record and the PR it already reads, calls `approve` from `workflows/approve.ts` before `pr-ready` and `pr-merge`, and maps each `ApproveRefusal` to the sentence the switch prints today, so every existing refusal test keeps its text. The `PLOT_UNATTENDED` refusal for `Review: in-session` stays in the entry, because it reads the environment. The `approve-entry.test.mjs` stub at `:69-73` returns `headRefOid`, and a new test asserts that the merge call carries `--match-head-commit` with the 40-character sha; reverting `approve.ts:558` fails it.

**The entries write through a port.** `PlanStore` gains one write for a repository-relative file (the plan, the sprint file and `.plot/hold`) and the directory listing that `findPlanFile` (`approve.ts:136`, `deliver.ts:171`) and `annotateSprint` (`approve.ts:311`, `deliver.ts:475`) use. Its adapter writes to a temporary name and renames, the way `pr-index-file.ts:140` does. `Trees` gains the main checkout's root and a local ignore of a desk root, implemented with `git rev-parse --git-common-dir` and `git check-ignore`, which replace `commonDirOf`, `mainRootOf` and `excludeDeskRoot`. The two README rows state that a completed approval or delivery leaves a receipt keyed by the plan's path in the caller's checkout, and that the receipt permits one commit of the same `State:` value on that path. `no-network.test.ts:94` exempts only the `fetch` method body of `trees-git.ts`. `sprint-annotation.ts:7` states what the function does and drops the history.

**The implement lock lives on disk.** `implementRunning(repoRoot, slug)` reads the implement state file that `startImplement` already writes (`running <pid>`), and answers `true` only where that pid is alive; a dead pid reads as not running, so a crashed run does not hold the plan forever. `startImplement` takes the lock with an exclusive create (`O_EXCL`) before it truncates the log, so two processes started 0.5 s apart cannot both pass. `plot-dispatch-command.mjs` starts the implement and the follow-up dispatch in one detached process, and exits 0 once the state file reads `running <pid>`; a caller with a 120 s tool timeout no longer kills the implement. The board calls the fleet's `briefBranchFromPulse` and deletes `nextBriefBranch`. The four declarations become arrows, and the TSDoc links name fleet symbols only. A test runs `plot-continue-command` against a desk holding `PLOT-BLOCKED` with the default `bridgedPulse` and asserts that a new pid starts.

**The merge reads what it claims.** `mergeAt` refuses `unaskable` where the default-branch port answers `failed` (EACCES, EIO); a missing, unparseable or other-version file still reads as `null` and holds nothing, as *A Decision Reads The Index* states for that file. `merge` also reads the reading's `at` and treats a reading older than `Checks wait` (the existing config key, 3600 s in this repository) as no reading, so a days-old green cannot permit a merge. No new config key is added. The fleet's hold in `the-channel-closes-its-review-findings` (slice 1, #1463 M1) uses the same bound, and one value in `rules/default-branch.ts` serves both callers. The `host.test.mjs` fixture fails the merge only when `--match-head-commit` names a sha other than the stub's head. `workflows/merge.ts` states in TSDoc that no adapter emits a `checksSha` other than the head today, so `checks-unbound` is a domain guard with no live producer. `main.ts` refuses a `<sha>` that is not 40 hexadecimal characters, and a test covers `merge`, `merge 7`, `merge abc deadbeef` and a short sha, each exit 2. `CLAUDE.md` line 499 states one count of board-free actions and drops *"no lifecycle action"* for `plot-ask.mjs`, because `plot-ask.mjs merge` is one (#1483 L4); `./scripts/check-agents-md.sh --write` regenerates `AGENTS.md`.

**Findings moved.** On 2026-10-10 jwloka moved #1458 M1 (the refusal names a route the gate refuses), #1458 L1 (the release hint omits `version`) and #1483 L5 (nothing stops an unpinned `gh pr merge`) into the controller-gate slice of `the-gates-are-launchers` (`feature/the-controller-gate-is-a-launcher`). Those three edit `plot-controller-gate.sh` and `rules/ci-suite.ts`, which that slice rewrites. #1483 L4 does not touch either file and stays here, in *The merge reads what it claims*.

**Manifesto checklist.** The plan adds no config key and no hardcoded project name; it moves decisions into the domain (scripts collect, skills interpret); every refusal still names its route; the plan adds no gate; the unpinned-merge refusal moved to `the-gates-are-launchers`.

### Open Questions

- [x] **Overlap with `the-gates-are-launchers`.** That plan takes #1341 and #1449, and both edit `plot-controller-gate.sh` and `ci-suite.ts`. The last slice here edited the same two files. Should it carry a `waits:` annotation on that plan's gate branch once the branch is named, or should #1458 M1, #1458 L1 and #1483 L5 move into that plan? **Answer:** the three findings move into that plan's `feature/the-controller-gate-is-a-launcher` slice; this plan drops `bug/the-gate-names-a-route`, and #1483 L4 joins *The merge reads what it claims* (jwloka, 2026-10-10).
- [x] **The bound for a default-branch reading's age.** #1463 M1 asks the fleet's hold for the same bound. One value in `rules/default-branch.ts` serves both callers; which value — `Checks wait` (3600 s) or a new key? **Answer:** `Checks wait`; a reading older than it counts as no reading, for the merge controller and the fleet's hold, and no new key is added (jwloka, 2026-10-10).
- [ ] **The `PlanStore` write's scope.** The hold file `.plot/hold` is not a plan. Does it belong on `PlanStore`, or on a separate port the approve and dispatch entries share?

## Slices

### The approval asks the domain

- `bug/the-approval-asks-the-domain` — `plot-approve.mjs` calls `workflows/approve.ts`'s `approve` before it merges and maps each refusal code to today's sentence; the test stub returns `headRefOid` and asserts the pinned merge (#1447 M2, #1483 M1) <!-- builds: the first production caller of workflows/approve.ts -->

### The entries write through a port

- `bug/the-entries-write-through-a-port` — the approve and deliver entries write the plan, hold and sprint files through a `PlanStore` write and resolve the main checkout through `Trees`; README rows state the receipt scope; the fetch exemption narrows to one method (#1447 M1, L1–L4) <!-- builds: a PlanStore write and a Trees main-root reading -->

### The implement lock lives on disk

- `bug/the-implement-lock-lives-on-disk` — `implementRunning` reads the implement state file and an exclusive create takes the lock; `plot-dispatch-command.mjs` returns once the detached implement has started; the board calls `briefBranchFromPulse`; a `PLOT-BLOCKED` continue test (#1458 M2, M3, L2–L4) <!-- builds: a cross-process implement lock -->

### The merge reads what it claims

- `bug/the-merge-reads-what-it-claims` — `mergeAt` refuses a failed default-branch read and a reading older than `Checks wait`; the moved-head fixture rejects only an unmatched pin; `plot-ask.mjs merge` checks its sha and has argv tests; the `CLAUDE.md` paragraph states one count of board-free actions (#1483 M2, L1–L4) <!-- builds: a failed-read and aged-reading refusal in mergeAt -->

## Notes

- Drafted 2026-10-10 unattended from #1447, #1458 and #1483. Out of scope: #1341, #1449, #1458 M1, #1458 L1 and #1483 L5 (`the-gates-are-launchers`), #1493 (fixed separately), #1463 (the fleet's default-branch hold).
- 2026-10-10: jwloka answered Open Questions 1 and 2. Slice `bug/the-gate-names-a-route` is removed; the plan holds four slices.
- Deliverable search (`plot-deliverable-search.sh`): `writePlan` — no hit; `excludeDeskRoot`, `mainRootOf` — `approve.ts:355,366` only (replaced by this plan); `implementRunning` — `implement-run.ts:141`, read by `board/server/implement.ts:12` and `fleet/shared/dispatch-command.ts:101` (changed, not duplicated); `briefBranchFromPulse` — `fleet/shared/dispatch-command.ts:74` (kept, `nextBriefBranch` removed); `ApproveRefusal` — `workflows/approve.ts:15` (called, not duplicated); `readingAge` — `entities/identity.ts:102`, a candidate helper for the age check.
- Line numbers in #1447 and #1458 predate later commits; the table above cites `c9d63311d`.
- Each slice adds a changeset for `plot` with the description first and the `bumps:` block last.
