# A desk is finished with once

> `plot-reap.sh` asks the domain whether a worktree may go. `plot-release-refs.sh` answers the same question about the same desk with its own five guards — and it is the one that deletes something no `git worktree add` can bring back.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

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

**Each difference is deliberate and reasoned in its own script.** That is
exactly the state that decays: two correct answers to one question, with no
single place saying why they differ, and nothing failing when the next edit
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

- [ ] **Does the rule answer for a ref that has no worktree?** The common case
      after a reap. The reaper's readings assume a tree; the ref-deleter's do
      not, and a rule serving both has to say what a missing tree means rather
      than treating it as a refusal.

## Slices

### Asking one rule

- `feature/finished-with-is-one-rule` — `finishedWith(readings)` in
  `rules/reapable.ts`, carrying both scripts' conditions with the ones that
  differ named rather than absent. **Asserted: an open PR keeps a ref and does
  not keep a checkout**, and **asserted: a live worker pid keeps a checkout and
  says nothing about a ref** — the two differences that are currently only
  visible by reading both scripts.

### Asking it from the ref-deleter

- `feature/the-ref-deleter-asks-the-rule` — `plot-release-refs.sh` reads the
  verdict and acts, the way `plot-reap.sh:46` already describes itself.
  **Asserted: every ref the script kept before is kept after**, run over this
  estate's merged branches — a rule that deletes one more ref than the guards
  did is wrong in the direction that cannot be undone.

## Notes

Written 2026-09-05, for the `routed` condition the sprint added: no script
changes a lifecycle state without asking the domain.

**The measurement corrected a first reading.** A grep for bundle names
(`plot-transition.mjs`, `plot-verdicts.mjs`) reported `plot-reap.sh` as having
zero domain calls, which would have made this plan about two scripts. It reads
`rules/reapable.ts` through an inline `node` block instead, and says so in its
header — so the plan is about one script, and the other is the worked example it
should copy.
