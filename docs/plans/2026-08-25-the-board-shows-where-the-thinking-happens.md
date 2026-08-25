# The board shows where the thinking happens

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The board shows the session a person is actually working in — the master agent's
worktree and the branch it is on — beside the dispatched workers it already
lists.

## Motivation

### The measurement

An operator on `bug/a-head-counts-its-own-waves` looked at the board's header,
saw `main`, and asked why. The header was right: it names the branch the SERVER
is serving from, and that server runs in a different worktree.

But the question underneath it has no answer anywhere on the board:

```
main worktree (…/plot)   bug/a-head-counts-its-own-waves   ← the operator
board worktree           main                              ← the server
```

Measured 2026-08-25 across every worktree on this machine: **eight have no
registry entry**, and the first of them is the main checkout — the one where a
person and the master agent do their work. `.plot/agents/` holds dispatched
workers only; `plot-dispatch.sh` is its sole writer, so a session nobody
dispatched has no manifest.

So the board lists seventeen agents and cannot show the one a person is sitting
in front of.

### Why the earlier plan was right to decline, and why that has changed

`the-board-says-which-branch-it-serves` (#337) named this exact idea and
deliberately did not build it, under **What this is NOT**:

> *Which branch the master agent is working on — not recorded anywhere. […] It
> additionally has no stable answer: the master agent switches branches
> constantly, so its `branch` would frequently and correctly be `''`.*

Both halves of that reasoning are worth re-testing, and both have moved.

**"Not recorded anywhere" was about the REGISTRY, and the registry is not the
only source.** A worktree's branch is `git branch --show-current`, exactly what
the header already reads for the server's own checkout. Reading it for the other
worktrees is the same operation, one directory over.

**"Switches constantly" was an estimate, and it is wrong here.** Measured on the
main worktree, 2026-08-25: **4 branch changes in the last 40 reflog entries.**
A session settles on a branch for as long as the work takes, which on this
estate is tens of minutes. That is not churn; it is exactly the cadence a
displayed value wants.

The plan also asked that this follow `the-registry-knows-which-agents-live` —
delivered as #327 — so the dependency it named is satisfied.

### What a reader loses without it

The concept work on this repo happens **on branches with no worktree of their
own and no dispatched worker**: a person and the master agent, in the main
checkout, moving between branches as the thinking moves. That is where plans get
written, interrogated and approved — the work this whole tool exists to track —
and it is the only work the board cannot see.

WORKING lists what the fleet does. Nothing lists what the operator does, and the
question *where am I* has been asked of the header twice in one session by
someone who already knew.

## Design

### A session row, beside the agent rows

WORKING renders one row per registry entry. This adds rows for the worktrees the
registry does not cover: the main checkout first, then any other worktree with
no manifest — the recut trees, the scratch trees, the ones a person made by
hand.

They render as the same kind of row an agent does, because they answer the same
question — *who is working, and on what* — and differ only in that no dispatcher
started them. The row names the worktree and its branch, and says `session`
where an agent row says its state.

### Derived, never recorded

No new file, no manifest for the master agent, no writer. The board asks git
which worktrees exist and what branch each is on, the same two questions
`serverInfo` already asks about one of them.

**This is the property that makes it honest.** A recorded value would need
someone to update it on every checkout, and the update would be the thing that
breaks — the same failure `the-registry-drops-a-settled-worker` exists to
reconcile. A derivation cannot go stale.

### A detached worktree says so

`git branch --show-current` prints nothing for a detached HEAD, and several
worktrees here are detached. The row says `detached` rather than rendering a
short SHA, which would read as a branch name to anyone skimming — the rule
`serverInfo` already applies to its own empty answer.

### Not chosen: a manifest for the master agent

The obvious symmetry — give the session a `.plot/agents/` entry like a worker
has. Rejected because it needs a writer, and the only honest writer is the
session itself, which would have to notice its own checkouts. `plot-dispatch.sh`
writes a manifest because it CREATES the worktree and knows the branch at that
moment; nothing has that moment for a session that was always there.

### Not chosen: put it in the header

The header answers *which checkout is this page served from*, and that is a fact
about the SERVER. Adding a second branch beside it is precisely the conflation
#337 refused, and it would make the one unambiguous field ambiguous.

## Waves

### Seen (Branch: feature/the-session-worktrees-are-visible)

The fleet payload carries the worktrees with no registry entry — path, branch,
and whether the branch is detached — derived from git on the scan's own clock.

### Shown (Branch: feature/a-session-row-renders-in-working)

WORKING renders a row per such worktree beside its agent rows, naming the
worktree and its branch, and saying `detached` where there is no branch.

## Done when

1. With the main checkout on a branch no plan names, WORKING shows a row for it
   naming that branch. Asserted against a fixture whose branch is absent from
   the plan estate — the case that makes it invisible today.
2. **A worktree that HAS a registry entry gets exactly one row**, not two. The
   assertion a naive implementation fails: adding session rows without excluding
   the covered worktrees doubles every dispatched worker, which is the
   one-subject-twice defect `every-section-has-one-subject` already fixed once.
3. A detached worktree says `detached` and never renders a short SHA.
4. The header is unchanged. It still names the server's own checkout and nothing
   else — this plan adds rows, it does not touch that field.
5. Nothing is written. Asserted on the filesystem: no new manifest, no state
   file, `.plot/agents/` unchanged after a render.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The question was asked twice before it was heard

Once as *"why does the header say main when I am on a bug branch?"* and once as
*"wollten wir nicht den Branch vom Master-Agent anzeigen?"*. The first reading
treated it as a header defect and confirmed the header was right; only the
second made the actual gap visible. The header was never the subject — the
missing row was.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A section that lists seventeen
agents and omits the one the reader is sitting in is not lying, but it is
answering *who is working* with a set that excludes the asker.
