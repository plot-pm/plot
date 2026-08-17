---
"plot": minor
---

The board now repairs an artifact-only merge conflict by itself — the **one**
automatic write this system grants.

`skills/plot/scripts/board/board-server.mjs` is generated output, and two
branches touching entirely disjoint sources still collide in it. On 2026-08-17
that happened twice in one afternoon, and both times a human did the same five
fixed steps: merge, take a side, `pnpm build:board`, `pnpm run test:board`,
push. About five minutes each, with no decision anywhere in it.

**The permission rests on three verified properties and on nothing else.**
`.gitattributes` marks the artifact `-merge`, so git keeps one side whole and
writes no conflict markers — the file stays buildable JavaScript *through* a
conflict. `build.mjs` embeds no timestamp and no randomness, so the rebuild's
output does not depend on which side was kept. And CI's no-diff gate fails the
build if the committed artifact does not match a fresh rebuild. Together they
make this the one repair whose correctness is checkable **without judgement**.
No other failure has those properties, and none may be added to this path.

**It is a script, not an agent.** The sequence is fully determined and nothing
between its steps is a decision — which is precisely what licenses the
automation. Handing it to an agent would introduce judgement exactly where its
absence is the permission.

**Tests run before the push.** CI's gate runs only *after* a push, so a
resolver that pushed and waited would manufacture the very state this plan
defines as stuck: a red PR in the queue. The sequence ends on `test:board`
green in the branch's own worktree, and a failing suite pushes nothing and
leaves the branch reported as a conflict a human owns.

The fences are the design, and each has a test aimed at an implementation that
would satisfy the happy path without it: the entry condition is *exactly* the
artifact-only conflict set (never *is the artifact among the conflicts*), a
host verdict with no observed conflict set is refused, two repairs never run on
one branch at once, and every repair is reported on the row — running, pushed,
or abandoned. A silent automatic write is indistinguishable from a defect,
which is the failure mode this whole plan exists to remove.

The localhost guard on `/api/dispatch` and `/api/approve` is untouched: the
resolver rides the scan timer and is not a route at all.

<!--
bumps:
  skills:
    plot: minor
-->
