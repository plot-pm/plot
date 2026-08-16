# A worktree with uncommitted work is not quiet

> The fleet reads refs, and an agent editing files writes none. So a branch
> someone is actively working reads as abandoned — on the one machine that
> could have known better.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- A branch whose local worktree has uncommitted changes reads as **working**
  rather than quiet, with a note saying the evidence is local. Branches on
  other machines are unaffected — they answer from refs exactly as before.

Board impact: **yes.** `plot-fleet-scan.sh` reports one more per-branch field
and the board renders it; no plan-format change. The artifact is rebuilt, so
the Definition of Done's no-diff gate applies.

## Motivation

Three agents were dispatched on 2026-08-16 and all three were working. The
board showed two.

The third branch had been claimed a day earlier and *resumed* today, so its
claim commit was 21 hours old while its work was minutes old. `classify()`
separates fresh claims from stale ones by that commit's age — correct for a
first dispatch, blind to a resumption. The row read:

    quiet · no commit for 21 hours

The **note is true**. The **group is wrong**, and that distinction is the
finding. QUIET means *go check whether it died*; following that instruction
found a live agent with three modified files. A group that sends you to
investigate where there is nothing to investigate is a wrong answer, in exactly
the shape already fixed twice before — `merged` reading as quiet, and fresh
claims reading as quiet. Right state, wrong group, third time.

What makes this one different is that the earlier two were fixed with data the
classifier already had. Here the refs genuinely do not know: an agent that has
edited files and not committed has written nothing git can see.

## Design

### Approach

**The scan already stands where the answer is.** `git worktree list --porcelain`
names every worktree and its branch, and `git -C <path> status --porcelain`
says whether the tree is dirty. Both are local, and `plot-fleet-scan.sh` runs
on the machine that owns them. Measured: **58 ms for three worktrees**,
against a scan that already takes 0.5–1.05 s. The cost is not the question.

The question is what it means. So the scan reports one new per-branch field —
`local_dirty` — and `classify()` uses it only to *lift* a branch out of quiet:

    refs say : claimed, no commit for 21 hours
    local    : worktree exists, 3 files modified
    → group  : working
      note   : "uncommitted work in a local worktree"

**It is additive, and it says so.** The note names the evidence as local
because that is what a reader needs to judge it: work that has not been
committed is also work nobody else can see, and a row claiming *working* on
grounds the next person cannot verify would be its own kind of lie. Saying
*local* keeps the claim honest.

**Absent is not false.** On a machine that has no worktree for a branch — every
detached worker, every teammate's laptop, every CI run — the field is simply
absent and the branch answers from refs exactly as it does today. That is the
whole reason this can be added at all: it can never *downgrade* an answer, only
add one where the machine happens to know more.

This is the tension worth stating plainly rather than papering over. The fleet
derives state from refs **precisely so** it works for workers on other
machines; a worktree signal is true only for the machine doing the looking. The
resolution is not to pretend otherwise but to keep the signal strictly
one-directional: refs remain the shared truth, and local knowledge may only
make a *local* view more accurate. Two people looking at the same fleet from
different machines will see different notes on the same row — and that is
correct, because they genuinely know different things.

**Dirty, not present.** A worktree that exists but is clean says nothing: it is
equally consistent with an agent that finished and one that never started. Only
uncommitted changes are evidence of work in progress, so only dirtiness lifts
the group.

**Manifesto check.** Principle 1 holds where it must: refs remain the source
for anything shared, and nothing is written anywhere. Principle 3: the scan
collects the fact, the classifier interprets it. Principle 12: the row reports
what was observed on this machine and labels it as such, rather than asserting
a liveness it cannot prove.

### Open Questions

- [ ] Should a **clean** worktree show anything at all — say, that the branch
      is checked out here? It is genuinely useful for "where did I put this"
      and genuinely not evidence of work. Probably a different column, not this
      group.
- [ ] `git status` on a large repo is fast but not free. Three worktrees cost
      58 ms; twenty would cost proportionally more on a 5 s timer. Worth a cap,
      or does the fleet-scan's own runtime dominate long before that matters?

## Branches

- `bug/fleet-sees-local-work` — `local_dirty` in the scan's JSON, `classify()` lifts dirty worktrees out of quiet, tests for both directions

<!-- One branch: the scan field and its only consumer are one change, and
     landing either alone leaves a field nobody reads or a reader with no
     field.

     NOT concurrent with `bug/board-claimed-from-git`, which is in flight and
     is editing `fleet.ts` and `fleet.test.ts` — the same two files this needs.
     Start after that merges. Checked, not assumed: its worktree shows both
     files modified. -->

## Notes

Found on 2026-08-16 while running three agents at once — the first fan-out in
this repo where branches were genuinely concurrent. The board reported two of
three working, and the missing one was the branch that had been resumed rather
than freshly dispatched.

The first reading of this was too forgiving: *"not wrong, just incomplete"*.
Pushed on it, that does not hold — QUIET carries an instruction, the
instruction was wrong, and being wrong about which of five groups a row belongs
in is the only thing this tab does. Recorded in the story with the correction
rather than the original judgment.

Deliberately not here: making agents commit more often. That would remove the
symptom by pushing the burden into every agent prompt — a rule, not a gate, and
one that would be quietly violated the first time an agent had a reason not to
commit.

Definition of Done: `docs/definition-of-done.md`.
