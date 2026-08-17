## Implementation brief — an-outage-is-not-an-answer, wave 1 (Observation)

- **Plan (canonical):** `docs/plans/2026-08-17-an-outage-is-not-an-answer.md` on `main`
- **Approved:** 2026-08-17, plan-PR #193 merged
- **Branch:** `bug/an-empty-conflict-set-is-not-a-refusal` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`plot-resolve-artifact.sh` stops treating *nothing observed* as *other
files*, stops merging inside worktrees it does not own, and stops
retrying a refusal that cannot change.

Waves 2 (`plot-host.sh` exit codes) and 3 (the truncated message) are
**not yours**.

### The measurement

A live row read:

```
artifact conflict  conflicting: skills/plot/scripts/board/board-server.mjs
                   repair refused — not-artifact-only
```

The classification and the refusal contradict each other, and the
classification is right:

```
$ git merge-tree --write-tree origin/feature/… origin/main
CONFLICT (content): Merge conflict in skills/plot/scripts/board/board-server.mjs
```

One file, and it is the artifact. The board's row agreed —
`state: "artifact-conflict"`, `conflicts: [the artifact]`.

The resolver's own log says why it refused:

```
step: reusing worktree …/plot-wt-feature-working-rows-show-their-pace
step: conflict set is not exactly the artifact — refusing
step: unmerged:
```

**`unmerged:` is empty.** It reads the conflict set from the worktree's
unmerged paths, reused a worktree in which **no merge was running**,
found zero paths, compared zero against one, and concluded *not
artifact-only*.

Formally correct; factually inverted. **Empty there means *I did not
look*, not *other files*.**

**And the worktree belongs to a running agent.** Measured at that moment:
zero unmerged paths, **three modified files**, an agent working in it.
The resolver ran `git merge` inside someone else's active worktree. It
refused before writing, so nothing was lost — that was luck, not design.

**It retried once per pulse.** The log holds **111 refusals** across more
than an hour, each reaching into the same worktree, none with new input.

### Three decisions the plan settles — do not re-derive them

**An empty set gets its own reason.** Three outcomes, not two:

| Conflict set | Meaning | Resolver |
|---|---|---|
| exactly the artifact | the licensed case | repair |
| other files present | needs judgement | refuse, `not-artifact-only` |
| **empty, no merge run** | **nothing was observed** | **refuse, `not-observed`** |

`not-artifact-only` asserts something about files nobody looked at. A
guard that cannot tell *I looked and found nothing* from *I did not look*
will eventually guard against the right answer — and here it did.

**The resolver works in a worktree it owns, or refuses.** Reusing an idle
worktree of its own is fine. Reaching into one where another process has
modified files is not: create a scratch worktree, or refuse with
`worktree-busy`. **The second is acceptable and is the honest minimum** —
a repair that never runs is a nuisance; a merge inside a working agent's
tree is a hazard.

**A `not-observed` refusal does not repeat every pulse.** Retry when the
input changes, not when the clock ticks. 111 identical entries carry no
more information than one.

### The fence stays exactly as it is

This wave fixes *how the set is obtained*. It must not touch **what the
set must be**:

```sh
conflicts.length == 1 && conflicts[0] == BOARD_ARTIFACT_PATH
```

`length == 1`, never `includes`. And the rule the plan added after wave 1
found it: **never act on a host verdict with no observed set** —
`merge-tree` predicts from *this machine's* refs while the host computed
against the branch as it stands, so a stale ref makes the prediction
wrong in the reassuring direction.

That rule is what produced this defect, and it is still right. The fix is
to make *empty* a third answer, not to weaken the test.

**The push gate is untouched:** `pnpm run test:board` green in the
worktree before any push; a failing suite pushes nothing and reports a
real conflict.

### Done when

- **An empty conflict set refuses as `not-observed`**, never
  `not-artifact-only`. Assert the reason string — a refusal naming the
  wrong cause sends the reader looking for files nobody examined.
- **The licensed case is repaired.** Assert a real artifact-only
  conflict, observed in a worktree the resolver controls, is repaired —
  the case the live board refused.
- **The resolver never merges in a worktree with foreign
  modifications.** Assert it refuses (or uses its own) when the target
  has modified files. The measured case: zero unmerged paths, three
  modified files, an agent working in it.
- **A `not-observed` refusal does not repeat on unchanged input.** Assert
  a second pulse produces no second attempt — 111 identical log entries
  is the measured symptom.
- **The fence is unchanged.** Assert artifact-plus-one-other is still
  refused as `not-artifact-only`, and that a host verdict with an empty
  observed set still triggers no repair.
- **Nothing is pushed until `test:board` passes.** Assert a failing suite
  pushes nothing.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`,
`pnpm run typecheck`, `pnpm test`, `pnpm run validate` all pass;
`pnpm build:board` run **in your own worktree** and the artifact
committed (CI gates on no-diff); a changeset is present with its
`bumps:` block. **Do not edit versions by hand.**
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check `git branch
--show-current` is `main` before that edit.**

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

`skills/plot/scripts/plot-resolve-artifact.sh`, the `repair` reason it
reports, and their tests.

**Do NOT touch the fence, the push gate, or wave 1's classification in
`stuck.ts`.**

**Do NOT change `plot-host.sh`** — that is wave 2.

**Do NOT change the error message truncation** — that is wave 3.

**Two waves are eligible in `AgentList.tsx`** and may be dispatched
alongside you; you are in a shell script and should not meet them.

### Notes on this repo

**GitHub's API failed with `503` repeatedly today**, on GraphQL and REST
both. `gh pr view` uses GraphQL and may return **empty** values — which
are not `false`. If a push or merge appears to fail, **check the result**
(`gh api repos/plot-pm/plot/pulls/<n> --jq .merged`) rather than trusting
the error: at least one merge today succeeded while reporting 503.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours:** Playwright's CDN `403`, and
`discovery.test.mjs` counting `plot-board-branch-*` in a shared
`os.tmpdir()`. Report rather than work around.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
