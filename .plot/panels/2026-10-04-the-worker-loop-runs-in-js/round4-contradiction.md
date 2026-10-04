# Round 4 — contradiction

## What I read

- Read in full: the plan at `547816537` (276 lines), `round3.md`, `round3-contradiction.md`.
- Read in part: `rules/task.ts:36-93`, `rules/agent-state.ts:120-143`, `rules/desk-lifecycle.ts:75-215`, `rules/supervision.ts:40-75`, `:120-175`, `:198-310`, `entities/ending.ts:90-100`, `ports/refs.ts:470-490`, `ports/performer.ts:1-30`, the `ports/` listing, `adapters/refs/refs-git.ts` (ancestry declarations), `continue.ts:325-450`, `ci.yml:312-318` and every `runs-on`, `plot-release-gate.sh:28-34`, `plot-reap.sh:140-148`, `plot-dispatch.sh:1845-1869` (Read tool), and in `plot-worker-loop.sh`: `:225-232`, `:396-402`, `:738`, `:760`, `:795-802`, `:1065`, `:1732-1790`, `:2322-2330`, `:2480-2545`, `:2612-2632`, `:2730-2900`, `:2960-3005`.
- Ran no test. I made no change except this file.

## Round-3 findings

1. **`agentState` column where a PR exists: answered for the rows round 3 named, not answered for two others.** Rows 74/75 split by PR, rows 69/70/77/81/82 give `finished` with a PR, and line 61 states the two rules' orders correctly (`task.ts:88`, `desk-lifecycle.ts:161-168`). Rows 71 and 73 still say `failed` without a PR split (new finding 2).
2. **The marker reasoning: answered.** Line 86 reads `markerRecordsWork` as presence, which matches `desk-lifecycle.ts:101-110`. The blocked row's cell reads "by the desk".
3. **The CI wait settling on a foreign tip: answered.** The wait now compares the remote tip with the pushed commit by equality (line 94), so #1199's `0e64fafd` ends the wait and no foreign build spends the correction budget. Two gaps remain in the new text (new findings 3 and 4).
4. **The restart's process reach: partly answered.** The port table now names `refs.contains` (`ports/refs.ts:483`, which exists), `performer.runBounded` for the self-check, and a new `adapters/process-exec.ts`. The port behind `process-exec.ts` has no name ("behind a domain port", line 114), and `runBounded` contradicts the `Performer` port's own contract (new finding 5).
5. **Slice 7's corpus half: answered.** Line 219 keeps `corpus/agent-state.corpus.test.ts` with `plot-worker-state.sh`.
6. **The restart's ancestry kind: answered.** Line 128 declares it `plot-ancestry: evidence`, and the refs adapter already carries `evidence` declarations (`refs-git.ts:264`, `:503`, `:558`).

## New findings

1. **"Two endings change from today" (line 57) contradicts the plan's own table.** The shell loop ends neither a marker desk nor an expired wait today. After `wait_for_checks` returns, on any verdict (`plot-worker-loop.sh:1784-1789`, it always returns 0), the loop seals, records spend, clears the branch (`:2859-2884`) and enters the free wait. An agent-written marker leads to the same free wait, and that is the path to #1250's exit 124. So rows 74 and 75 (`blocked`, 0) and row 82 (`checks-unanswered`, 0, loop ends) also change today's behaviour: today the loop stays alive and goes free. Row 82 is the largest change, because the JS loop ends an agent that today goes on to the next slice. The rows carry no "(today: …)" note, unlike rows 66 and 81. The plan must list at least four changed endings (bound, spent budget, marker, unanswered wait), plus slice 1's `holding-work`, and give each row its "today" cell.

2. **Rows 71 and 73 drop a write the shell makes and keep the flat `failed`.** Today `end-limited` and the spent start retry both write a `PLOT-BLOCKED` marker before `exit 1` (`plot-worker-loop.sh:2739`, `:2763`). The table's Decision column for both rows names no `blocked-marker`. If the JS loop follows the table, these desks have no marker, so `/api/continue` refuses them (`continue.ts:446-450`) and `deskState` reads `holding-work` or `finished` instead of `refused-*`. That contradicts line 226 ("the `PLOT-BLOCKED` … files keep their names and formats"), because the file stops being written. Both rows also say `failed` flat, but a correction runs through `agent-resume` and can exit `unstarted` or `limited` beside an open PR. Then `agentState` returns `taskState`, which answers `finished` (`agent-state.ts:143`, `task.ts:88`). Line 59 says "by desk" cells are asserted with and without a PR, so the table test fails on these two rows as written. Add `blocked-marker` to both Decision cells and split the agent column by PR.

3. **The deskState "none" cells (rows 65, 66, 67, 79) name no state `deskState` can return.** `DeskState` has seven values and no `none` (`desk-lifecycle.ts:23-30`). Line 59 says the test asserts both columns "through the two rules themselves", and line 84 says `deskState` reads `working` for any desk with a live worker (`:158`). A free loop waits on its reset desk, so rows 65 and 79 read `working` from the rule. The plan must say either that a free desk is outside `deskState`'s input (and the test does not call it for these rows) or give the value the rule returns.

4. **An unreadable remote tip has no row, and equality reads it as a moved tip.** Line 94 ends the wait on "a tip that differs from the pushed commit", and slice 1 says the same for the shell (line 149). A failed `git ls-remote` gives no tip, and an empty answer differs from every commit. Today `head_is_pushed` returns 1 on an unreadable fetch (`plot-worker-loop.sh:1733-1736`), which skips the wait before it starts; it is called once, not per poll (`:1774`). The plan states "a connector that cannot answer reads `unknown`" for the build, and `task.ts`'s docstring states the estate's rule: "A failure to observe is not evidence of something to see." The plan must say that an unreadable tip continues the wait (inside `Checks wait`) and is not a moved branch, in both slice 1 and the table.

5. **`runBounded` on `performer` contradicts that port's contract.** `ports/performer.ts:12-16` defines `Performer` as the port that "starts detached processes that outlive the caller". `runBounded` starts a prompt that must not be detached and must die with the loop (line 121, slice 3), and a self-check child that lives 10 s. Adding both to `Performer` changes the port's meaning. The plan must name a different port for bounded children, or say that slice 3 rewrites `Performer`'s contract. The `process-exec.ts` port also needs a name (round-3 finding 4).

6. **The supervisor decides on a `holding-work` desk before a person does.** Line 84 and the Changelog (line 16) say the board names a person for a `holding-work` desk. `supervise` reads no ending and no marker. For a dead agent it reads only the declaration and the gates (`supervision.ts:274-281`). A `holding-work` loop ends before `seal_declaration` runs (`plot-worker-loop.sh:2859` comes after the wait), so the declaration is absent. That counts as a failure, and while `attempts < MAX_ATTEMPTS` the verdict is a retry, not `needs-a-person` (`:296-304`). The same holds for the JS `blocked` ending unless that ending also writes a `blocked` declaration. The plan must say what `supervise` answers for each of the three new endings, and whether the loop writes a `blocked` declaration with them.

7. **The CI wait's exception to "A Decision Reads The Index" covers the build and not the PR.** Rows 75, 77, 78 and 81 decide on "a PR open". Today that is a host call per finished prompt (`pr_is_open`, `plot-worker-loop.sh:1742-1744`). Line 98 declares only `BuildPort` calls and the tip read. `pr-state` is also a non-terminal host answer, so either the exception names it too, or the loop reads `MERGED` from the index and asks the host for the rest, as CLAUDE.md's terminal-answer rule describes.

## Which claims belong in a brief, and which the plan must keep

**The plan keeps the claims that a decision depends on**:
- The state table with its "today" cells. Approval decides behaviour changes, so each changed row must say what it changes (findings 1 to 3).
- The ending vocabulary (line 55) and its admission in `endingIsAttributable`.
- The three counts (line 92).
- The CI-wait rule: equality, the unreadable case, and the declared index exception (line 94 and line 98, with findings 4 and 7).
- The process-group decision (line 121). It needs no line numbers.
- The four restart conditions and the ancestry kind (lines 126-129).
- The port *names* each write goes to (the table at lines 106-117), without starting points.
- What the supervisor does with the new endings (finding 6).

None of these needs a line number. Each can name a rule or function (`taskState`, `deskState`, `markerRecordsWork`, `supervise`, `checksVerdict`) instead of `file:line`.

**A slice's brief carries the claims an implementer checks against the code of that day:**
- Every `plot-worker-loop.sh:NNNN` citation, about 20 of them. Examples: lines 57, 88 and 90, and slice 1's `:738`. The file changes daily (+287 lines in three days, line 35), and two of this round's checks were already a few lines off. Example: the free-wait end sits near `:2496-2506`, not `:2486-2489`.
- The "Starting point" column of the port table (line 106 onward).
- Slice 4's test inventory: the 7 source-text assertions with their lines, and the "10 files" count (line 177-178).
- Slice 7's removal list with line counts (lines 208-217), and the ~1,120 figure (line 140). The ratchet measures these at merge time.
- The `deskreset.test.mjs:98-100`/`:118-124` and `ci.yml:316` citations, the 408-502 s timings, and the `contract/schema.ts:3451` / `findings.ts:42` board-impact citations.
- Motivation's counts (lines 29-33). These are dated measurements and can stay as dated, but no decision in the plan reads them.

The rule for the moderator: a claim stays in the plan when an approver would decide differently if it were false. A claim moves to the brief when only the implementer would act differently.

## Should anything stop the plan

No. None of the findings contradicts the plan's direction. Each is a missing cell, a wrong port, or an unstated reading, and each can be fixed in the plan. The size is the risk. Seven slices tied to one approval keep growing the review surface, so the open question at line 234 matters: slice 1 ships behaviour to every repository and depends on nothing. If it splits off, finding 4 is the only one that touches it.

## What holds

- `taskState` answers `finished` first on a PR, and `deskState` reads a marker before a merge (`task.ts:88`, `desk-lifecycle.ts:161-168`). Line 61 states both orders correctly.
- `markerRecordsWork` is a presence reading (`desk-lifecycle.ts:101-110`). The spent-budget desk reads `refused-with-work` through `fileChangingCommits`, as line 86 says.
- The spent budget writes `unstarted`, actor `agent`, exit 1 today (`plot-worker-loop.sh:2852-2857`). The free wait at its bound writes no ending and exits 124. Line 57's two named changes are correct as far as they go.
- `raise_manifest_attempts` raises `attempts` (`:399-401`), and `boundRefusal` reads it against `MAX_ATTEMPTS` (`supervision.ts:203`).
- The #1084 group stop is at `plot-dispatch.sh:1849-1867` and signals `-<pgid>`. A non-detached prompt stays inside it.
- `refs.contains` exists (`ports/refs.ts:483`) and its doc says "Evidence, not a verdict". The restart's `evidence` declaration matches CLAUDE.md.
- The contract step has `timeout-minutes: 12` (`ci.yml:316`). Every CI job runs on `ubuntu-latest`. The exit-2 message form is at `plot-release-gate.sh:33`. `/api/continue` refuses a desk without a marker (`continue.ts:446-450`).
- The equality rule needs no `plot-ancestry` declaration, and the loop never writes the PR index.

Position: amend
