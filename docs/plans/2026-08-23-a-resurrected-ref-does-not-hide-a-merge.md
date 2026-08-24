# A resurrected ref does not hide a merge

> A merged branch read `wip` for three hours because its ref came back after the merge deleted it. Its wave reported "3 merged, the rest not yet" over four merged branches and never completed.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `bug/a-resurrected-ref-does-not-hide-a-merge`
- **Delivered:** 2026-08-23

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A branch whose pull request has merged now reads `merged` even when its ref still exists, so a wave of finished work completes instead of reporting one branch as still being worked on.

<!-- Board impact: the board consumes the scan's verdicts, so a wrong branch
     state reaches every section. No plan-format, template or docs/plans-layout
     change; no artifact rebuild (the fix is in skills/plot/scripts/). -->

## Motivation

Reported from the running board, 2026-08-23: a wave read

> **3 merged, the rest not yet** — 4 to review

over four branches whose PRs were **all merged** (#353, #354, #355, #356).

The odd one out was `bug/done-holds-finished-plans-only`. Its PR #356 merged at
17:06; the scan reported it as `wip` for the next three hours, so the wave never
completed and the plan sat in Development with nothing left to do.

### Why the scan could not see it

`branch_state` splits on whether a remote ref exists. The **no-ref** arm asks the
host and reports `merged`; the **has-ref** arm walks locally and never asks. That
split is stated as an invariant in `merged_by_host`'s own docstring:

> a merge that deleted the ref never reaches here at all (the no-ref arm returns
> first)

**The premise holds only while the ref stays deleted.** `delete_branch_on_merge`
is on, so the host removes the ref at merge — and a worktree that still holds
that branch can push it back afterwards, which a fleet does routinely. The ref
exists again while the work sits on the default branch under a **different**
commit, because a squash merge rewrites it:

```
ahead > 0   the pre-squash commits are unreachable from main
real  > 0   they are real work, not claim markers
        →   the arm returns `wip`
```

### `wip` is the worst of the wrong answers

`open` would say *nobody has started*; `claimed` would say *someone took it*.
**`wip` says an agent is working here right now** — so a leftover worktree reads
as an occupied desk, and the row asks a reader to wait for something that
finished hours ago. It also feeds `/plot-dispatch`'s refusal to fan out over a
busy desk, so the wrong state propagates into what the fleet will and will not
start.

### What this is NOT

**Not a repository setting.** `delete_branch_on_merge` was already `true` and is
not changed here — measured before proposing anything, because "turn on branch
deletion" is the obvious fix and it was already on.

**Not squash-merge-with-kept-ref.** That framing was checked and refuted: the
host does delete the ref. The ref is **resurrected** afterwards by something
holding the branch. Recorded because the wrong framing suggests a host-settings
fix that would change nothing.

**Not rare in the way the first count suggested.** An initial sweep over one page
of closed PRs found zero other cases; the full list found **three** more branches
whose PR is merged while their ref survives. They are harmless only because no
plan names them, so the scan never evaluates them — the defect bites exactly the
branches a plan governs, which is why one appeared and not four.

## Design

### The fix: ask the join, which already knows

Before concluding `wip`, consult the state `prefill_pr_states` cached from the
single repo-wide `pr-list` the scan already makes:

```sh
if [ "$(host_pr_state "$br")" = MERGED ]; then echo "merged"; return; fi
echo "wip"; return
```

### Free, and that is what licenses it here

The answer comes from a response already fetched, so **no host request is
added** — verified at 1 call per scan, unchanged from
`the-scan-asks-once-per-pulse-not-once-per-branch`.

That constraint is the whole design. Asking the host per branch on this arm
would put **22 calls back into every scan** on this repo, reintroducing the N+1
that plan had just removed, through a different door. A fix for a correctness
bug that silently undoes a cost fix is two defects, not one.

### Only `MERGED`, and only toward `merged`

The check may override the local walk in exactly one direction:

| host says | effect |
|---|---|
| `MERGED` | `wip` → `merged` |
| `OPEN` | nothing — a PR over unlanded commits IS work in flight, which `wip` already says |
| `CLOSED` | nothing — a withdrawn PR is not evidence anything landed |
| `NONE` | nothing |
| `-` | nothing — unanswerable is not a yes |

Where the list did not arrive the cache is empty, `host_pr_state` answers `-`,
and the walk decides exactly as it does today. **Absent is not false.**

### Not chosen: reap resurrected refs instead

Deleting a ref whose PR has merged would fix the cause rather than the symptom,
and it is what a human did by hand to clear the reported case. Rejected as the
primary fix: it is an automatic **write** to a remote ref, decided on an
inference about who pushed it, against this repo's standing rule that a session
never deletes a ref another session may be reading (`/plot-implement`, *Giving a
branch up*).

The read-side fix makes the board honest wherever the ref came from, and costs
nothing. Reaping remains available as a follow-up if resurrected refs turn out
to accumulate.

## Done when

- A branch whose ref exists, whose commits are not on the default branch, and
  whose PR the list reports `MERGED`, reads **`merged`**. Asserted as `merged`
  rather than as *not `wip`*: `open` and `claimed` are wrong too, and a test that
  only forbids `wip` passes an implementation that swaps one wrong verdict for
  another.
- **Zero per-branch host calls.** Asserted in the same test by counting stubbed
  invocations, so the fix cannot regress into the lookup it deliberately avoids.
- A branch with an **open** PR over unlanded commits is still `wip` — the
  direction this change could break.
- `node --test test/reconcile/fleet.test.mjs` green.

## Waves


### Consulted (Branch: bug/a-resurrected-ref-does-not-hide-a-merge, PR: #372)
- consult the cached PR state before the has-ref arm concludes `wip`, overriding only on `MERGED`, at no host cost

## Notes

### Written after the fact, and it says so

This plan was written **after** #372 merged. The defect was reported from the
board mid-session, diagnosed and fixed directly, and the plan followed.

That order is the wrong way round and is recorded rather than tidied away,
because the board itself surfaced the omission: the branch rendered as a bare
`PR` row instead of a `WAVE` row, since **no plan named it**. An operator asked
why, and the answer was that the work had no plan. The estate reported its own
gap, which is the property the sprint `the-board-tells-the-truth-in-every-section`
was set up to get.

Nothing in the content is retrofitted to match what shipped: the measurement,
the ruled-out framings, and the cost constraint were all established before the
code was written — they were simply held in a PR description rather than a plan
file.

### Found by an operator, not by a test

Three of the four branches read correctly, which is what made the wave's message
plausible enough to survive: *"3 merged, the rest not yet"* is exactly what a
half-finished wave looks like. Only counting the merged PRs by hand showed the
fourth had landed too.

Precedent: `the-blocking-wave-is-found-wherever-it-is`, where a careful docstring
reasoned correctly from a premise the layout no longer held. The same shape here
— `merged_by_host`'s invariant was true when written and is falsified by a ref
that comes back.
