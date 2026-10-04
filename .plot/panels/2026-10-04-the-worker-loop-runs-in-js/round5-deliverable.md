# Round 5 — deliverable

Position: amend

## What I read

- `round4.md`, my `round4-deliverable.md`, the plan at `56c995c29`, and `the-shell-loop-holds-unlanded-work` at `56c995c29` (Approved since `fce2c87e6`, brief at `5890ee468`).
- `plot-plan-meta.sh` on both plans. Parent: exit 0, `format: canonical`, `phase: draft`, 6 waves of 1 branch each, each with `builds:`, `rounds: 4`, 6 Changelog lines, `unread_waits: []`, and the first branch carries `waits_on: ["infra/the-shell-loop-holds-unlanded-work"]`. Split plan: exit 0, `phase: approved`, one branch, a `Started` record.
- Code on `main`: `rules/desk-lifecycle.ts` (`deskState`, `EXITS`, `deskLifecycle`), `workflows/decision.ts` (`Write`, `Decision`), `adapters/performer/perform-fs.ts`, `entry/registryd-main.ts` (the supervisor's applier), `rules/queue.ts` (`prerequisiteAnswer`), `ports/refs.ts`, `ports/trees.ts`, `vitest.config` of the domain package, `ci.yml`'s systemd steps, and the loop's 30 test files.
- I ran no test suite.

## Round-4 findings

1. **`deskState` has no `none`.** Answered. The column is now "who acts next", and the test derives the state names through the rules. The new column has the same class of defect in three rows, so see new finding 1.
2. **No switch for the `js` test leg.** Partly answered. `PLOT_TEST_WORKER_LOOP`, read only by test helpers, is a decision a reviewer can check. "Test files that write no config get it from the shared sandbox helper" holds for `test/e2e` (`helpers.mjs`) but not for `test/reconcile`, which has no shared sandbox helper. Four files there write no config, source no shell body and import no helper: `charter-reaches-launch`, `claim-prefix-gate`, `refused-slice-record`, `session-id`. A brief can carry this, because the plan already says the brief lists the groups.
3. **Slice 7's removal list missed the sourcing files.** Answered by the `git grep` rule in slice 6. The rule itself cannot pass, so see new finding 2.
4. **Slice 1 had two outcomes and one Changelog.** Answered by the split. The parent has no #1246 Changelog line, and its first Changelog line says "In the JS loop".
5. **`performer`'s stated identity.** Answered. `performer` keeps its contract, and `boundedRun` is its own port.
6. **One citation drifted.** Answered. The plan holds no line numbers.

## New findings

1. **Rows 70, 72 and 73 name `continue`, and the rules answer `reap` for a desk that holds only its marker.** `deskState` returns `refused-empty` when `blockedMarker` holds and `markerRecordsWork` is false, and `EXITS['refused-empty']` is `copy-then-reap` to `.plot/state/refusals.tsv` (`desk-lifecycle.ts:166-168`, `:203`). A prompt that exits `unstarted` or `end-limited` has usually changed nothing, so its desk holds the marker and an empty claim commit (`fileChangingCommits` 0). The same is true of an agent that writes `PLOT-BLOCKED` before any work. The plan's own variant list includes "clean" and "marker", so slice 1's table test builds this reading and the rules answer differently. Under "a row the rules answer differently stops the branch", slice 1 stops on its own table again, as it did in rounds 3 and 4. The plan argues `markerRecordsWork` only for the spent-budget row. The approver needs the decision here, not the implementer: is a marker-only desk reaped with its refusal copied, as today, or answered by `/api/continue`? Amend: state the answer per variant for these three rows.

2. **Slice 6's done-criterion cannot pass on this repository.** `git grep -l` over the six terms, outside `docs/` and `*CHANGELOG.md`, lists 35 tracked files under `.plot/` today: 15 historical briefs and the panel verdicts, this panel's included. Slice 6's own brief will match too. None of them is code, and no slice says it edits them. Amend: add `.plot/` to the exclusions, for example `git grep -l … -- ':!docs' ':!.plot' ':!*CHANGELOG.md'`. `packages/board/.gitignore`, `build.mjs` and `package.json` also match, and those are real removals, so the rule is right to keep them.

3. **"Who acts next" has no rule for which of the four rules decides.** The test "derives that outcome through `agentState`, `deskState`, `deskLifecycle` and `supervise`". For row 65 (a free loop ends at `Worker bound`), the desk is clean, unclaimed and manifested, so `deskState` answers `orphaned` with `detach-then-reap`, while the column says `supervisor`. For rows 79 and 80, `deskLifecycle` names a person (`holding-work`, through `fileChangingCommits > 0`) and `supervise` answers for a dead worker as well. A reviewer cannot check "derives" without judgement while the precedence is unstated. Amend: one sentence that says how the four answers map to the column, for example "`deskLifecycle`'s exit decides, and `supervisor` means the exit is `re-read` or a reap that `supervise` follows".

4. **The loop's own write kinds do not fit the `Decision` form the plan cites.** `Decision.writes` is `readonly Write[]`, one shared union (`decision.ts:21-44`, `:381`). If `agentLoop` returns that `Decision`, the ten loop kinds join `Write`. Then `perform-fs.ts` throws "unrecognised write kind" at run time for each one unless it is added to `BEYOND_THE_FILESYSTEM` (`perform-fs.ts:54-69`, `:180-182`). That failure is not caught by `tsc`, and it contradicts "the supervisor's kinds stay the supervisor's". The other way is a separate `LoopWrite` union, which needs `Decision` to take a write type parameter. Only the second way gives "a kind without a performer fails `tsc`". The loop also adds `blocked-marker-write` beside the existing `blocked-marker` kind. Amend: decide which way, and say whether `blocked-marker` is reused or replaced.

5. **Slice 2 has no done-criterion, and its interpreter has no named home or coverage gate.** Slices 1 and 6 say "done when"; slice 2 does not. A workflow may not await a port (CLAUDE.md, "A note on shape"), so `performLoopWrites` lives in an adapter or in the board. The supervisor's applier, the only precedent, is in `entry/registryd-main.ts`. In the board, slice 3's coverage block is "scoped to the entry file" and does not exist yet when slice 2 merges. Under `adapters/`, the thresholds are explicitly not 100% (the domain `vitest.config` comment). Amend: name the package of `performLoopWrites` and the gate that measures it, and give slice 2 a done line.

6. **Slice 2's process-group test needs a loop that slice 3 builds, and `reexec` has no caller until slice 4.** "A test starts a loop and its prompt in one group" cannot start the JS loop in slice 2. The test can use a stand-in parent that calls `boundedRun`, which is a valid test of the port, but the plan should say so, and slice 3 should repeat the test with the real entry. `reexec`'s only caller is slice 4's restart, and its Node-version fallback is tested there, so the port moves to slice 4 with no loss. The systemd part is feasible: `ci.yml` already has a step that drives a user or system manager on `ubuntu-latest` for #1148, and slice 2 can extend it.

7. **The restart and memory-ceiling decisions have no named domain rule, and failure 5 has no table row.** The plan says the entry "decides nothing" and every decision sits in `workflows/` under the 100% gate. The first check, the four restart conditions and the 300 MB ceiling are decisions, but the table has no row for them, and slice 4 names no rule or file for them. Slice 1 promises "the five failures as table cases", and failure 5 (a process that keeps old code) can only be a case of the restart rule. Amend: name the restart rule in the domain (for example `rules/loop-restart.ts`), place it in slice 4 under the domain gate, and make slice 1 promise four failures.

8. **Slice 5 counts from a file the JS loop is not said to write, and kind 3 has no source.** The split plan makes the shell's `write_ending` append to `.plot/state/endings.jsonl`. No slice here says the JS loop appends there, and slice 5 reads kinds 1 to 3 "from `endings.jsonl` and the issues". Kind 3 is "a loop exit that held a slice and recorded no reason", which by definition writes no line to an ending file. The dispatcher's per-slug log, which records the wrapper's `clear` and `gone` lines and is not reaped with the desk, is a candidate source. Amend: slice 3 says the JS loop appends each ending to the same file in the same shape, and slice 5 names the source for kind 3, or records it as unmeasured, as the Baseline paragraph allows.

9. **Slice 3's ratchet sentence counts only the launcher.** The gate counts all shipped shell growth against the merge base. If the shell loop writes `loop: shell` into the manifest, that line counts too. The brief can carry this; "removes at least as many shell lines as the slice adds" is the checkable form.

## The split

- **It holds.** `rules/queue.ts` resolves a `waits:` by branch name against the merged listing (`prerequisiteAnswer`), so a branch of another plan is a valid prerequisite, as `2026-09-01-a-slice-can-wait-on-another-plan` decided. `plot-plan-meta.sh` reads the wait (`unread_waits: []`).
- **What the parent takes from the split:** `holding-work` in `EndingReasonSchema` (row 74), the actor `agent` admission for it, and `endings.jsonl` for the baseline. The split plan ships all three in its one slice.
- **No contradiction.** Both plans rewrite the doc comment on actor `agent`. The split writes it for `holding-work`, and the parent widens it for `blocked` and `checks-unanswered`. That is two edits in order, not a conflict. The parent's "When each fix reaches whom" says the split fixes #1246 before slice 1, which the `waits:` enforces.
- **One gap crosses the split**, finding 8: the file the split creates is written by the shell only, and the parent's slice 5 needs the JS loop to write it too.

## Slice 2 as one deliverable

From this lens, slice 2 is one deliverable once it has a done line (finding 5). Its contents share one property a reviewer can check: each new write kind reaches a port, and each port is tested on its own. The size problem is `reexec`, which is a slice-4 artifact with no caller in slice 2 (finding 6). With `reexec` moved, slice 2 holds `performLoopWrites`, `boundedRun`, `desk`, `refs.remoteTip` and the group test. That is checkable in one review. A further cut into "ports" and "group test" would leave `boundedRun` untested in the PR that adds it, so I would not cut it further.

## Reject?

No. Every finding is a decision to state or a line to move, and none changes the direction or the order of the slices. Findings 1 and 2 are the reason for `amend`: each one makes a slice's own done-criterion fail as written.

## What holds

- Both plans parse, the cross-plan `waits:` is read, and the slice order holds: each slice depends only on earlier ones and on the split branch.
- The Changelog lines map to slices: line 1 to slices 1 to 3 (it reaches users in slice 3), line 2 to slice 3, line 3 to slice 3, line 4 to slice 4, line 5 to slice 1 (and the entry's coverage to slice 3), line 6 to slices 5 and 6.
- Every rule and function the plan names exists on `main`: `resetRefusals`, `idleNow`, `loopRegistration`, `claimAnswer`, `refs.remoteHead`, `refs.branchTips`, `refs.contains`, `BuildPort.runForSha` (Actions, Jenkins, fixture adapters), `gateFailures`, `MAX_ATTEMPTS`, `endingIsAttributable`, `supervise`, `agentState`, `deskLifecycle`, `trees.list`, `clear_manifest_branch`.
- Rows 79 and 80 read `person` through `deskLifecycle` for a desk with pushed work, because `fileChangingCommits > 0` gives `holding-work`, whose exit is `person`.
- The slice-6 grep rule replaces round 4's hand list and catches the sourcing test files and `corpus/production.ts`. Only its exclusions are wrong (finding 2).
- No slice before slice 3 touches shipped shell, so slices 1 and 2 pass the shell ratchet without arithmetic.
