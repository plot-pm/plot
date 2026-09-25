# One word answers two questions about a wave

> `plot-fleet-scan.sh` prints a wave as **eligible** and, in the same run, reports `eligible=0` in its footer while `--list-eligible` and `--next` answer nothing at exit 0. Reproduced on this estate 2026-09-25: two waves printed `eligible`, the footer read `eligible=0`, and both offer paths were silent. The word means *this wave's prerequisites are met*; the counter means *a branch here can be claimed now*.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #994
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1

## Changelog

- The scan distinguishes a wave whose prerequisites are met from a wave with a branch anyone can start. An operator reading `eligible` in the body and `eligible=0` in the footer is no longer reading two answers to two different questions in one word.

Board impact: **yes.** The board's `verdict` field carries the same word, so a wave rendered `eligible` with nothing startable has the same ambiguity on screen.

## Motivation

**Reported from a Bitbucket estate, 2.20.0, plan `ewzkus-3845-gpsync-abloesen`:** one wave
eligible, eleven branches, `--list-eligible` and `--next` both silent at exit 0.

**An earlier draft of this plan quoted a local reproduction. It does not reproduce today** —
the estate has moved since, and a transcript that cannot be re-taken is not evidence. The
defect below rests on the two computations differing, which is verified in the code rather
than in a run.

**Nothing here is a lie, and that is the problem.** Both waves are eligible in the sense the body means — their prerequisite waves are complete. Neither has a branch anyone can start: one is claimed with a live worker, the other is claimed and in progress. The footer and the offer paths both mean *claimable*, the body means *unblocked*, and one word carries both.

**The reporter saw the harder version of the same shape** (#994, Bitbucket, plan `ewzkus-3845-gpsync-abloesen`): one wave eligible, eleven branches, and `--next` silent at exit 0. An operator following the body's advice runs the offer path and is told nothing, with an exit code that means *success*.

### `--next` already does what an earlier draft proposed

`plot-fleet-scan.sh:27-30` documents it — *"print nothing and exit 1 when there is none …
the exit code, not stderr, is what says so"* — and it is implemented at `:4271` and `:3168`
and tested twice (`fleet.test.mjs:333`, `:367`). **That item is out of this plan**: proposing
a shipped contract as new work invites a worker to rewrite a passing gate.

Nor does the dispatcher read it. It calls `--list-eligible` (`:3471`, `:3519`) and gates on no
exit code at all, and `plot-worker-loop.sh:620` records that the worker's `--next` call was
removed. **No caller reads the exit code**, which lowers the priority of the whole reading.


## Design

### The two questions, named separately

| question | who asks | today |
|---|---|---|
| are this wave's prerequisites met? | the body, the board's badge | `eligible` |
| is there a branch here I can start now? | the footer, `--next`, `--list-eligible`, auto-dispatch | `eligible` |

**The first is about the WAVE and the second about its BRANCHES**, and a wave can satisfy the first while no branch satisfies the second — which is the normal state of a wave being worked on. Confirmed in the code: `eligible.ts:95-109` answers the wave question, `:168-172` the branch one.

### What to change

The rule is naming, not logic: both answers are already computed correctly. The scan must **say which it means** wherever it prints the word, and `--next` must distinguish *nothing is startable* from *nothing was asked*.

- **Rename the footer key.** `eligible=` sits between `waves=` and `blocked=` and counts BRANCHES while its neighbours count waves. `claimable=` ends the ambiguity in one line, with `eligible=` kept beside it if a consumer reads it. The header at `:96` already documents the mixed grain for the neighbouring keys and does not cover this one. **This is the sharpest available fix and the draft did not propose it.**
- The body names a wave whose prerequisites are met but whose branches are all taken as something other than bare `eligible`. The word and the grain come from `StartabilityVerdictSchema` (`schema.ts:1489`), the estate's existing answer to this ambiguity — **a prose suffix in the shell, not a sixth `SliceVerdict`**, so no schema changes. A branch counts as taken when it is claimed or in progress; `unknown` is excluded.
- `--list-eligible` says when every candidate was filtered by a claim — **on stderr**. Stdout is a branch-name list the dispatcher pipes into `sort -u` (`:3471`), so a sentence there becomes a dispatch target.

### What this does NOT do

- It does not change which waves are eligible or which branches are claimable. Both computations are correct.
- It does not rename the board's `verdict` enum. `FleetWaveSchema.verdict` is a strict enum and a parsed pulse cannot carry an unknown value; widening it is a separate change with its own consumers.
- It does not touch auto-dispatch, which already reads the claimable answer correctly.

### Open questions

- [ ] **Does the board's badge read the wave answer or the branch answer?** If the badge says `eligible` while every branch is claimed, it has the same ambiguity and the same fix — but the enum constrains what can be said, so the fix may differ.

## Done when

- The footer's branch-counting key is named `claimable=`, and a reader can tell it from the wave counts beside it.
- A wave whose prerequisites are met but whose branches are all taken prints a body line that agrees with its branch lines, using `StartabilityVerdictSchema`'s vocabulary as a prose suffix.
- `--list-eligible` distinguishes an empty estate from one where every candidate was claimed, **on stderr**, and stdout stays a bare branch list.
- **`--next` is untouched** — its exit-1 contract is shipped, documented and tested.
- A test for a wave whose prerequisites are met and whose only branch is claimed.


## Slices

### A wave says which question it answered (Branch: bug/a-wave-says-which-question-it-answered)

- `bug/a-wave-says-which-question-it-answered` — rename the footer's branch-counting key to `claimable=`, keeping `eligible=` beside it; the body's wave line agrees with its branch lines using `StartabilityVerdictSchema`'s words as a prose suffix, with claimed and in-progress counting as taken and `unknown` excluded; `--list-eligible` names a claimed-out candidate set on **stderr** so stdout stays a bare branch list; `--next` untouched; tests for a claimed-out wave, an empty estate, and a wave with one free branch

## Notes

- **Panelled 2026-09-25: `amend`, `Evidence: executed`.** The core diagnosis survived — two questions in one word, confirmed against `eligible.ts:95-109` versus `:168-172`, and *"the fix is naming, not logic"* upheld. Three things did not. The draft's **local reproduction no longer reproduces**, and a Done-when claiming the estate demonstrates it today was wrong. `--next`'s exit-1 contract is **already shipped**, documented at `:27-30`, implemented at `:4271` and `:3168`, and tested twice — proposing it invited a worker to rewrite a passing gate. And **no caller reads that exit code**: the dispatcher calls `--list-eligible` and gates on nothing. The juror also named the fix the draft missed — renaming the footer key to `claimable=`, one line, which ends the ambiguity at its source. Verdict file: `.plot/panels/one-word-answers-two-questions-about-a-wave/juror.md`.

- Reported from a Bitbucket estate at 2.20.0 with an eleven-branch plan. **Reproduced on this GitHub estate with two waves**, so it is neither host-specific nor a function of plan size.
- **The offer paths are not wrong.** Both correctly decline to offer a claimed branch. What is wrong is that the body uses their word for a different question, and that `--next` reports having nothing with the exit code for success.
