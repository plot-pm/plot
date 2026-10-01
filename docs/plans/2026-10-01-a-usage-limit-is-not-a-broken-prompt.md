# A usage limit is not a broken prompt

> When the harness stops on the account's usage limit, the worker loop reads the exit as a prompt that cannot start: it retries three times in seconds, ends the worker, and writes a `PLOT-BLOCKED` that tells a person to fix a prompt file that works. The limit message names its own reset time, and the loop discards it.

## Status

- **State:** Approved
- **Approved:** 2026-10-01, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1141
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Started:** 2026-10-01, jwloka, `bug/the-rule-names-a-usage-limit`

## Changelog

- A worker that stops on the harness's usage limit waits until the limit resets and resumes the same slice, instead of spending its retry budget in seconds.
- While a worker waits on a limit, its desk says so: the worker monitor publishes no stall, and `/plot-fleet --status` names the reset time until that time passes.
- A limit with no readable reset, a reset past the worker's bound, or a limit that returns without progress ends the worker with a marker that names the limit and the `--restart` to run after it, not a prompt fix.
- A finished prompt whose output quotes a limit line is not read as a limit.
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
- The loop never reads what the prompt printed. `run_bounded` starts the prompt with `bash -c '. "$1"' _ "$prompt_file" &` and keeps `_prompt_child=$!` (`:1675-1676`); its output goes to `.plot-worker.log` through the wrapper, and the loop keeps only `_prompt_status` (`:1719`). The bound, the idle watcher and the `--stop` trap end the prompt through `_kill_tree "$_prompt_child"` (`:1595`).
- The sentences *"the desk is untouched"* and *"no slice was ever worked"* are constants (`:2012`, `:2015`, `:2019`). Nothing reads the desk before they are printed.
- `EndingReasonSchema` (`packages/domain/src/entities/ending.ts:55`) has no reason for a limit, and `endingIsAttributable` (`packages/domain/src/transitions/agent.ts:390`) admits the actor `agent` only for `unstarted`.
- **The default launch names no harness.** `plot-dispatch.sh:892` sets `launch_harness=""` and `:1491` exports `PLOT_HARNESS="$launch_harness"`, so a charter-less agent, which is every agent on this estate, runs with `PLOT_HARNESS` empty. Only the prompt template applies the default: `harness="${PLOT_HARNESS:-claude}"` (`skills/plot/templates/worker-prompt.sh:136`).
- **The worker monitor runs for the agent's whole life.** The dispatch wrapper starts it (`plot-dispatch.sh:1502`) and it watches the loop's pid, not one prompt. Its `idle` finding needs a silent transcript, no child on a core, an unchanged tree across two passes, and commits on the branch (`plot-worker-monitor.sh:14-16`, `:594-600`). A loop asleep for hours on a desk with commits meets all four. The loop's per-prompt watcher reads the findings file's last line every 5 s (`plot-worker-loop.sh:142`, `:1494-1503`), so a resumed prompt would be ended as `quiet` by an `idle` published during the wait.
- **The harness composes the limit line from parts.** The 2.1.286 binary holds the prefix `You've hit your ` and five limit names: `session limit`, `weekly limit`, `Opus limit`, `fast limit` and `monthly spend limit`. Its interactive mode waits for a reset itself and says *"exited during the wait, so the task will not resume on its own"*; a `-p` run has no such wait, so the loop must provide it.

## Design

### Approach

**Every decision is the rule's, and the message patterns are an adapter's data.** *Is this exit a usage limit, may the loop wait for it, and if not, how does the worker end?* is one decision, so it lives in `packages/domain/src/rules/prompt-exit.ts` and names no vendor. `promptExit` takes the patterns as an argument; it imports no adapter. What a harness prints at a limit is a fact about that harness, so `packages/domain/src/adapters/harness/limit-lines.ts` holds a table keyed by harness name: the line prefix, the limit names and the reset separator. **The adapter is data only**: it exports a constant and holds no function, so every match, every time parse and every comparison stays in the rule, where the 100% branch gate applies (`packages/domain/vitest.config.ts:71` covers `src/!(adapters)/**`). A harness the table does not know supplies no patterns, and every exit from it reads as today.

**The bundle entry joins the table to the rule.** `packages/board/src/server/entry/prompt-exit.ts` reads the arguments and stdin, passes the table's entry for the harness to `promptExit`, and prints the answer. This is the shape of `entry/slice-spend.ts`, the loop's existing bundle. The bundle is `skills/plot/scripts/board/plot-prompt-exit.mjs`.

**The loop passes the effective harness.** The loop sends `${PLOT_HARNESS:-claude}` to the bundle, the same default the template applies at `worker-prompt.sh:136`. Passing the raw variable would send an empty name on every charter-less launch and leave #1141 unfixed while every test that sets `PLOT_HARNESS=claude` passes.

**The bundle is asked once per prompt exit, and the loop keeps no copy.** `docs/shell-and-domain.md` §1 names `plot-worker-loop.sh` as the case that duplicates a rule, because a hop on its idle pass is paid by every agent on every pass. A prompt exit is not an idle pass: it happens once per prompt, and a prompt runs for minutes or hours. One `node` start (about 39 ms) after it adds nothing measurable, and a shell copy would need a corpus test to hold the pair together for no saved cost. **Slice 1 amends `docs/shell-and-domain.md` §1** to record this: the loop's idle pass still duplicates, and a call made once per prompt exit asks the domain. The slice-spend call (`record_slice_spend`, `plot-worker-loop.sh:1002`, called at `:2114`) is cited only as the existing bundle in the loop; it runs once at slice end on the success path, not after every exit.

**The bundle's input and answer.** The last 200 lines of the prompt's output arrive on stdin. Arguments: the exit status, the effective harness, now in epoch seconds, `Worker bound` in seconds, the seconds the prompt ran, whether the prompt started after a limit wait, and the commits the desk gained since that wait. **The loop passes all seven arguments on every exit**, including an exit from a prompt that never waited: there the wait flag is `0` and the commit count is `0`. With the flag `0` the rule reads neither the run time nor the commit count, so such an exit can never answer `no-progress`, and its answer depends only on the status, the harness, the output, now and the bound. The answer is one line of tab-separated fields; every instant is written as epoch seconds and as UTC ISO text, so the loop, the monitor and `plot-fleetctl.sh` compare integers and never parse a date:

| Answer | When | Fields |
|---|---|---|
| `wait` | a limit, a known reset at or after now, and the wait is allowed | reset epoch, reset ISO, the limit line |
| `end-limited` | a limit, and no wait is allowed | reset epoch and ISO, or `unknown` and `-`; the limit line; the cause: `no-reset`, `past-bound` or `no-progress` |
| `unstarted` | no limit, and the status is not 0 | none; today's retry path |
| `ran` | no limit, and the status is 0 | none; today's path |

**A limit on a non-zero exit** is any line in the 200 that starts with the harness's prefix and a known limit name. **A limit on a status-0 exit** is stricter: only the last non-empty line counts, and it must match from its start. A `-p` run prints the agent's final message, and plans, panel files and fixtures on this estate carry the #1141 line verbatim, so an agent that quotes it in a finished slice must read `ran`, not wait up to 24 h on a finished slice. The status-0 case stays because whether the harness can report a limit and exit 0 is **not established**: #1141 measured exit 1, and the harness's `-p` exit path could not be read with confidence.

**All five limit names are limits.** `session`, `weekly` and `Opus` limits carry a reset the rule can read. The `fast limit` and `monthly spend limit` shapes are not measured. A line with either name reads as a limit; if its reset text cannot be read, the answer is `end-limited` with cause `no-reset`, so the marker names the limit and asks for a person, which is right for a spend cap. Neither name falls through to `unstarted` and its false prompt-fix marker.

**Reading the reset.** The message gives a wall-clock time and an IANA zone (`5:20pm (Europe/Zurich)`). The rule resolves it to an instant in that zone on the date of now. **A reset up to 120 s in the past resolves to now**, not tomorrow: a message read seconds after `5:20pm` would otherwise resolve 24 h ahead. The rule writes now as the reset epoch, so the reset is at or after now, the answer is `wait`, and the loop sleeps only the margin. A reset more than 120 s in the past resolves to the next day. A time or zone it cannot read is `unknown`, never a guess.

**When a wait is allowed.** A known reset no more than `Worker bound` seconds away is allowed. A bound of `0` disables the floor (`plot-worker-loop.sh:125-130`), and with it this cap: any known reset is allowed, which is never more than 24 h by construction. **A limit is without progress** when the prompt started after a limit wait, ran less than 600 s, and the desk gained no commit since that wait. The base of that count is the desk `HEAD` the loop records when the wait starts: the loop passes `git rev-list --count <recorded HEAD>..HEAD` in the desk. Such a limit answers `end-limited` with cause `no-progress`: a limit that does not lift cannot hold an agent forever. Any other limit is allowed to wait again, because a second limit inside an 8-hour bound is normal.

**Progress counts commits, not transcript writes, by choice.** The transcript gains a line on every turn, including the turn that meets the limit, so a transcript write cannot tell a prompt that worked from one that only met the limit again. A resumed prompt that edits files for minutes without a commit and meets the limit within 600 s ends the worker; the marker names its uncommitted paths and the `--restart`, so no work is lost.

**An unaskable bundle is today's path.** When `node` is missing, the bundle is missing, or it exits with anything but an answer, the loop takes the `unstarted` path for a non-zero status and the normal path for status 0, exactly as on `origin/main`. A rule that cannot be asked must not invent a wait.

**The loop keeps the prompt's output without losing the prompt's pid.** `run_bounded` starts the prompt as `bash -c '. "$1"' _ "$prompt_file" > >(tee -a "$out") 2>&1 &`, where `$out` is a temp file made with `plot_tmpfile` (`plot-tmp.sh`, sourced at `:73`). Process substitution leaves `$!` on the prompt, so `_prompt_child` stays the prompt's pid and `_kill_tree` reaches it. A pipeline (`… 2>&1 | tee -a "$out" &`) makes `$!` the pid of `tee` and the prompt its sibling, so the bound, the idle watcher and `--stop` would miss the prompt; all three round-2 jurors measured that. Measured for this plan on macOS: under bash 3.2.57 and bash 5.3.15, killing `$!` with its children leaves no prompt process, `wait` returns the prompt's status (7 for a prompt that exits 7), and the capture holds both streams. `tee` writes both streams to the loop's stdout too, so `.plot-worker.log` keeps them as it does today. If `tee` has not flushed when the loop reads `$out`, the last line is missing and the answer falls back to `unstarted` or `ran`, which is today's behaviour.

**The loop acts on the answer:**

- **`wait`.** The loop does not raise `attempts`. It writes the desk fact below, logs *"usage limit on <branch> until <time>; waiting"*, sleeps until the reset epoch plus a 60 s margin, removes nothing, and runs `continue`, so the same slice resumes on the same desk.
- **`end-limited`.** The loop ends the worker with the new ending reason `limited`, actor `agent`, and a `PLOT-BLOCKED` marker that says: the harness reported a usage limit, until `<time>` or *with no reset time*, with the limit line; the slice stays claimed; the desk holds `<n>` commits since the claim and `<m>` uncommitted paths; run `/plot-dispatch --restart <branch>` after the limit lifts. It names no prompt fix. The exit is 1, as on the `unstarted` path.
- **`unstarted`.** Today's retry path, unchanged in budget and in exit code; only its sentences change, as below.
- **`ran`.** Today's path, unchanged.

**The wait sleeps in steps checked against the clock.** A single `sleep N` does not count time a laptop spends suspended, so a lid closed overnight would resume hours late. The loop sleeps in steps of at most 60 s and compares the clock after each step. Each step runs as `_wait_sleep_pid`, the loop's existing pattern (`:1398`, reaped by the trap at `:1597-1599`), so `--stop` ends a waiting agent at once. The loop reads the clock through one function, which tests offset with `PLOT_LIMIT_CLOCK_OFFSET_SECONDS`; the margin is `PLOT_LIMIT_MARGIN_SECONDS` (default 60), following the `PLOT_START_ATTEMPT_BUDGET` precedent (`:366`). Neither is a Plot Config key.

**The desk says the agent is waiting.** Before it sleeps, the loop writes `.plot-worker.limited` in the desk: one line, the reset epoch, a tab, the reset ISO instant, a tab, and the limit line. The file name matches `PLOT_WORKER_RECORD` (`plot-worker-state.sh:89`) and the monitor's tree fingerprint drops `.plot-worker.` files (`plot-worker-monitor.sh:419-420`), so no dirt reading counts it as work. Three readers use it:

- **The worker monitor treats the reset as the agent's last sign of life.** `sample_verdict` measures transcript silence from the later of the newest transcript line and the reset epoch, and **clamps a negative silence to 0**. During the wait the silence is 0, the verdict is `busy`, and no `idle` is published; after the reset the quiet window starts again, and the resumed prompt has the whole window to write its first line. Without the clamp the subtraction would give a negative number, which the `*[!0-9]*` arm (`:533`) answers `unknown`. The monitor stays the one writer of the findings file.
- **`/plot-fleet --status`** prints *"waiting on a usage limit until <time>"* only while the reset epoch is later than now (`plot-fleetctl.sh` already reads the clock in its desk loop at `:766-796`). The file stays after the reset, because the monitor measures silence from it, so a line printed whenever the file exists would tell an operator the next morning that an agent waits when it resumed hours ago.
- **The loop** overwrites the file at each limit and removes it when the slice ends, the agent hops, or the worker ends.

**The board during a wait.** The board does not read `.plot-worker.limited`. Its reader for a desk is the worker's pid, the monitor logs (`packages/board/src/server/findings.ts:39-43`) and the CPU activity sample (`plot_worker_activity`, `plot-worker-state.sh:676`). A waiting agent therefore shows as a `running` row with the idle activity cue, because a sleeping loop uses no CPU, and with no monitor finding, because the monitor publishes none during the wait. A label that names the limit is a follow-up; this plan names it in "What this does NOT do".

**The sentences read the desk.** Before the loop prints *"without the agent doing any work"*, *"the desk is untouched"* or *"no slice was ever worked"*, it reads two facts. Commits: `git rev-list --count "origin/$main_branch..HEAD" -- .` in the desk. The `-- .` pathspec drops the empty claim commit, as the remote-ref count at `plot-dispatch.sh:2049-2056` does; `HEAD` includes unpushed commits, and a `--restart` desk with no claim commit from this process reads the same way. Uncommitted paths: `plot_worker_dirty` (`plot-worker-state.sh:389`, sourced at `plot-worker-loop.sh:712`), which drops the loop's own `.plot-worker.*` files. Where either count is above zero, the sentence names it instead (*"2 commits since the claim and 10 uncommitted paths are in the desk"*), on the retry line, on the final line and in the marker, on both the `end-limited` and the `unstarted` path.

**The ending gains one reason.** `EndingReasonSchema` gets `limited`, and `endingIsAttributable` admits actor `agent` for `limited` as it does for `unstarted`: no watcher produced either ending, and the harness answered the agent's own process.

### What this does NOT do

- **It does not predict a limit.** The loop does not read the account's remaining usage before a prompt. It reacts to the answer the harness gives.
- **It does not change the supervisor or the board.** A waiting agent is a running process with a live claim; the supervisor answers `leave` for a live worker (`rules/supervision.ts`), and the board shows it as described above. A board label for the wait is a follow-up.
- **It does not spend real usage in a test.** Every test uses a fake harness that prints a limit line.

### Open Points

- [ ] The pattern table's first entries are the line measured in #1141 and the five limit names read from the 2.1.286 binary. A reset shape not yet measured, such as a weekly reset with a date or a spend cap's month, reads `unknown` and ends the worker until it is measured and added.
- [ ] Whether the harness exits 0 on a limit is not established. The design handles both answers; the first slice-2 run that observes a real limit records the status in the issue.

## Slices

### The rule names a usage limit (Branch: bug/the-rule-names-a-usage-limit)

`rules/prompt-exit.ts` with the four answers, the reset reading, the wait-allowed and without-progress decisions; `adapters/harness/limit-lines.ts`, a constant and no function; `packages/board/src/server/entry/prompt-exit.ts` joining them; `EndingReasonSchema` gains `limited`, `endingIsAttributable` admits it, and `packages/domain/test/ending.test.ts:45`, which pins the reason list, gains it. The bundle `board/plot-prompt-exit.mjs`: its block in `packages/board/build.mjs`, its line in `packages/board/src/contract/bundles.generated.ts`, its `-merge` line in `.gitattributes`, the committed artifact, and a Helper Scripts row in `CLAUDE.md`. `docs/shell-and-domain.md` §1 records that a call made once per prompt exit asks the domain while the idle pass still duplicates. Domain tests at 100% branch coverage:

- the #1141 line in `Europe/Zurich` across a day boundary answers `wait` with matching epoch and ISO fields;
- a reset 60 s past answers `wait` with the reset epoch equal to now, so the loop sleeps the margin only; a reset 200 s past resolves to tomorrow;
- a line with no reset, and an unreadable time, answer `end-limited` with `no-reset`;
- a reset past the bound answers `end-limited` with `past-bound`, and a bound of 0 allows it;
- a limit after a wait, under 600 s, with no new commit answers `no-progress`; the same with one new commit answers `wait`;
- `fast limit` and `monthly spend limit` lines with no readable reset answer `end-limited`;
- a status-0 output whose last non-empty line is the limit line answers `wait`; a status-0 output that quotes the #1141 line before a final line of other text answers `ran`;
- an unknown harness and an empty pattern set answer `unstarted` or `ran` by status;
- an exit with the wait flag `0`, a run time of 5 s and a commit count of `0` that carries the #1141 line answers `wait`, never `no-progress`.

- `bug/the-rule-names-a-usage-limit` — the rule, the adapter, the entry and the bundle <!-- builds: promptExit, a rule that classifies a prompt exit -->

### The loop waits out a usage limit (Branch: bug/the-loop-waits-out-a-usage-limit)

`plot-worker-loop.sh` captures the prompt's output with `> >(tee -a "$out") 2>&1 &`, asks the bundle on every exit with `${PLOT_HARNESS:-claude}` and the counts above, falls back to today's paths when the bundle cannot answer, writes and removes `.plot-worker.limited`, sleeps in clock-checked steps as `_wait_sleep_pid`, records the desk `HEAD` when a wait starts and counts commits from it after the resumed prompt, and reads the desk for its sentences. `plot-worker-monitor.sh` reads `.plot-worker.limited` in `sample_verdict` and clamps a negative silence. `plot-fleetctl.sh --status` prints the waiting line while the reset is in the future. Tests extend the start-failure fixture in `test/reconcile/second-slice.test.mjs:370-440`, each with a fake harness, `PLOT_LIMIT_MARGIN_SECONDS=0` and a clock offset:

- a limit with a reset 2 s ahead waits and resumes the same slice without raising `attempts`;
- the same case with `PLOT_HARNESS` set and empty still waits;
- the monitor runs beside the loop with a 1 s window and interval on a desk with commits; no finding is published during the wait, and the resumed prompt runs to exit 0;
- a limit that returns within 600 s of a wait with no commit since the `HEAD` recorded at the start of the wait ends with `limited`; a limit after a resumed prompt that committed waits again;
- a limit with no reset ends at once with the limit marker, which names the commit and dirt counts;
- a status-0 run whose last line is the limit line waits; a status-0 run that quotes the line earlier finishes the slice;
- the bound ends a prompt whose output is captured, and no prompt process remains afterwards;
- a missing bundle keeps today's three retries;
- `--stop` during a wait ends the loop within one step;
- `plot-fleetctl.sh --status` over a desk whose file names a future reset prints the waiting line, and over a desk whose file names a past reset does not;
- a plain failure keeps today's three retries; a desk with commits and dirty paths names both counts, and the loop's own `.plot-worker.*` files are not counted.

- `bug/the-loop-waits-out-a-usage-limit` — the loop, monitor and status wiring, and the desk-reading sentences <!-- builds: the usage-limit wait in plot-worker-loop.sh -->

## Notes

Waits on nothing outside this plan. Slice 2 needs slice 1's bundle.
