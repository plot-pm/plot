# The worker loop runs in JS: shell baseline

> The shell loop's failure counts for slice 5 of [the-worker-loop-runs-in-js](../plans/2026-10-04-the-worker-loop-runs-in-js.md), rebuilt on 2026-10-06 from sources that survive after the window. The plan asks for a daily collection. Nobody collected it during the window, so every figure here comes from a source read after the window closed, and each kind whose source did not survive is listed as unmeasured.

## Window

| | Time (UTC) | How it was found |
|---|---|---|
| From | 2026-10-05T08:19:38Z | `mergedAt` of #1271, `the-shell-loop-holds-unlanded-work` (squash commit `e7dcf73b3`). From this merge the shell's `write_ending` appends to `.plot/state/endings.jsonl`. |
| To | 2026-10-06T06:07:17Z | `mergedAt` of #1292, slice 3 `infra/the-loop-runs-in-one-process`. |

The window is 21 h 48 min and covers two calendar days, 2026-10-05 and 2026-10-06. Commit `7c89f31be` (2026-10-06T13:05:27Z) sets `Worker loop: js` in this repository and starts the `js` window.

## Slices counted

Nine slices merged inside the window. A slice is a merged PR whose body opens with "Slice of [plan]"; all nine ran on the shell loop.

| PR | Branch | Plan | Merged (UTC) |
|---|---|---|---|
| #1279 | `infra/the-loop-has-a-workflow` | the-worker-loop-runs-in-js | 2026-10-05T10:57:18Z |
| #1282 | `infra/the-loop-writes-through-ports` | the-worker-loop-runs-in-js | 2026-10-05T17:27:38Z |
| #1286 | `bug/the-build-monitor-asks-for-the-pushed-commit` | the-build-monitor-asks-for-the-pushed-commit | 2026-10-05T17:53:01Z |
| #1285 | `bug/the-correction-budget-counts-per-slice` | a-spent-correction-budget-gets-a-fresh-agent | 2026-10-05T17:54:15Z |
| #1287 | `feature/a-question-is-listed-as-waiting-on-you` | an-unanswered-question-escalates | 2026-10-05T21:35:34Z |
| #1291 | `feature/a-spent-correction-budget-gets-a-fresh-agent` | a-spent-correction-budget-gets-a-fresh-agent | 2026-10-05T22:33:05Z |
| #1293 | `infra/an-agent-run-is-a-port` | fleet-agents-run-through-the-agent-sdk | 2026-10-05T23:03:25Z |
| #1296 | `feature/a-question-notifies-as-it-ages` | an-unanswered-question-escalates | 2026-10-05T23:58:54Z |
| #1292 | `infra/the-loop-runs-in-one-process` | the-worker-loop-runs-in-js | 2026-10-06T06:07:17Z |

Notes on three of them:

- #1279's agent started on 2026-10-04, before the window opened, so its loop may have run code that predates the endings writer.
- #1287's loop ended `holding-work` (ending line 2 below). A master session committed the held work and opened the PR (#1288).
- #1292's agent was killed by a board stop at about 2026-10-05T23:45Z (#1307), and `/api/continue` started extra loops on its desk (#1294).

Not counted: #1271 merged at the window's first instant, and its agent ran before the window. Also not counted are five PRs merged in the window without a slice body, which a master session made by hand: #1289, #1290, #1299, #1302 and #1303.

## Ending lines

`.plot/state/endings.jsonl` in the main checkout held 4 lines on 2026-10-06. The lines carry no timestamp. Each line is placed in time by its branch's CI run and PR, and by the file's last write at 2026-10-06T09:20:43Z.

| Line | Branch | Reason | Detail | Placed at | In window |
|---|---|---|---|---|---|
| 1 | `infra/the-loop-writes-through-ports` | `unstarted` | build failed on each of 2 corrections, run 37340267639 | after 2026-10-05T16:31Z (run end) | yes |
| 2 | `feature/a-question-is-listed-as-waiting-on-you` | `holding-work` | uncommitted changes in 8 files | 2026-10-05T17:19Z (#1288) | yes |
| 3 | `infra/an-agent-run-is-a-port` | `unstarted` | build failed on each of 2 corrections, run 37370755198 | after 2026-10-05T22:08Z (run end) | yes |
| 4 | `infra/the-loop-restarts-on-new-code` | `holding-work` | uncommitted changes in 1 file | between 06:07Z and 09:20Z on 2026-10-06 | no: shell loop, after the window |

None of the three in-window lines is one of the plan's five kinds:

- Lines 1 and 3 record a reason and an answered CI wait.
- Line 2 is the loop holding a desk with uncommitted work and recording the reason, which is the behaviour #1271 added. It is not a desk that ended free.
- Line 3's failing run never got a runner (a GitHub Actions outage, #1295), so the agent spent 2 corrections on a failure in no code. The wait was answered, so this is not kind 2.

## Failure kinds

| Kind | Shell count | Source read | Rests on |
|---|---|---|---|
| 1. A desk that ended free with unpushed or uncommitted work | 0 in the issues; the reaper half is unmeasured | 19 issues filed in the window | no issue reports kind 1 |
| 2. A CI wait that ended unanswered while the build connector had an answer | 0 | the same 19 issues (on `shell` the issues are the only source) | no issue reports kind 2 |
| 3. A loop exit that held a slice and recorded no reason | unmeasured | — | see Unmeasured |
| 4. A loop process that outlives its desk | unmeasured | — | see Unmeasured |
| 5. A prompt process that outlives its loop | unmeasured | — | see Unmeasured |

The issues read are #1281, #1283, #1284, #1288, #1294, #1295, #1297, #1298, #1300, #1301 and #1304 to #1312, from `gh issue list --state all --search "created:2026-10-05T08:19:38Z..2026-10-06T06:07:17Z"`. Five of them describe loop or process behaviour. None of the five matches a listed kind:

- **#1283:** after the agent on `infra/the-loop-writes-through-ports` wrote `PLOT-BLOCKED.md` at 13:36, the shell loop logged "free on ? — nothing handed over yet" and cleared the slice from its manifest. The loop did not exit, and the issue does not say whether the desk held unpushed work. Not counted as kind 1 or kind 3.
- **#1288:** the supervisor takes no action on a `holding-work` ending (line 2). This is a supervisor gap, and the loop held the work.
- **#1294:** `/api/continue` started two more loops on a live desk. No loop outlived its desk.
- **#1295:** a run that no runner picked up reads as a failed build and spends a correction (line 3). The wait was answered.
- **#1307:** a board stop killed a continued agent. This is the reverse of kind 5.

**Per-slice comparison.** Kind 1 is 0 over 9 slices from the issues only. Kind 1's other source, the reaper's report of a desk holding work with no ending line, was not collected. So the shell figure is a lower bound, and its sources differ from the `js` side's. Kind 2 comes from different sources on the two sides (issues on `shell`, `checks-unanswered` endings on `js`), so the plan reports it per side and keeps it out of the per-slice comparison. No kind has a complete source on the shell side. The measured baseline is 0 listed failures over 9 slices, and it rests on issues alone.

## Process reading

No `ps` reading was taken in the window. The reading below was taken at 2026-10-06T13:08Z, outside the window, with `ps -eo pid,ppid,rss,etime,command`. It shows one live shell loop (started 2026-10-06T06:10Z, desk `.worktrees/free-76104a58`, branch `infra/a-run-records-its-spend`). `git worktree list` shows that desk as the only one. The cwd of the loop and of the prompt, read with `lsof`, is that desk.

| Process | PID | RSS (KB) | Elapsed |
|---|---|---|---|
| dispatch wrapper (`sh -c`) | 32741 | 848 | 06:57:35 |
| `plot-worker-loop.sh` | 32756 | 3,136 | 06:57:35 |
| loop subshells | 63659, 63663 | 640, 2,208 | 01:51:42 |
| prompt shell (`bash -c . worker-prompt.sh`) | 63634 | 3,120 | 01:51:50 |
| `plot-build-monitor.sh` | 32755 | 4,736 | 06:57:35 |
| `plot-agent-monitor.sh` | 32754 | 4,640 | 06:57:35 |
| prompt `claude --model sonnet -p` | 63727 | 353,344 | 01:51:42 |
| `plot-registryd.mjs` | 309 | 70,816 | 4 days 01:30:14 |

At this reading there are 0 loop, monitor or prompt processes whose desk no longer exists. The one agent's loop, its subshells and the wrapper hold 6,832 KB, and with the build monitor 11,568 KB. One reading outside the window is a sample of one, so it gives no kind 4 or kind 5 figure for the window.

## Unmeasured

- **Kind 1, the reaper half:** a desk the reaper reported as holding work with no ending line. Reaper output was not kept for the window.
- **Kind 3:** the dispatch wrapper writes its `gone`/`clear` line into the desk, and `plot-reap.sh` removed every desk of the window. The one remaining desk started after the window closed.
- **Kinds 4 and 5:** no daily `ps` reading was taken in the window, and a process reading cannot be rebuilt afterwards.
- **Memory per agent and per machine in the window:** these come from the same missing readings. The only figure is the reading above, which is outside the window.
- **Master side:** `scripts/count-master-diagnosis.mjs` does not exist on 2026-10-06, so the master sessions' diagnosis calls were not counted. The transcripts go back to 2026-09-09 and still cover the window, so the script can count them later.
- **Tokens:** this record does not collect them. A sealed slice's record is in `slice-spend.jsonl` (`.git/.plot/state/slice-spend.jsonl` on this machine), and slice 5 reads it for both sides.
