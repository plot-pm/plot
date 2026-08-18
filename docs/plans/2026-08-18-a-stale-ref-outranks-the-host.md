# A stale ref outranks the host

> A squash-merged branch reports `in progress` for as long as one local ref nobody pruned still points at it. The host answers `MERGED` in a single call, and the scan does not ask — because the ref it should no longer have is the thing that decides it will not.

## Status

- **Phase:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:**
- **Delivered:**
- **Released:**

## Changelog

- `plot-fleet-scan.sh` no longer lets an unpruned remote-tracking ref keep a squash-merged branch in `wip`, so a finished wave completes without the operator knowing to run `git fetch --prune`.

## Motivation

Measured 2026-08-18, minutes after PR #218 was squash-merged and its wave
was expected to open the next one:

```
plot-fleet-scan.sh
  One implementation — eligible
      bug/one-worker-state-not-two — in progress     <- MERGED as #218
  The seventh state — blocked

plot-host.sh pr-state bug/one-worker-state-not-two
  {"number":218,"state":"MERGED","mergeCommit":"42146e4..."}

git ls-remote origin refs/heads/bug/one-worker-state-not-two
  (empty — deleted at merge)
```

The host answers `MERGED`, the branch is gone from the remote, no worktree
and no claim remain — and the scan reports `in progress`, which reads as
*someone is working on this right now*. `plot-dispatch` consumes the same
answer through `--list-eligible`, so the next wave could not be fanned out
at all. This was not cosmetic: it blocked the work.

### One ref nobody deleted

`git ls-remote` is empty, but the local mirror is not:

```
git for-each-ref refs/remotes/origin/bug/one-worker-state-not-two
  refs/remotes/origin/bug/one-worker-state-not-two 1c81357
```

`git fetch` does not remove remote-tracking refs for branches deleted
upstream; only `--prune` does. Nothing in Plot runs it — `plot-fleet-scan.sh`
fetches at line 134 without it — so every branch merged with
`--delete-branch` leaves one behind, and it survives until an operator
happens to prune for unrelated reasons.

`git fetch --prune` cleared it and the wave completed immediately. That is
the whole reproduction, and it is why this looks like an intermittent bug:
it depends on a local cleanup nobody performs on a schedule.

### Why the stale ref wins

`branch_state()` decides in two arms, and the accurate one is unreachable
while the ref exists:

| Arm | Reached when | How it decides |
|---|---|---|
| no-ref | `refs/remotes/origin/<br>` absent | subject match, then **ask the host** |
| ancestry | the ref exists | `git merge-base --is-ancestor` |

The host is asked **only in the no-ref arm** (`plot-fleet-scan.sh:1264`).
With the stale ref present, the scan takes the ancestry path, and a squash
merge makes that path answer wrongly by construction: `42146e4` has one
parent and does not contain `1c81357`, so `--is-ancestor` is false and the
branch falls to `wip`.

**So the stale ref does not merely add noise — it disables the check that
would have been right.** The scan holds a ref it should not have, and that
ref decides it will not consult the source that knows better.

### Why only squash merges expose it

Under a merge commit, `--is-ancestor` is true and the stale ref reaches
`merged` anyway; the staleness is invisible and harmless. The squash breaks
the ancestry link, and only then does the unpruned ref change the answer.

This repo squash-merges by default, so the harmless case is the rare one
here.

### Why this is not the bug PR #216 fixed

`docs/plans/2026-08-18-a-squashed-branch-is-merged-not-open.md` fixed the
**no-ref** case: a branch deleted at merge read `open`, and the host is now
asked. That fix is correct and untouched by this one. It simply never runs
while a stale ref exists, because the arm it lives in is not entered.

Both bugs come from the same ancestor — state inferred from local refs
rather than from the host — and #216 removed one half. This is the other.

## Design

### Approach

**Prune what the fetch already contacts the host for.** The scan fetches
`origin/$MAIN` at line 134; a `--prune` on that fetch removes refs for
branches the remote no longer has, using the connection it already opened.
The stale ref then never exists, the no-ref arm is entered, and #216's host
lookup gives the right answer with no new logic.

This is the smallest fix that removes the cause rather than compensating
for it, and it adds no host call: the fetch is already made.

### What must not change

**The merge lookup must stay in the no-ref arm.** The script explains why
at lines 1240-1246: a branch someone *recreated* has a ref, so it takes the
ancestry path deliberately. Hoisting the host lookup to the top would read
as a cheap early answer and report in-flight work as `merged`, opening the
next wave onto work still being done. `fleet.test.mjs` pins that ordering,
and this plan does not touch it.

Pruning is safe precisely because it does not reorder anything: it makes
the local view match the remote, and the existing arms then apply as
designed.

### Alternatives considered

**Ask the host in the ancestry arm too.** Correct, and more expensive: one
call per branch that has a ref, on a board polling every 5 s. It also
duplicates #216's lookup in a second place, which is the shape
`bug/one-worker-state-not-two` just finished removing.

**Detect staleness without pruning** — compare `git ls-remote` against
local tracking refs. One extra network round trip per scan to learn
something `--prune` fixes for free.

**Tell operators to prune.** A rule, not a gate (CLAUDE.md, *Gates Over
Rules*): it can be answered "did I do this?" without doing it, and the
failure it prevents is silent.

### Open Points

- [ ] Should `--offline` skip the prune? It skips the fetch today, so it
      cannot prune either — an offline scan keeps whatever local refs exist,
      and may report `wip` for merged work. Honest, but worth saying in the
      footer rather than leaving to be discovered.
- [ ] Does anything depend on a stale tracking ref surviving? A branch
      deleted upstream while a worktree still holds work locally is the case
      to check before pruning unconditionally.
- [ ] `plot-dispatch.sh` fetches separately. It consumes the scan's verdict
      through `--list-eligible`, so fixing the scan fixes the dispatch — but
      its own fetch may leave stale refs that other checks read.

## Branches

- `bug/the-scan-prunes-what-it-fetches` — `--prune` on the scan's fetch, so a branch deleted at merge leaves no local ref and #216's host lookup is reached. Tests: a sandbox where a branch is squash-merged and deleted while its stale tracking ref remains must report `merged` and complete its wave; a branch that merely has a ref and unmerged work must still report `wip`; the no-ref arm's ordering must stay pinned, so a recreated branch with real work is never reported `merged`.

## Notes

Found while dispatching wave 2 of
`docs/plans/2026-08-18-finished-is-not-a-verdict.md`, which could not be
fanned out at all: `--list-eligible` was empty and `plot-dispatch` reported
`dispatched=0`. A first reading blamed the plan's `→ #218` annotation for
being read as activity. That was wrong — the annotation plays no part —
and the correction came from measuring the refs rather than reasoning about
the output.
