# Round 2 — Deliverable

Position: amend

## What I read

- Read the amended plan in full (`cat -n docs/plans/2026-10-04-the-worker-loop-runs-in-js.md`, 225 lines), the round-1 moderation and my round-1 verdict.
- Ran `skills/plot/scripts/plot-plan-meta.sh docs/plans/2026-10-04-the-worker-loop-runs-in-js.md`: exit 0, `format: canonical`, `phase: draft`, 7 waves of 1 branch each, every branch with a `builds:` comment, `long_wave_names: []`, `unread_branch_headings: []`, `unread_waits: []`, 7 changelog entries, issues `[1199, 1246, 1255]`, `rounds: 1`.
- Ran `gh issue view 1246` and `gh issue view 1199` (both OPEN).
- Ran per-file counts over `git grep -l plot-worker-loop -- test` (30 files): mentions of the loop, of `spawn|execFile`, and of `buildmonitor|build-monitor`; `git grep -l -iE 'build-monitor|buildmonitor|findings'` and `git grep -l -E 'monitor\.build|BuildMonitor"'` over the same files; `sed -n` on each of the 7 cited source-text lines.
- Ran `git grep -n build-monitor -- skills/plot/scripts/` to find the BuildMonitor's starter without naming the dispatch script (#1245).
- Read only: `rules/checkout-yield.ts`, `rules/checks-verdict.ts`, `entry/checks-verdict.ts`, `entities/ending.ts:75-84`, `rules/supervision.ts:180-260`, `findings.ts:38-43`, `attention.ts:160-170`, `schema.ts:3449-3452`, `scripts/check-shell-lines.sh` header, `plot-worker-loop.sh:690-790, 860-1010, 1270-1330, 1425-1470, 2905-2960`, and `runs-on` in `.github/workflows/*.yml`.
- Ran no test suite.

## Round-1 findings in my lens

1. **Slice 1 shipped dead code.** Answered. The new slice 1 (`The shell loop holds unlanded work`) ships behaviour into the shell loop through the existing bundle seam, before any JS exists. Its done-criterion is observable: the loop writes `holding-work` and ends instead of going free.
2. **Slice 2 was several slices.** Answered. The plan now has 7 slices: workflow, write ports, process, restart and default flip each stand alone, and the signal behaviour is decided in slice 3 before the process slice.
3. **"Passes the 30 test files" could not be the criterion.** Answered. Slice 4 names the 7 source-text assertions (all 7 lines verified: each is a `readFileSync(loop…)`) and the BuildMonitor-fed files, and keeps "reported, never rewritten" for the rest.
4. **Slice 3 had no deciding reading.** Answered in substance. The manifest records `loop: js|shell` (slice 4), and slice 6 lists four loop-caused failures. A new defect in the window is item 4 below.
5. **Board-impact line was false.** Answered. The comment at line 24 names `buildMonitorPid` and the findings file, and slice 7 removes the field with its renderer.
6. **Changelog omitted the removal.** Answered: Changelog line 22.
7. **Changelog claimed fixes that ship only in `js`.** Answered by the paragraph "Until slices 1, 4 and 6 land" (line 175).

## What must change

1. **Slice 2 changes `checksVerdict`'s input while the shell loop still calls it (new).** Design line 79 and slice 2 (line 127) say `rules/checks-verdict.ts` "takes build runs as its readings instead of BuildMonitor findings". The shell loop asks that rule through `board/plot-checks-verdict.mjs` (`plot-worker-loop.sh:1751`), whose entry parses a BuildMonitor line into `BuildFinding` (`entry/checks-verdict.ts`, `parseFinding`). The shell loop stays the default until slice 6 and runs in adopting repositories until slice 7. A fleet agent that does slice 2 as written either breaks the shell loop's CI wait in every repository, or keeps two rules the plan does not declare. Amend: slice 2 adds a second rule (or a second readings form) for build runs, and the BuildMonitor form of `checksVerdict` stays until slice 7 removes it, named in slice 7's removal list.
2. **Slice 1 and slice 2 write ending reasons that the schema refuses (new).** `EndingReasonSchema` (`entities/ending.ts:75-83`) is a closed `z.enum` of `bound, quiet, unreadable, spent, unstarted, limited, unregistered`, and `domain/test/ending.test.ts:45` pins that list. Slice 1 writes `holding-work`; the slice 2 table writes `blocked`, `checks-unanswered` and `deregistered`. `deregistered` is a second word for the existing `unregistered` (a free loop's manifest vanished), which the plan's own rule "adds no third state vocabulary" forbids. Amend: slice 1 adds `holding-work` (and its `EndingActorSchema` actor) to the schema; slice 2 uses `unregistered` and adds `blocked` and `checks-unanswered` to the schema. Without this, Changelog line 16 ("the board names a person for the desk") has no reader a reviewer can check.
3. **Slice 1's net-zero shell line has no named offset (new).** Slice 1 says it "replaces the loop's own go-free test with the bundle answer". #1246 states the opposite: "the loop's free transition does not consult them", so no go-free test exists to replace. `check-shell-lines.sh` refuses a net increase, and the slice adds a `checkoutYield` call and a `write_ending` path. The closest existing shell is `desk_reset_refusal` (`plot-worker-loop.sh:738-750`), which reads the same three conditions. Amend: name the lines that go, for example `desk_reset_refusal` replaced by the bundle answer. Also note that `checkoutYield` is written for the OTHER worktree (`plot-worker-loop.sh:858-862`) and returns `live-worker` or `registered` first for the asking desk unless the caller passes `false` for both; `resetRefusals`/`deskIsResettable` is the rule whose subject is the loop's own desk. The slice should name which rule it asks and which readings it passes.
4. **Slice 6's comparison has no `shell` side in this repository (new).** Line 175 says slice 4 "runs the fleet on `js`" here, so over the same window this repository records zero `shell` slices. "No more listed failures than the `shell` loop" then reads as "zero failures", or as a comparison against nothing. Amend: say how the window gets `shell` slices (a split of agents, or an earlier window named by date), or replace the comparison with an absolute threshold.
5. **In `js` mode the dispatch wrapper still starts the BuildMonitor, so two writers share one file (new).** `start_worker()` starts `plot-build-monitor.sh` whenever it is executable (`plot-dispatch.sh:1491`). Slice 4's JS loop also writes `.plot-worker.monitor.build.jsonl` (Design line 83), and Design line 98 says "It starts no sidecar monitor". Until slice 7 removes the start, a `js` agent has both. Amend: slice 4 says whether dispatch skips the BuildMonitor for `Worker loop: js`, or states that both write until slice 7 and which line the board reads.
6. **Slice 3's macOS criterion has no evidence location (new).** Every CI job runs on `ubuntu-latest` (`grep runs-on .github/workflows/*.yml`, 6 jobs). A reviewer cannot check "tested on macOS" from CI. The `KillMode` half can extend the existing systemd step at `ci.yml:379-451`. Amend: say where the macOS run is recorded (the PR body, with the command and output).
7. **Two wrong citations in the board-impact comment (line 24).** `attention.ts:167` is the `ci-approval` verdict over `pr.state` and reads no BuildMonitor line (`grep -n 'BuildMonitor\|monitor.build' attention.ts` returns nothing). "The last slice also adds the bundle `board/plot-worker-loop.mjs`" contradicts slice 4, which builds it. Fix both.
8. **Two counts carry no command.** "22 of them drive it in code" has no command in Notes, and I could not reproduce it from `spawn|execFile` counts (all 30 files contain one). "The 8 files that feed BuildMonitor findings" comes from a pattern that includes `findings`; only 2 files write a BuildMonitor line (`git grep -l -E 'monitor\.build|BuildMonitor"'`: `checks-wait`, `correction`) and 5 name it. A slice-4 agent needs the list, not the number: name the files.

## What holds

- The plan parses (exit 0) with 7 single-branch waves under named headings, each with a `builds:` line.
- The slice order holds as a chain: shell fix, workflow, ports, process, restart, default, removal. Each later slice depends only on earlier ones, apart from item 1 above.
- Slice 1 targets a real, open defect (#1246, OPEN) and ships to every repository through a bundle the loop already resolves (`plot-checkout-yield.mjs`, `plot-prompt-exit.mjs`, both present in `skills/plot/scripts/board/`).
- `.plot-worker.ending.json` exists today (`plot-worker-loop.sh:1278`, `entities/ending.ts:15`), so slice 1 writes to a known record rather than a new file.
- The 7 source-text assertions exist at the cited lines.
- `findings.ts:42` lists `.plot-worker.monitor.build.jsonl`, `schema.ts:3451` holds `buildMonitorPid`, and both corpus files slice 7 removes exist (`packages/domain/corpus/desk-reset.corpus.test.ts`, `agent-state.corpus.test.ts`).
- Slice 7's removal estimate is consistent: 891 + 39 + 162 = 1,092 non-comment lines plus the named helper functions, against "about 1,124", in the unit `check-shell-lines.sh` counts.
- The Changelog's 7 lines each map to a slice: 16 and 17 to slice 1, 18 to slice 4, 19 to slices 4 and 6, 20 to slice 5, 21 to slice 2, 22 to slice 7.
- Slices 2 and 3 still ship no caller, but each now has a checkable done-criterion (the domain coverage gate; the signal tests), and slice 1 carries the user-visible fix, so the dead-code finding from round 1 no longer blocks.

Position: amend
