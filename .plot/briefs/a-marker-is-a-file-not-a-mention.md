## Implementation brief — a-marker-is-a-file-not-a-mention (wave: Named)

- **Plan (canonical):** `docs/plans/2026-08-23-a-marker-is-a-file-not-a-mention.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `bug/a-marker-is-a-file-not-a-mention` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention

Single wave, single branch. Nothing waits on it and it waits on nothing —
but `the-registry-names-a-live-agent` (Draft) unskips nine registry entries
INTO the classifier you are fixing, so this should land first.

### What to build

`plot_worker_blocked` decides whether a person owes a branch an answer. It
currently asks `git grep` over every file's **contents** for
`PLOT-BLOCKED:|TODO\((you|human)\)`. **Twenty-eight tracked files on `main`
match that string because Plot documents its own marker — `CLAUDE.md` among
them.** Every worktree is a checkout of `main`, so every worktree contains the
marker before any worker starts.

Make the marker a **file**, in both places that look for one.

### The decisions the plan settles — do not re-derive them

**A rarer token does not work, and neither does a denylist.** Both were
considered and rejected in the plan. Whatever token is chosen must be documented
for workers to write it, and the documentation lands in the tree the search
walks; an exclusion list would itself be documentation of the marker, in a file
that must then be excluded. The property to remove is *a mention is a marker* —
only a filename does that, because prose cannot mention a file into existence.

**The blast radius is narrower than "everything", and the plan says where.**
An open or merged PR is the FIRST test in `plot_worker_task_state` and outranks
the marker, so `plot-fleet-scan.sh` — which passes the PR fact — mostly escapes
(measured: finished ×20, waiting ×1). `registry.ts` passes `''` **by design**
(it must not be behind anything that can fail, so no host call) and falls
through every time: 9 of 9. Do not "fix" the registry's empty PR fact; that is
a deliberate decision and not in scope.

**Use a `for`/`-e` loop, not `ls glob`.** An unmatched glob is shell-dependent:
bash passes the literal pattern through and `ls` exits non-zero (right answer by
luck), zsh errors before `ls` runs. This file is **sourced** by callers whose
shell it does not choose. Verified 2026-08-23:

```sh
plot_worker_blocked() {
  local wt="$1" f
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  for f in "$wt"/PLOT-BLOCKED*; do
    [ -e "$f" ] && return 0
  done
  return 1
}
```

**Prefix match, not a fixed filename.** The `Worker command` says *"write
PLOT-BLOCKED: followed by the question into a file"* — it does not name the
file. Observed markers are `PLOT-BLOCKED.md`. Accept `PLOT-BLOCKED*`, and
tighten the instruction in the same change so the two agree going forward.

**Drop `TODO\((you|human)\)` rather than porting it.** It is a code-comment
convention, and matching it over file contents is the same defect with a smaller
blast radius.

**The second copy is in scope and fabricates a question.**
`worker-question.ts` declares its own copy of the pattern (line 28) and
re-greps (line 131). Against a pristine worktree it returns *"PLOT-BLOCKED:
which adapter should the fallback use?"* — a documentation example from a brief.
The board shows that to an operator with a control to answer it, and answering
writes a prompt into a worktree whose worker asked nothing.

- `markerIn` reads the `PLOT-BLOCKED*` file instead of running `git grep`.
- **`firstMarkerLine` is UNCHANGED.** It already takes text and is already
  exported for direct testing; a file's contents suit it exactly as grep output
  did, including the leading-comment stripping. Its existing tests must pass
  unmodified — editing them means the fix reached further than intended.
- **Delete the pattern constant from both files.** Nothing is left to keep in
  sync, which is what `worker-question.ts`'s own docstring asked for.

**Do not fix only the classifier.** A `finished` row that still offers a
fabricated question is worse than today's consistent wrongness.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a naive implementation would pass without them:

- **A pristine checkout of `main` reads `finished`, not `waiting`.** This is the
  defect. Every other assertion passes with the bug in place.
- **A worktree with a real marker file reads `waiting`** — assert the marker is
  FOUND, not merely that a clean tree is not `waiting`. The existing docstring
  records two separate ways this grep failed silently in the reassuring
  direction; a test that only checks the negative case passes a function that
  always returns false.
- **A file merely CONTAINING the string does not make the worktree `waiting`** —
  assert with a fixture file. This is the exact regression to prevent.
- **A pristine worktree yields no question text** from `worker-question.ts`.
  A classifier-only fix passes everything above and leaves this.
- `stalled` and `finished` are reachable again: uncommitted work + no marker →
  `stalled`; open PR → `finished`.
- Neither file declares the marker pattern any more — assert by grep.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Branches` section **on
main** — verify `git branch --show-current` is `main` before that edit.

### Scope guard

You own `skills/plot/scripts/plot-worker-state.sh`,
`packages/board/src/server/worker-question.ts`, their tests, and the one
`Worker command` line in `CLAUDE.md`.

Three other agents are live: two in `packages/board/src/app/components/`
(`AgentList.tsx`, `TupleRow.tsx`) and one in
`skills/plot/scripts/plot-reconcile-scan.sh`. **None of them touch your files.**
`continue.ts` imports `markerIn` — you may need to follow that import, but do
not redesign the route.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
