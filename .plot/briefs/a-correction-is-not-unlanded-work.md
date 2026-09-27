## Implementation brief — a-correction-is-not-unlanded-work

- **Plan (canonical):** `docs/plans/2026-09-27-a-correction-is-not-unlanded-work.md` on `main`
- **Approved:** 2026-09-27, jwloka, in-session
- **Branch:** `bug/a-correction-is-not-unlanded-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — CI plus a person reading the diff
- **Issue:** #1024

A single-slice plan. Nothing waits on this branch. `bug/one-answer-to-is-a-worker-running` (#1015) edits the same two reading blocks in `plot-reap.sh` — see the scope guard.

### What to build

The reaper refuses a desk with a merged PR because the desk holds an uncommitted file the estate wrote itself. Measured 2026-09-27:

```
keep  bug/a-branch-behind-main-holds-nothing   uncommitted: ?? PLOT-CORRECTION.md
keep  bug/a-dispatch-does-not-hold-the-loop    uncommitted:  M packages/board/.omc/state/last-tool-error.json
```

Both branches had merged PRs. Five desks in one session needed a manual `rm` or `git checkout` before the reaper would act. An operator who writes a correction to unblock an agent makes that agent's desk unreapable.

The fix is a filter in the **reading**, beside the existing `tiny-garden/\.plot/state` exclusion. `reapable.ts` does not change. It gets a `dirtyPath` that no longer names the two estate-written paths.

1. **`PLOT-CORRECTION.md` at the desk root** stops counting as a dirty path. The loop writes it (`plot-worker-loop.sh:571` `write_correction`, `:543` `correction_file_name`), the agent reads it, and it has no value afterwards.
2. **`packages/board/.omc/state/last-tool-error.json`** stops being reported. It is tracked on `main`, so resolve it with `git rm --cached` (preferred, because `.omc/` is already in `.gitignore:18` and the file then disappears for every reader) or with a named exclusion. Argue the choice in the commit message.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The filter lives in the reading, not in the rule.** `plot-reap.sh:511-518` already argues this case for the tiny-garden fixture: *"it is filtered HERE, in the reading, because it is a fact about this repository's fixtures and not about whether a worktree may go."* Do not add a refusal, an exception, or a new reading to `reapable.ts`.

**A closed list of named paths, never a glob.** `uncommittedChanges` exists because uncommitted work exists in exactly one place (`reapable.ts:74`). A pattern that catches one source file deletes it with the worktree. Name each path.

**Anchor the match to the desk root.** `git status --porcelain` prints `?? PLOT-CORRECTION.md` for the root file. The existing exclusions are unanchored `grep -v`. An unanchored `PLOT-CORRECTION` match also hides `docs/PLOT-CORRECTION.md` or `src/PLOT-CORRECTION.md.ts`. Match the whole porcelain line as a fixed string: `grep -vxF '?? PLOT-CORRECTION.md'`. `-F` matters: `?` is a regex operator in ERE and PCRE-backed greps (`ugrep` rejects `-x '?? …'` outright), and a fixed string has no dialect. Also consider the ` M`/`A ` forms only if a desk can stage it — the loop never does, so `??` alone is the honest match. Say so in a comment.

**`.gitignore` cannot fix the tooling file.** The file is tracked (`git ls-files | grep .omc` prints it) and `.omc/` is already ignored, which is why git reports it as ` M` and not `??`. An ignore rule changes nothing. The plan's Done-when forbids that route.

**`PLOT-BLOCKED*` is untouched.** It is read by `ls "$wt"/PLOT-BLOCKED*` at `plot-reap.sh:520`, independently of the porcelain reading, and it keeps its refusal. A blocked desk owes a person an answer. A correction owes nobody anything.

**The reaper does not delete the correction.** It stops counting it. Removing the worktree removes the file.

### The filter sites — three, not two

The plan names two sites in `plot-reap.sh`. Dispatch found a third with the same snippet, and the plan's own rule (*"both sites or neither"*) covers it:

| Site | Reads for | Current filter |
|---|---|---|
| `skills/plot/scripts/plot-reap.sh:521-522` | the reap decision (`dirty` → `firstReapRefusal`) | `grep -v 'tiny-garden/\.plot/state' \| head -1` |
| `skills/plot/scripts/plot-reap.sh:1035-1036` | the "dirty trees nobody owns" sweep (`dirty_trees=`) | `grep -v 'tiny-garden/\.plot/state' \| wc -l` |
| `skills/plot/scripts/plot-reconcile-scan.sh:2602` | section 21 (`desks=`), which asks `reap()` through `board/plot-reconcile.mjs` | `grep -v 'tiny-garden/\.plot/state' \| head -1` |

If the reaper reaps a desk and section 21 reports the same desk as kept for `uncommitted-changes`, the two readers disagree about one tree. That is the drift the plan exists to remove.

**Consider one shared filter.** Three copies of one `grep -v` chain have already drifted once in this estate's history. A sourced helper (`plot-reap.sh` and `plot-reconcile-scan.sh` each source helpers today) or one variable holding the pattern removes the fourth copy before it is written. This is a judgement for the slice. If you keep three inline copies, a test must drive all three.

**Out of scope, deliberately:** `plot-fleet-scan.sh:1793` (`local_dirty` answers *is someone editing*, a different question), `plot-dispatch.sh:1828` (`--restart` refuses on any dirt, correctly — a restart inherits the tree), `plot-fleetctl.sh:800`, `plot-worker-monitor.sh:395`. Do not widen the change to them. If one of them visibly misreports because of a correction file, report it in the PR body.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive fix passes without them:

- **A desk whose only dirt is a root `PLOT-CORRECTION.md` is reaped** (`--yes`), given a merged PR and no live pid. This is the headline case.
- **The same desk is not counted in `dirty_trees=`.** The naive fix edits `:522` only, and the reap test passes while the sweep still prints the desk under "dirty trees nobody owns". Assert the footer counter, the way `test/reconcile/sweep.test.mjs:348` does.
- **`docs/PLOT-CORRECTION.md` still refuses** and the refusal names the path. This catches an unanchored match.
- **A root `PLOT-CORRECTION.md` plus one real file still refuses**, and the refusal names the real file, not the correction. `head -1` after the filter gives this for free only if the filter runs before `head`.
- **A `PLOT-BLOCKED*` marker with a correction beside it still refuses** as `blocked-marker`.
- **Section 21 agrees with the reaper** on the correction-only desk (`test/reconcile/desk-finding.test.mjs` is the precedent).
- **The tooling file**: if `git rm --cached`, the diff shows the removal and no new ignore rule; if a named exclusion, a test proves a modified copy of that exact path does not refuse.

Test homes: `test/reconcile/reaper.test.mjs` (reap decision), `test/reconcile/sweep.test.mjs` (the dirty sweep), `test/reconcile/desk-finding.test.mjs` (section 21). Reuse their fixtures; do not build a new sandbox harness.

Plus the repo gates:

```bash
nvm use                          # Node 24 — pnpm crashes on 26
corepack pnpm install
corepack pnpm test
corepack pnpm run test:contracts
```

`test:e2e` is CI's gate, not a local one. No board source changes, so `test:board` and the artifact rebuild are not needed unless a board test fails. A changeset is required: package `'plot': patch`, description first, `bumps:` block last, `plan:` line optional (see CLAUDE.md › Versioning).

Under load, `ETIMEDOUT` in `test/reconcile/*` is contention. Re-run the failing file alone before believing it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append ` → #<number>` to the slice heading's parenthesis in the plan: `(Branch: bug/a-correction-is-not-unlanded-work, PR: #<number>)`. The trailing-arrow form parses as `prs=[]` on a `###` heading.
- Reference `#1024` in the PR body. Do not close the issue by hand; delivery owns that.

### Scope guard

**This branch owns:** the three filter lines above (and a shared helper if you extract one), the `packages/board/.omc/state/last-tool-error.json` index entry, the three test files named above, and one `.changeset/*.md`.

**It does not touch:** `packages/domain/src/rules/reapable.ts`, `plot-worker-loop.sh`, `plot-worker-state.sh`, or any `PLOT-BLOCKED` handling.

**In flight beside it, verified 2026-09-27:**

- `bug/one-answer-to-is-a-worker-running` (#1015, Approved, not yet claimed) changes the **pid reading** in `plot-reap.sh` at both sites — lines ~503-509 and ~1040-1044, a few lines from this branch's filter lines — and adds an unpushed-commits guard. Different lines, same blocks. Whichever branch merges second rebases, and the rebase is textual. Do not take on its pid or liveness work here.
- `origin/bug/the-index-is-read-once` still touches `plot-reconcile-scan.sh`, but its PR #948 merged. It is a stale ref, not a collision.
- `.changeset/` on `main` holds siblings' files. Add yours; touch none of theirs.

If you find something the plan did not anticipate, report it in the PR body rather than improvising outside scope.
