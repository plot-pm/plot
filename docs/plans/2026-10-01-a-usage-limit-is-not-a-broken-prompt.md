# A usage limit is not a broken prompt

> When the harness stops on the account's usage limit, the worker loop reads the exit as a prompt that cannot start: it retries three times in seconds, ends the worker, and writes a `PLOT-BLOCKED` that tells a person to fix a prompt file that works. The limit message names its own reset time, and the loop discards it.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1141
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- A worker that stops on the harness's usage limit waits until the limit resets and resumes the same slice, instead of spending its retry budget in seconds.
- While a worker waits on a limit, its desk says so: the worker monitor reports no stall, and `/plot-fleet --status` names the reset time.
- A limit with no readable reset, a reset past the worker's bound, or a limit that returns without progress ends the worker with a marker that names the limit and the `--restart` to run after it, not a prompt fix.
- A failed prompt reads the desk before it says that no work was done: commits since the claim and uncommitted changes are named.

## Motivation

Measured 2026-10-01 on a Bitbucket estate (Plot 2.22.1, branch `feature/ewzkus-3845-smartmeter`), reported in #1141:

- The agent's first prompt worked: two commits pushed, a third part uncommitted in the desk (10 files).
- The next prompt exited 1. The harness printed `You've hit your session limit · resets 5:20pm (Europe/Zurich)`.
- The loop printed *"the prompt failed to run … without the agent doing any work … the desk is untouched; retrying (1 of 3)"* three times in a row, then *"no slice was ever worked … ending worker"*.
- `PLOT-BLOCKED.md` said *"Nothing was implemented … fix the invocation in the prompt file"*. Three statements in it are false: work was implemented, the desk was not untouched, and the invocation needed no fix.

The same failure happened on this repository on 2026-10-01: a desk-root worker hit the limit, ended, and sat free with unpushed commits until a person recovered the desk.

Reproduced on `origin/main` (panel round 1, skeptic): a fake prompt that commits one file, leaves 3 untracked files, prints the #1141 line on **stdout** and exits 1 ran 4 times in 974 ms, ended `unstarted`, and wrote the false marker.

Verified on `origin/main`:

- `plot-worker-loop.sh:2008-2021` handles every non-zero prompt exit the same way. Below `START_ATTEMPT_BUDGET` (3, `:366`) it raises `attempts` and runs `continue` with no delay. At the budget it writes the ending `unstarted` and the marker quoted above.
- The loop never reads what the prompt printed. `run_bounded` starts the prompt with `bash -c '. "$1"' _ "$prompt_file" &` (`:1675`); its output goes to `.plot-worker.log` through the wrapper, and the loop keeps only `_prompt_status` (`:1719`).
- The sentences *"the desk is untouched"* and *"no slice was ever worked"* are constants (`:2012`, `:2015`, `:2019`). Nothing reads the desk before they are printed.
- `EndingReasonSchema` (`packages/domain/src/entities/ending.ts:55`) has no reason for a limit, and `endingIsAttributable` (`packages/domain/src/transitions/agent.ts:390`) admits the actor `agent` only for `unstarted`.
- **The default launch names no harness.** `plot-dispatch.sh:892` sets `launch_harness=""` and `:1491` exports `PLOT_HARNESS="$launch_harness"`, so a charter-less agent, which is every agent on this estate, runs with `PLOT_HARNESS` empty. Only the prompt template applies the default: `harness="${PLOT_HARNESS:-claude}"` (`skills/plot/templates/worker-prompt.sh:136`).
- **The worker monitor runs for the agent's whole life.** The dispatch wrapper starts it (`plot-dispatch.sh:1502`) and it watches the loop's pid, not one prompt. Its `idle` finding needs a silent transcript, no child on a core, an unchanged tree across two passes, and commits on the branch (`plot-worker-monitor.sh:14-16`, `:594-600`). A loop asleep for hours on a desk with commits meets all four. The loop's per-prompt watcher reads the findings file's last line every 5 s (`plot-worker-loop.sh:142`, `:1494-1503`), so a resumed prompt would be ended as `quiet` by an `idle` published during the wait.
- **The harness composes the limit line from parts.** The 2.1.286 binary holds `You've hit your ` and the three limit names `session limit`, `weekly limit` and `Opus limit`. Its interactive mode waits for a reset itself and says *"exited during the wait, so the task will not resume on its own"*; a `-p` run has no such wait, so the loop must provide it.

## Design

### Approach

**The classification is a domain rule, and the message patterns are an adapter's data.** *Is this exit a usage limit, a prompt that could not start, or something else?* is a decision, so it lives in `packages/domain/src/rules/prompt-exit.ts` and names no vendor. `promptExit` takes the patterns as an argument; it imports no adapter. What a harness prints at a limit is a fact about that harness, so `packages/domain/src/adapters/harness/limit-lines.ts` holds a table keyed by harness name: the line prefix, the limit names, and the reset separator. **The adapter is data only**: every match, every time parse and every comparison stays in the rule, because the 100% branch gate covers `src/!(adapters)/**` (`packages/domain/vitest.config.ts:71`) and logic in the adapter would escape it. The entry `entry/prompt-exit.ts` joins the table to the rule, as `rules/listing-page.ts` and `adapters/host/listing-paging.ts` do for host paging. A harness the table does not know supplies no patterns, and every exit from it reads `unstarted` when non-zero.

**The loop passes the effective harness.** The loop sends `${PLOT_HARNESS:-claude}` to the bundle, the same default the template applies at `worker-prompt.sh:136`. Passing the raw variable would send an empty name on every charter-less launch and leave #1141 unfixed while every test that sets `PLOT_HARNESS=claude` passes.

**The loop asks the rule through a bundle, and keeps no copy.** `docs/shell-and-domain.md` §1 says a script that runs once per operator command calls the domain, and one that runs once per agent per pass duplicates the rule. This question is asked once per prompt exit, which is once per pass. The estate already pays that cost at this exact point: the loop asks `plot-slice-spend.mjs` once per finished slice (`plot-worker-loop.sh:1011`, called at `:2114`). One more `node` start (about 39 ms) after a prompt that ran for minutes or hours adds nothing measurable, and a shell copy would need a corpus test to hold the pair together for no saved cost. The bundle is `skills/plot/scripts/board/plot-prompt-exit.mjs`: the last 200 lines of the prompt's output on stdin; the status, the effective harness and the current time as arguments; one answer line on stdout.

**An unaskable bundle is today's path.** When `node` is missing, the bundle is missing, or it exits with anything but its answer, the loop takes the `unstarted` path for a non-zero status and the normal path for status 0, exactly as on `origin/main`. A rule that cannot be asked must not invent a wait.

**The rule answers three outcomes:**

| Outcome | When | Carries |
|---|---|---|
| `limited` | the output holds a limit line for this harness, whatever the status | the reset as an instant, or `unknown` |
| `unstarted` | no limit line, and the status is not 0 | nothing new; this is today's path |
| `ran` | no limit line, and the status is 0 | nothing; this is today's path |

**The rule is asked on every exit, not only a non-zero one.** Whether the harness can report a limit and exit 0, for example after the agent finished part of a turn, is **not established**: #1141 measured exit 1, and the harness is a compiled binary whose `-p` exit path could not be read with confidence. If such an exit exists and only a non-zero status asked the rule, the loop would read a finished slice, clear the branch, and hand the slice back with uncommitted work in the desk. Asking on every exit closes that case at the cost stated above. A `limited` answer with status 0 takes the same wait as a non-zero one: the resumed prompt finds the work and finishes it, or reports it finished, which costs one prompt and loses nothing.

**Reading the reset is part of the rule.** The message gives a wall-clock time and an IANA zone (`5:20pm (Europe/Zurich)`). The rule resolves it to an instant in that zone on the date of `now`. **A reset up to 120 s in the past is now**, not tomorrow: a message read seconds after `5:20pm` would otherwise resolve 24 h ahead. A reset more than 120 s in the past resolves to the next day. A time or zone it cannot read is `unknown`, never a guess. A weekly limit whose reset names a date the rule cannot read is `unknown` and ends the worker, which is correct for a reset days away.

**The loop keeps the prompt's output.** `run_bounded` starts the prompt with stdout and stderr piped through `tee -a` into a temp file made with `plot_tmpfile` (`plot-tmp.sh`, already sourced at `:73`) and into the loop's own stdout, so `.plot-worker.log` keeps both streams as it does today and the loop can read them. The limit line arrived on stdout in #1141, so both streams are read.

**The loop acts on the answer:**

- **`limited`, a reset is known, and the wait is allowed.** The wait is allowed when the reset is in the future and no more than `Worker bound` seconds away. A bound of `0` disables the floor (`plot-worker-loop.sh:125-130`), and with it this cap: any known reset is allowed, which is never more than 24 h by construction. The loop does not raise `attempts`. It writes the desk fact below, logs *"usage limit on <branch> until <time>; waiting"*, sleeps until the reset plus a 60 s margin, removes nothing, and runs `continue`, so the same slice resumes on the same desk.
- **`limited`, and the limit returned without progress.** A limit is *without progress* when the prompt that returned it started after a wait, ran less than 600 s, and the desk gained no commit (`git rev-list --count "origin/$main_branch..HEAD" -- .`) since the wait. Such a limit ends the worker as below: a limit that does not lift cannot hold an agent forever. **Any other limit resets the count**: a slice that works through one 5-hour window, waits, and hits the limit again hours later waits again, because a second limit inside an 8-hour bound is normal.
- **`limited` with no known reset, or a reset past the bound.** The loop ends the worker with the new ending reason `limited`, actor `agent`, and a `PLOT-BLOCKED` marker that says: the harness reported a usage limit, until `<time>` or *with no reset time*; the slice stays claimed; the desk holds `<n>` commits since the claim and `<m>` uncommitted paths; run `/plot-dispatch --restart <branch>` after the limit lifts. It names no prompt fix. The exit is 1, as on the `unstarted` path.
- **`unstarted`.** Today's retry path, unchanged in budget and in exit code; only its sentences change, as below.
- **`ran`.** Today's path, unchanged.

**The wait sleeps in steps checked against the clock.** A single `sleep N` does not count time a laptop spends suspended, so a lid closed overnight would resume hours late. The loop sleeps in steps of at most 60 s and compares the clock after each step. Each step runs as `_wait_sleep_pid`, the loop's existing pattern (`:1398`, reaped by the trap at `:1597-1599`), so `--stop` ends a waiting agent at once. The loop reads the clock through one function, which tests offset with `PLOT_LIMIT_CLOCK_OFFSET_SECONDS`; the margin is `PLOT_LIMIT_MARGIN_SECONDS` (default 60), following the `PLOT_START_ATTEMPT_BUDGET` precedent (`:366`). Neither is a Plot Config key.

**The desk says the agent is waiting.** Before it sleeps, the loop writes `.plot-worker.limited` in the desk: one line, the reset instant in UTC ISO form, a tab, and the harness's limit line. The file name matches `PLOT_WORKER_RECORD` (`plot-worker-state.sh:89`), so no dirt reading counts it as work. Three readers use it:

- **The worker monitor treats the reset as the agent's last sign of life.** While the file names an instant, `sample_verdict` measures transcript silence from the later of the newest transcript line and that instant. During the wait the verdict is `busy`, so no `idle` is published; after the reset the quiet window starts again, and the resumed prompt has the whole window to write its first line. The monitor stays the one writer of the findings file.
- **`/plot-fleet --status`** prints *"waiting on a usage limit until <time>"* for an agent whose desk holds the file, so an operator can tell a waiting agent from a stuck one.
- **The loop** overwrites the file at each limit and removes it when the slice ends, the agent hops, or the worker ends.

**The sentences read the desk.** Before the loop prints *"without the agent doing any work"*, *"the desk is untouched"* or *"no slice was ever worked"*, it reads two facts. Commits: `git rev-list --count "origin/$main_branch..HEAD" -- .` in the desk, where `-- .` drops the empty claim commit, the reading `plot-dispatch.sh:2049-2056` uses, and `HEAD` includes unpushed commits; a `--restart` desk with no claim commit from this process reads the same way. Uncommitted paths: `plot_worker_dirty` (`plot-worker-state.sh:389`, sourced at `plot-worker-loop.sh:712`), which drops the loop's own `.plot-worker.*` files. Where either count is above zero, the sentence names it instead (*"2 commits since the claim and 10 uncommitted paths are in the desk"*), on the retry line, on the final line and in the marker, on both the `limited` and the `unstarted` path.

**The ending gains one reason.** `EndingReasonSchema` gets `limited`, and `endingIsAttributable` admits actor `agent` for `limited` as it does for `unstarted`: no watcher produced either ending, and the harness answered the agent's own process.

### What this does NOT do

- **It does not predict a limit.** The loop does not read the account's remaining usage before a prompt. It reacts to the answer the harness gives.
- **It does not change the supervisor or the board.** A waiting agent is a running process with a live claim. The board's label for it is a follow-up; `/plot-fleet --status` names it now.
- **It does not spend real usage in a test.** Every test uses a fake harness that prints a limit line.

### Open Points

- [ ] The pattern table's first entries are the line measured in #1141 and the three limit names read from the 2.1.286 binary. A message shape not yet measured, such as a weekly reset with a date, reads `unknown` until it is measured and added.
- [ ] Whether the harness exits 0 on a limit is not established. The design does not depend on the answer; the first slice-2 run that observes a real limit should record the status in the issue.

## Slices

### The rule names a usage limit (Branch: bug/the-rule-names-a-usage-limit)

`rules/prompt-exit.ts` with the three outcomes and the reset reading; `adapters/harness/limit-lines.ts`, data only; `entry/prompt-exit.ts` joining them; `EndingReasonSchema` gains `limited` and `endingIsAttributable` admits it, and `packages/domain/test/ending.test.ts:45`, which pins the reason list, gains it. The bundle `board/plot-prompt-exit.mjs`: its block in `packages/board/build.mjs`, its line in `packages/board/src/contract/bundles.generated.ts`, its `-merge` line in `.gitattributes`, the committed artifact, and a Helper Scripts row in `CLAUDE.md`. Domain tests at 100% branch coverage: the #1141 line in `Europe/Zurich` across a day boundary, a reset 60 s past (now), a reset 200 s past (tomorrow), a line with no reset, an unreadable time, an unknown harness, an empty pattern set, and a limit line with status 0.

- `bug/the-rule-names-a-usage-limit` — the rule, the adapter and the bundle <!-- builds: promptExit, a rule that classifies a prompt exit -->

### The loop waits out a usage limit (Branch: bug/the-loop-waits-out-a-usage-limit)

`plot-worker-loop.sh` tees the prompt's output to a `plot_tmpfile`, asks the bundle on every exit with `${PLOT_HARNESS:-claude}`, falls back to today's paths when the bundle cannot answer, writes and removes `.plot-worker.limited`, sleeps in clock-checked steps as `_wait_sleep_pid`, and reads the desk for its sentences. `plot-worker-monitor.sh` reads `.plot-worker.limited` in `sample_verdict`. `plot-fleetctl.sh --status` prints the waiting line. Tests extend the start-failure fixture in `test/reconcile/second-slice.test.mjs:370-440`, each with a fake harness, `PLOT_LIMIT_MARGIN_SECONDS=0` and a clock offset:

- a limit with a reset 2 s ahead waits and resumes the same slice without raising `attempts`;
- the same case with `PLOT_HARNESS` set and empty still reads `limited`;
- the monitor runs beside the loop with a 1 s window and interval on a desk with commits; no `idle` is published during the wait, and the resumed prompt runs to exit 0;
- a limit that returns within 600 s of a wait with no new commit ends with `limited`; a limit after a resumed prompt that committed waits again;
- a limit with no reset ends at once with the limit marker, which names the commit and dirt counts;
- a limit line with status 0 waits rather than clearing the branch;
- a missing bundle keeps today's three retries;
- `--stop` during a wait ends the loop within one step;
- a plain failure keeps today's three retries; a desk with commits and dirty paths names both counts, and the loop's own `.plot-worker.*` files are not counted.

- `bug/the-loop-waits-out-a-usage-limit` — the loop, monitor and status wiring, and the desk-reading sentences <!-- builds: the usage-limit wait in plot-worker-loop.sh -->

## Notes

Waits on nothing outside this plan. Slice 2 needs slice 1's bundle.
