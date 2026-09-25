# One word answers two questions about a wave

> `plot-fleet-scan.sh` prints a wave as **eligible** and, in the same run, reports `eligible=0` in its footer while `--list-eligible` and `--next` answer nothing at exit 0. Reproduced on this estate 2026-09-25: two waves printed `eligible`, the footer read `eligible=0`, and both offer paths were silent. The word means *this wave's prerequisites are met*; the counter means *a branch here can be claimed now*.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #994
- **Sprint:** plot-works-in-the-repos-that-adopt-it

## Changelog

- The scan distinguishes a wave whose prerequisites are met from a wave with a branch anyone can start. An operator reading `eligible` in the body and `eligible=0` in the footer is no longer reading two answers to two different questions in one word.

Board impact: **yes.** The board's `verdict` field carries the same word, so a wave rendered `eligible` with nothing startable has the same ambiguity on screen.

## Motivation

**Reproduced here, 2026-09-25, in one run:**

```
  A row says whose it is — eligible
  The readers agree about what an item is — eligible

  summary: … eligible=0 blocked=1 …

$ plot-fleet-scan.sh --list-eligible ; echo $?
0
```

Two waves print `eligible`. The footer counts zero. Both offer paths are silent and exit 0.

**Nothing here is a lie, and that is the problem.** Both waves are eligible in the sense the body means — their prerequisite waves are complete. Neither has a branch anyone can start: one is claimed with a live worker, the other is claimed and in progress. The footer and the offer paths both mean *claimable*, the body means *unblocked*, and one word carries both.

**The reporter saw the harder version of the same shape** (#994, Bitbucket, plan `ewzkus-3845-gpsync-abloesen`): one wave eligible, eleven branches, and `--next` silent at exit 0. An operator following the body's advice runs the offer path and is told nothing, with an exit code that means *success*.

### Why exit 0 makes it worse

`--next`'s contract is *exit 1 = nothing to start*. Exit 0 with no output is neither an offer nor a refusal, and a caller gating on the exit code reads it as an answer. `plot-dispatch.sh --next` consumes exactly this.

## Design

### The two questions, named separately

| question | who asks | today |
|---|---|---|
| are this wave's prerequisites met? | the body, the board's badge | `eligible` |
| is there a branch here I can start now? | the footer, `--next`, `--list-eligible`, auto-dispatch | `eligible` |

**The first is about the WAVE and the second about its BRANCHES**, and a wave can satisfy the first while no branch satisfies the second — which is the normal state of a wave being worked on.

### What to change

The rule is naming, not logic: both answers are already computed correctly. The scan must **say which it means** wherever it prints the word, and `--next` must distinguish *nothing is startable* from *nothing was asked*.

- The body names a wave whose prerequisites are met but whose branches are all taken as something other than bare `eligible` — the branch lines already say `claimed` and `in progress`, so the wave line should agree with them rather than contradict them.
- **`--next` exits 1 when it has nothing to offer.** Exit 0 with empty output is the defect the reporter's caller tripped on.
- `--list-eligible` prints nothing and exits 0 only when it genuinely listed an empty set; where every candidate was filtered by a claim, it says so.

### What this does NOT do

- It does not change which waves are eligible or which branches are claimable. Both computations are correct.
- It does not rename the board's `verdict` enum. `FleetWaveSchema.verdict` is a strict enum and a parsed pulse cannot carry an unknown value; widening it is a separate change with its own consumers.
- It does not touch auto-dispatch, which already reads the claimable answer correctly.

### Open questions

- [ ] **Does the board's badge read the wave answer or the branch answer?** If the badge says `eligible` while every branch is claimed, it has the same ambiguity and the same fix — but the enum constrains what can be said, so the fix may differ.

## Done when

- A run where every eligible wave's branches are claimed prints a body that agrees with its own footer. The estate reproduces this today, so the before/after is measurable here.
- `--next` exits **1** when it offers nothing, and a test asserts it.
- `--list-eligible` distinguishes an empty estate from one where every candidate was claimed.
- The footer counters are unchanged — they already answer the claimable question correctly.
- A test driving the reproduced shape: a wave whose prerequisites are met and whose only branch is claimed.

## Slices

### A wave says which question it answered (Branch: bug/a-wave-says-which-question-it-answered)

- `bug/a-wave-says-which-question-it-answered` — the body's wave line agrees with its branch lines where every branch is claimed; `--next` exits 1 when it offers nothing rather than 0 with empty output; `--list-eligible` names a claimed-out candidate set rather than printing nothing; tests for the reproduced shape, for a genuinely empty estate, and for a wave with one free branch

## Notes

- Reported from a Bitbucket estate at 2.20.0 with an eleven-branch plan. **Reproduced on this GitHub estate with two waves**, so it is neither host-specific nor a function of plan size.
- **The offer paths are not wrong.** Both correctly decline to offer a claimed branch. What is wrong is that the body uses their word for a different question, and that `--next` reports having nothing with the exit code for success.
