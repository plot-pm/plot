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

A clean worktree therefore shows **nothing at all** — not even "checked out
here". That would answer a different question (*where did I put this*), and the
row has no space left for it: after `board-ui-polish` a line already carries
plan, branch, note, PR and age, and the phase is due to take the repo cell.

**Any state that would otherwise read quiet**, not only `claimed`. The
motivation above describes a resumed claim, but the same blindness applies to
`wip`: a branch whose last commit is weeks old and whose worktree is dirty is
someone working, with git seeing nothing — and that is what the board shows
today, where all six quiet rows are `wip` rather than `claimed`. The rule is
the general one the design already states: a dirty worktree lifts a branch out
of quiet, whatever put it there.

**Manifesto check.** Principle 1 holds where it must: refs remain the source
for anything shared, and nothing is written anywhere. Principle 3: the scan
collects the fact, the classifier interprets it. Principle 12: the row reports
what was observed on this machine and labels it as such, rather than asserting
a liveness it cannot prove.

### No cap, and the measurement is the reason

`git status` is fast but not free, and a 5 s timer invites the question. It is
answered rather than guarded: **6.6 ms per worktree**, so twenty cost ≈133 ms
against a scan that already runs 500–1050 ms. The scan dominates by four to
eight times, and the four worktrees this repo carries today cost 66 ms in total.

So no cap. One would be stock against a problem the measurement rules out, and
caps have a known price — they drop results silently unless they also report
saturation, which is machinery for a case that does not arise. If a repo ever
does carry enough worktrees to matter, the scan's own runtime will have become
the complaint long before this line does.

### The path is collected anyway, so the plan modal shows it

`git worktree list --porcelain` returns the **path** alongside the branch, and
this plan already parses that output — the path is read and then dropped.
Keeping it costs nothing and answers a question the row cannot: *where is this
checked out on my machine.*

It belongs in the **plan modal**, not the row. The row is a triage line and is
already full; a filesystem path is what you want once you have stopped
triaging and decided to go look. So the modal for a plan whose branch has a
local worktree shows its path — copyable, since the next thing anyone does with
it is `cd`.

**Local, and labelled as such**, for the same reason the note is: the path is
true on this machine and meaningless on any other. A modal opened on a
teammate's laptop shows no path rather than a path that does not exist there —
the same rule as `local_dirty` itself, and the reason this can be added without
weakening the refs-are-truth principle.

**Present, not dirty.** Unlike the group lift, the path is worth showing for a
*clean* worktree too: "where did I put this" is exactly the question a clean
checkout answers. That is the one place the clean/dirty distinction goes the
other way, and it is consistent — dirtiness is evidence of *work*, presence is
evidence of *location*, and the modal is asking about location.

## Done when

- **A branch with a dirty worktree reads `working`, not `quiet`**, with a note
  naming the evidence as local. Assert for a `claimed` branch *and* a `wip`
  one: the motivation describes the first, the board shows the second, and a
  test for only one leaves the other to chance.
- **A clean worktree changes no group.** It is equally consistent with finished
  and never-started, so it must not lift anything.
- **A branch with no worktree on this machine answers exactly as today.**
  This is the assertion that keeps the change additive; without it, a
  regression that downgrades remote branches would pass unnoticed.
- **The plan modal shows the worktree path when one exists locally**, labelled
  as local, and shows nothing where it does not. Assert the absent case too —
  a path that does not exist on the reader's machine is worse than no path.
- **No cap, and no host call.** The scan stays git-only and local; assert the
  invocation count rather than the runtime, since timing cannot catch a call
  that is merely slow.
- `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.

## Branches

- `bug/fleet-sees-local-work` — `local_dirty` in the scan's JSON, `classify()` lifts dirty worktrees out of quiet, tests for both directions

<!-- One branch: the scan field and its only consumer are one change, and
     landing either alone leaves a field nobody reads or a reader with no
     field.

     The blocker named here — `bug/board-claimed-from-git` — merged as #123, so
     that constraint is discharged. `fleet.ts` has taken five more commits
     since (#132 through #136); the `claimed` arm of `classify()` this plan
     edits is unchanged, checked rather than assumed.

     Still not concurrent with `agent-view-phase` (#131), which adds a phase
     field to the same rows and the same two files. Whichever is approved
     first should merge first. -->

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

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Only `claimed`, or any state that would otherwise read quiet?", "a": "Any state — the six quiet rows on the board today are `wip`, not `claimed`, and a dirty worktree means the same thing whatever put the branch there", "category": "domain-rules"},
    {"q": "Does git status need a cap across many worktrees?", "a": "No — measured 6.6 ms each, so 20 cost ~133 ms against a 500-1050 ms scan. A cap would be stock against a problem the measurement rules out", "category": "nonfunctional-performance"},
    {"q": "Should a clean worktree show anything?", "a": "Nothing in the ROW. It answers a different question, is not evidence of work, and the row has no space left after board-ui-polish", "category": "ux-layout"},
    {"q": "Can the plan modal show the worktree path?", "a": "Yes — `git worktree list --porcelain` already returns it and this plan drops it. In the modal rather than the row, labelled local, and shown for clean worktrees too: dirtiness is evidence of work, presence is evidence of location", "category": "ux-happyPath"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": false},
    "domain": {"rules": true, "workflows": false, "data": false},
    "ux": {"happyPath": true, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
