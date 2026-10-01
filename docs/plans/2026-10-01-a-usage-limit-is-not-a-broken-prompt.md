# A usage limit is not a broken prompt

> When the harness stops on the account's usage limit, the worker loop reads the exit as a prompt that cannot start: it retries three times in seconds, ends the worker, and writes a `PLOT-BLOCKED` that tells a person to fix a prompt file that works. The limit message names its own reset time, and the loop discards it.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1141
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A worker that stops on the harness's usage limit waits until the limit resets and resumes the same slice, instead of spending its retry budget in seconds.
- A limit with no readable reset, or one past the worker's bound, ends the worker with a marker that names the limit and the `--restart` to run after it, not a prompt fix.
- A failed prompt reads the desk before it says that no work was done: commits since the claim and uncommitted changes are named.

## Motivation

Measured 2026-10-01 on a Bitbucket estate (Plot 2.22.1, branch `feature/ewzkus-3845-smartmeter`), reported in #1141:

- The agent's first prompt worked: two commits pushed, a third part uncommitted in the desk (10 files).
- The next prompt exited 1. The harness printed `You've hit your session limit · resets 5:20pm (Europe/Zurich)`.
- The loop printed *"the prompt failed to run … without the agent doing any work … the desk is untouched; retrying (1 of 3)"* three times in a row, then *"no slice was ever worked … ending worker"*.
- `PLOT-BLOCKED.md` said *"Nothing was implemented … fix the invocation in the prompt file"*. Three statements in it are false: work was implemented, the desk was not untouched, and the invocation needed no fix.

The same failure happened on this repository on 2026-10-01: a desk-root worker hit the limit, ended, and sat free with unpushed commits until a person recovered the desk.

Verified on `origin/main`:

- `plot-worker-loop.sh:2008-2021` handles every non-zero prompt exit the same way. Below `START_ATTEMPT_BUDGET` (3, `:366`) it raises `attempts` and runs `continue` with no delay. At the budget it writes the ending `unstarted` and the marker quoted above.
- The loop never reads what the prompt printed. `run_bounded` starts the prompt with `bash -c '. "$1"' _ "$prompt_file" &` (`:1675`); its output goes to `.plot-worker.log` through the wrapper and the loop keeps only `_prompt_status`.
- The sentences *"the desk is untouched"* and *"no slice was ever worked"* are constants. Nothing reads the desk before they are printed.
- `EndingReasonSchema` (`entities/ending.ts:55`) has no reason for a limit, and `endingIsAttributable` (`transitions/agent.ts:390`) admits the actor `agent` only for `unstarted`.

## Design

### Approach

**The classification is a domain rule, and the message patterns are an adapter's reading.** *Is this exit a usage limit, a prompt that could not start, or something else?* is a decision, so it lives in `packages/domain/src/rules/prompt-exit.ts` and names no vendor. What a given harness prints when it hits a limit is a fact about that harness, so the patterns live in an adapter under `packages/domain/src/adapters/harness/`, keyed by the `PLOT_HARNESS` value the prompt template already reads (`templates/worker-prompt.sh:136`). A harness the adapter does not know supplies no patterns, and every exit from it reads as today.

**The loop asks the rule through a bundle, and does not keep a copy.** The cost rule in `CLAUDE.md` permits a declared shell duplicate for a script that runs once per agent per pass. This question is asked less often than that: only on the path where the prompt exited non-zero, which a working agent never reaches. The loop already asks `plot-prompt.mjs` once per pass (`:1106`), so one more `node` start on a failure path adds no new cost class. A shell copy would need a corpus test to hold the pair together, and would gain nothing. The bundle is `skills/plot/scripts/board/plot-prompt-exit.mjs`: the prompt's output on stdin, the exit status, the harness name and the current time as arguments, one answer line on stdout.

**The rule answers three outcomes:**

| Outcome | When | Carries |
|---|---|---|
| `limited` | the output matches a limit pattern for this harness | the reset as an instant, or `unknown` when the message names none or the time cannot be read |
| `unstarted` | no limit pattern matched | nothing new; this is today's path |
| `ran` | the status is 0 | nothing; the rule is not asked on this path, and the outcome exists so the rule is total |

Reading the reset is part of the rule: the message gives a wall-clock time and an IANA zone (`5:20pm (Europe/Zurich)`), and the rule turns it into the next instant at that time in that zone, after `now`. A time it cannot read is `unknown`, never a guess.

**The loop acts on the answer:**

- **`limited` with a reset inside the bound.** The loop does not raise `attempts`. It logs *"usage limit on <branch> until <time>; waiting"*, sleeps until the reset plus a 60 s margin, and runs `continue`, so the same slice resumes on the same desk. The wait is allowed only when the reset is in the future and no more than `Worker bound` seconds away. One wait per slice: a second `limited` answer right after a wait ends the worker as below, so a limit that does not lift cannot hold an agent forever.
- **`limited` with no usable reset**, or with a reset past the bound. The loop ends the worker with the new ending reason `limited`, actor `agent`, and a `PLOT-BLOCKED` marker that says: the harness reported a usage limit, until `<time>` or *with no reset time*; the slice stays claimed; run `/plot-dispatch --restart <branch>` after the limit lifts. It names no prompt fix.
- **`unstarted`.** Today's retry path, unchanged in budget and in exit code.

**The sentences read the desk.** Before the loop prints *"without the agent doing any work"*, *"the desk is untouched"* or *"no slice was ever worked"*, it reads two facts: commits on the branch beyond the claim commit, and the desk's uncommitted paths through the sourced `plot-desk-dirt.sh`. Where either is non-empty, the sentence names the count instead (*"2 commits since the claim and 10 uncommitted paths are in the desk"*), on the retry line, on the final line and in the marker. This applies to both the `limited` and the `unstarted` path.

**The ending gains one reason.** `EndingReasonSchema` gets `limited`, and `endingIsAttributable` admits actor `agent` for `limited` as it does for `unstarted`: no watcher produced either ending, and the harness answered the agent's own process.

### What this does NOT do

- **It does not predict a limit.** The loop does not read the account's remaining usage before a prompt. It reacts to the answer the harness gives.
- **It does not change the supervisor or the board.** A waiting agent is a running process with a live claim; how the board labels it is a follow-up.
- **It does not spend real usage in a test.** Every test uses a fake harness that prints a limit line and exits 1.

### Open Points

- [ ] The idle monitor watches the agent's transcript while a prompt runs. The wait happens between prompts, outside `run_bounded`, so the monitor is not running; the implementer confirms this on `origin/main` before relying on it.
- [ ] The adapter's first pattern set is the message measured in #1141. Other limit messages from the same harness are added when they are measured, not guessed.

## Slices

### The rule names a usage limit (Branch: bug/the-rule-names-a-usage-limit)

`rules/prompt-exit.ts` with the three outcomes and the reset reading; the harness adapter with the measured pattern; `EndingReasonSchema` gains `limited` and `endingIsAttributable` admits it; the bundle `board/plot-prompt-exit.mjs` and its entry. Domain tests at 100% branch coverage: the #1141 message in `Europe/Zurich` across a day boundary, a message with no reset, an unreadable time, an unknown harness, status 0.

- `bug/the-rule-names-a-usage-limit` — the rule, the adapter and the bundle <!-- builds: promptExit, a rule that classifies a failed prompt exit -->

### The loop waits out a usage limit (Branch: bug/the-loop-waits-out-a-usage-limit)

`plot-worker-loop.sh` keeps the prompt's output for the pass in a temp file created through `plot-tmp.sh`, asks the bundle on a non-zero exit, and acts on the answer as the Approach states. The retry, final and marker sentences read the desk. `workerloop.test.mjs` cases, each with a fake harness: a limit with a reset inside the bound waits and resumes without raising `attempts`; a second limit after a wait ends with `limited`; a limit with no reset ends at once with the limit marker; a plain failure keeps today's three retries; a desk with commits and dirty paths names both counts.

- `bug/the-loop-waits-out-a-usage-limit` — the loop wiring and the desk-reading sentences <!-- builds: the usage-limit wait in plot-worker-loop.sh -->

## Notes

Waits on nothing outside this plan. Slice 2 needs slice 1's bundle.
