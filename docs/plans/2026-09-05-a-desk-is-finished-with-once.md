# A desk is finished with once

> `plot-reap.sh` asks the domain whether a worktree may go. `plot-release-refs.sh` answers the same question about the same desk with its own five guards — and it is the one that deletes something no `git worktree add` can bring back.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #705 merged
- **Started:** 2026-09-07, Jan Wloka, `feature/finished-with-is-one-rule`
- **Started:** 2026-09-07, Jan Wloka, `feature/the-ref-deleter-asks-the-rule`

## Changelog

- Removing a worktree and deleting its branch's ref ask one domain rule, so the reaper and the ref-deleter cannot disagree about whether a desk is finished with.

Board impact: none. Neither script is on the board's read path.

## Motivation

**One question, two implementations, and the dangerous one is the copy.**

`plot-reap.sh` states its own shape in its header: it *"reads
`packages/domain/src/rules/reapable.ts`, and ACTS on the answer; it holds no
judgement."* Five refusals — a live worker pid, uncommitted changes, a
`PLOT-BLOCKED` marker, a tree on the default branch, no merged PR — each a
measurement, each in the domain, each with a test.

`plot-release-refs.sh` asks the same thing about the same desk and answers it
alone: five `kept=` guards at `:156`, `:166`, `:176`, `:186`, `:197`. A
`deferred:`/`moved:` branch, no merged PR, an **open** PR, a branch checked out
in any worktree, the default branch.

**The asymmetry is the argument.** `CLAUDE.md` already draws it: a reaped
checkout *"comes back with `git worktree add`"*, and a deleted ref *"does not"*.
The two scripts are ordered so the safe one runs first — and the unsafe one is
the one holding its own copy of the judgement.

### They already disagree in shape

The guards are not the refusals renamed. `plot-reap.sh` refuses on a live pid;
`plot-release-refs.sh` does not ask. `plot-release-refs.sh` refuses an **open**
PR — because `changeset-release/main` is merged repeatedly and Changesets reuses
the branch, so a live release PR sits on a ref whose older PR merged — and
`plot-reap.sh` does not.

**THE DIFFERENCES ARE DEFECTS, NOT DESIGN — SETTLED 2026-09-06.** The first
draft called each one *"deliberate and reasoned in its own script"*. Checked
against both scripts that day, and each is a blind spot rather than a choice:

```
plot-release-refs.sh   'pid' | 'running'   → 0 live references
plot-reap.sh           'pr_open'           → 0 live references
```

**So a ref can be deleted while a worker is live on its branch**, and **a
worktree can be reaped while an open PR stands on it.** Neither script refuses
what the other refuses, and neither omission was argued for anywhere — they are
what two independently-grown implementations look like.

**The rule therefore answers ONE question and the divergence closes.** A desk
that is not finished with is not finished with, whichever verb is about to act
on it. `mayReap` and `mayDeleteRef` may differ in what they permit — a deleted
ref is not re-creatable and a checkout is — but they may not differ in what they
have *looked at*.

**`rules/landed.ts` is the shape.** `landed`, `openPr` and `mayRemove` are three
functions over one `PrReadings`, and `mayRemove` permits a removal in exactly
one of nine combinations. The two verbs here read one `DeskReadings` and each
states its own permission over it; the readings are shared, the verdicts are
not.

**The old framing is kept because it explains how this arose.** Two correct-
looking answers to one question, with no single place saying why they differ,
and nothing failing when the next edit
makes one of them wrong.

### What it costs

Nothing yet, which is the point of doing it now. The measured failure this
prevents is the one the split invites: a change to what "finished with" means —
a sixth refusal, a corrected reading of `mergedAt` — applied to one script and
not the other, where the script that misses it is the one whose mistake cannot
be undone.

## Design

### Approach

**`finishedWith(readings)` in the domain, and both scripts ask it.**
`rules/reapable.ts` already holds the reaper's half; this extends it to answer
for a ref as well as a checkout, and `plot-release-refs.sh` calls it the way
`plot-reap.sh` already does — an inline `node` block that reads the rule and
acts on the verdict, holding no judgement of its own.

**The two verbs stay separate, because their blast radius differs.** The rule
answers *is this desk finished with, and what still holds it?* Removing a
checkout and deleting a ref are then two decisions taken on one answer, with
their own licences — the asymmetry `CLAUDE.md` records survives, stated once
instead of implied by two scripts.

**Where they legitimately differ, the rule says so.** An open PR keeps a ref and
does not keep a checkout; a live pid keeps a checkout and is irrelevant to a
ref. Those become named parts of one verdict rather than absences in two lists.

### Not chosen: making the ref-deleter call the reaper

It would collapse the difference the scripts exist to keep. Ref deletion is
plan-scoped where reaping is slug-blind, deliberately: a removed checkout is
re-creatable, so a broad sweep is cheap to get wrong, while a deleted ref is not
and its blast radius is bounded by the plan file.

### Open Questions

- [x] **Does the rule answer for a ref that has no worktree?** **Settled in round 2: `unknown` is a reading, and the caller decides what it means.**

      It is not the common case after a reap — it is the MAJORITY case. Measured
      2026-09-06: **22 of 32 remote branches have no worktree, 69%.** And **four
      of the reaper's five guards need a tree** — a live pid, uncommitted
      changes, a `PLOT-BLOCKED` marker, and what is checked out — leaving only
      `no merged PR`, which the host answers.

      So on 69% of the estate a shared rule is asked four questions it cannot
      answer, for the operation that cannot be undone. **Averaging them into a
      boolean would invent an answer**, and refusing on silence — the estate's
      rule for an unreachable host — would refuse deletion on 69% of branches
      and make the ref-deleter useless exactly where it is most needed.

      **So the rule returns a reading per condition, and `unknown` is one of
      them.** The reaper reads unaskable-because-no-tree as *nothing to reap*;
      the ref-deleter reads it as *no evidence against deletion*, which is what
      it already does today. The asymmetry stays visible rather than being
      averaged away.

## Slices

### Asking one rule

- `feature/finished-with-is-one-rule` — `finishedWith(readings)` in
  `rules/reapable.ts`, carrying both scripts' conditions with the ones that
  differ named rather than absent. **Asserted: an open PR keeps a ref and does
  not keep a checkout**, and **asserted: a live worker pid keeps a checkout and
  says nothing about a ref** — the two differences that are currently only
  visible by reading both scripts. (#754)

  **NEITHER SCRIPT GAINS THE OTHER'S GUARDS.** The rule states every condition;
  each caller declares which it asks and why. Round 2 settled this: the defect
  is that the difference is invisible, not that it is wrong.
  `plot-release-refs.sh:30` warns that folding them *"would silently widen a
  licence that was written narrow on purpose"*, and a rule that changed either
  script's behaviour would be doing exactly that under a refactor's name.

  **`unknown` IS A RETURN VALUE, NOT AN ERROR.** Four of the reaper's five
  conditions need a tree and 69% of branches have none. A condition that cannot
  be asked says so, and the caller decides — which is the only shape that keeps
  one rule honest across two scopes.

### Asking it from the ref-deleter

- `feature/the-ref-deleter-asks-the-rule` — `plot-release-refs.sh` reads the
  verdict and acts, the way `plot-reap.sh:46` already describes itself.
  **Asserted: every ref the script kept before is kept after**, run over this
  estate's merged branches — a rule that deletes one more ref than the guards
  did is wrong in the direction that cannot be undone. (#772)

  **Measured over 209 delivered plans, 979 branch verdicts: 0 differences.** The
  two scripts agree exactly, not merely in the asserted direction. The
  comparison holds the host constant — a first pass against the live host
  produced 173 spurious flips, because an unreachable host answers *not merged*
  and that keeps a ref, so host flakiness moves verdicts on its own.

## Notes

Written 2026-09-05, for the `routed` condition the sprint added: no script
changes a lifecycle state without asking the domain.

**The measurement corrected a first reading.** A grep for bundle names
(`plot-transition.mjs`, `plot-verdicts.mjs`) reported `plot-reap.sh` as having
zero domain calls, which would have made this plan about two scripts. It reads
`rules/reapable.ts` through an inline `node` block instead, and says so in its
header — so the plan is about one script, and the other is the worked example it
should copy.

### Round 1 — 2026-09-06

**It leads `a-desk-is-adopted-and-swept`'s second slice.** That plan adds
`prunable` as a sixth reading to `plot-reap.sh` and routes it through
`ports/trees.ts`. Both edit the reaper's decision path, and adding a reading to
one script while the other holds a divergent copy means writing it twice or
widening the gap. **Unify first; the new reading then lands in one place.**

**And the divergences were reclassified.** The plan argued them as deliberate;
they are blind spots, measured above. That changes what the rule must do — one
question, one set of readings — rather than preserving two half-answers behind a
shared interface.

### Round 2 — 2026-09-07

**The Open Question was the whole risk, and it is bigger than it reads.** *"Does the rule answer for a ref that has no worktree?"* — measured, **22 of 32 remote branches have no worktree**. Not the common case after a reap: the **majority case**, 69%.

**And four of the reaper's five guards need that tree** — live pid, uncommitted changes, `PLOT-BLOCKED`, what is checked out. Only `no merged PR` survives without one.

So a shared rule is asked four unanswerable questions on two branches in three, for the one operation no `git worktree add` can undo. **Three shapes were possible and two are wrong:** a boolean invents an answer; refusing on silence — the estate's rule for an unreachable host — would block deletion on 69% of branches and make the ref-deleter useless where it matters most.

**`unknown` per condition, with the caller deciding**, is what keeps the asymmetry visible. The reaper reads no-tree as *nothing to reap*; the ref-deleter reads it as *no evidence against deletion*, which is its behaviour today.

**Neither script gains the other's guards.** The reaper has no `pr_open` and no `deferred:`/`moved:`; the ref-deleter has no live-pid and no `PLOT-BLOCKED` — verified by reading both. **The defect is that this difference is invisible, not that it is wrong**, and `plot-release-refs.sh:30` says a fold *"would silently widen a licence that was written narrow on purpose."*

**Slice 2's assertion stays one-directional on purpose.** *Every ref kept before is kept after* is trivially satisfied by a rule that refuses everything — and that is the acceptable failure. A rule keeping too many refs costs scan time; one deleting too many destroys work. The asymmetric assertion matches the asymmetric cost.

**And the wait `a-desk-is-adopted-and-swept` records is correct.** `bug/the-reaper-reads-prunable` adds `prunable` as a sixth reading to the reaper's decision path; adding it while the ref-deleter holds a divergent copy means writing it twice or widening the gap.
