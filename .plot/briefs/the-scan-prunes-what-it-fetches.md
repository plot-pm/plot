# Brief: bug/the-scan-prunes-what-it-fetches

Implement `docs/plans/2026-08-18-a-stale-ref-outranks-the-host.md`.

Read it first. Reproduced end to end before dispatch: **do not re-derive
it, do not widen the scope.**

## The bug

Minutes after PR #218 squash-merged:

```
plot-fleet-scan.sh    bug/one-worker-state-not-two — in progress
plot-host.sh pr-state bug/one-worker-state-not-two — MERGED
git ls-remote origin  refs/heads/bug/one-worker-state-not-two — empty
git for-each-ref      refs/remotes/origin/bug/... — 1c81357   <- STALE
```

`git fetch` does not remove remote-tracking refs for branches deleted
upstream; only `--prune` does, and `plot-fleet-scan.sh:134` does not pass
it. The stale ref then decides the answer:

| Arm | Reached when | How it decides |
|---|---|---|
| no-ref | ref absent | subject match, then **ask the host** |
| ancestry | ref present | `git merge-base --is-ancestor` |

The host is asked **only in the no-ref arm** (line 1264). With the stale ref
present the scan takes the ancestry path, and a squash breaks that by
construction — `42146e4` does not contain `1c81357`, so the branch falls to
`wip`.

**The stale ref does not add noise; it disables the check that would be
right.** `--list-eligible` returned nothing and wave 2 could not be
dispatched at all. `git fetch --prune` cleared it and the wave opened
immediately.

## What to build

`--prune` on the fetch the scan already makes (line 134), using the
connection it already opens. No new host call, no new logic: the stale ref
never exists, the no-ref arm is entered, and #216's host lookup answers.

## Do not

**Do not move the merge lookup out of the no-ref arm.** Lines 1240-1246
explain why: a branch someone *recreated* has a ref and takes the ancestry
path deliberately. Hoisting the host lookup would report in-flight work as
`merged` and open the next wave onto work still being done. `fleet.test.mjs`
pins that ordering — leave it alone.

**Keep `--offline` honest.** It skips the fetch, so it cannot prune. An
offline scan keeps whatever local refs exist and may report `wip` for merged
work. That is acceptable; saying nothing about it is not — the plan's Open
Points flag this and it wants an answer, not silence.

**Check before pruning unconditionally.** The plan asks whether anything
depends on a stale tracking ref surviving — a branch deleted upstream while
a local worktree still holds work is the case to test.

## Definition of Done

- A sandbox where a branch is squash-merged and deleted, and whose stale
  tracking ref remains, reports `merged` and completes its wave. **Verify it
  fails against the unchanged script** (stash and run) — a test that passes
  both ways is not testing this.
- A branch that merely has a ref and unmerged work still reports `wip`
- The no-ref arm's ordering stays pinned: a recreated branch with real work
  is never reported `merged`
- `--offline` behaviour is decided and stated
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**
- A changeset with a `bumps:` block

## Coordination

`plot-fleet-scan.sh` is yours alone right now, but
`bug/finished-is-not-a-verdict` is adding a seventh worker state via
`skills/plot/scripts/plot-worker-state.sh`, which the scan sources. Your
change is the fetch at line 134; keep the diff there.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way today:
`stat -f` does not fail cleanly on GNU, and `/usr/bin:/bin` is not an
isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can
and **report the discovery** rather than improvising.
