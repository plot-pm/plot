# The default runner has a spend cap

> A slice that runs on the default `command` runner stops starting runs once its tokens reach `Slice max tokens`, as a slice on the SDK runner already stops at `Slice max spend`.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3698 merged

## Changelog

- A new `## Plot Config` key, `Slice max tokens`, caps the tokens that one slice's runs may total on either runner. Before each run the worker loop sums what the slice has spent so far. A slice at or above the cap starts no further run and ends `spend-limit`, the word an SDK run that reaches `Agent max spend` already ends with. With the key absent, nothing changes.

<!-- Board impact: the desk's ending reason `spend-limit` already has a board word. No plan format, template or docs/plans layout changes. -->

## Motivation

The fleet runs unattended, and the default runner has no ceiling. `Agent max spend` and `Slice max spend` (`skills/plot/scripts/plot-config.sh:163-168`) bound only the SDK runner, and both are blank by default. `Agent runner` is absent in Plot's own `CLAUDE.md`, so every agent here runs on `command` (`claude -p`) with no bound but `Worker bound` (28800 s) and `Correction budget` (2).

The research dossier of 2026-11-20 (`gap-spend-cap`) names this as the gap to close first: "Give the default runner a limit in tokens or dollars." It matters more as the fleet takes over the software-development part of the operator's home automation: a run that nobody watches needs a ceiling that nobody has to remember.

The record exists. `.git/.plot/state/slice-spend.jsonl` holds 82 lines on 2026-11-23, each with a branch, a time, the tokens by kind, the turns and the models. A `command` slice writes its line only when the slice is sealed, summed from its session transcripts (`packages/domain/src/workflows/slice-spend.ts:78-81`). An SDK slice writes one line per run (`worker-loop.ts:276`).

## Design

### Approach

- **Tokens, not dollars.** A `command` run reports no price, and its transcripts report tokens. One key in tokens bounds both runners with one number. `Slice max spend` stays for the SDK runner's dollars.
- **Read before each run.** The worker loop already reads the slice's record before each SDK run for `Slice max spend` (`worker-loop.ts:223`). For a `command` slice it also sums the slice's own session transcripts that are not yet sealed into the record, so a slice is bounded while it runs and not only once it ends.
- **One rule decides.** A domain rule, `sliceTokenCap(spent, cap)`, answers `under`, `reached` or `unread`. `unread` (a transcript that does not parse) starts the run and names the reason in the loop's log, because a reading failure must not stop the fleet. The key read follows `Slice max spend`: absent or blank is no limit, and a present value that is not a positive whole number refuses the worker's start.
- **Which tokens count.** Input, output and cache-creation tokens count. Cache-read tokens do not, because they are billed at a fraction and dominate every line of the record (6,680,819 cache-read against 26,060 output on the first line).

### Open Questions

- [ ] `[question-cache-reads]` Do cache-read tokens count at a weight, for example 0.1, instead of not at all? A weight makes the cap track the bill more closely and makes the key harder to choose.
- [ ] `[question-default]` Does Plot ship a default cap, or stay with no limit unless the key is set? A default changes behaviour for every adopter; no default leaves the unattended gap open until somebody sets the key.
- [ ] `[question-board]` Does the board show a slice's tokens against its cap, or only the ending reason?

## Slices

### Cap

- `feature/the-default-runner-has-a-spend-cap` — `Slice max tokens`, read before each run on both runners through `sliceTokenCap`, with unsealed `command` sessions summed from their transcripts; a slice at the cap ends `spend-limit` <!-- builds: sliceTokenCap and the Slice max tokens key --> <!-- tests: sliceTokenCap — under, reached and unread; the loop starts no run at the cap and logs unread; an absent key changes nothing -->

## Notes

Created on 2026-11-23 from the research dossier "Plot as a factory" (`gap-spend-cap`), for the sprint that prepares the hand-off of the operator's software-development work to Plot.
