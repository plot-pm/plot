## Implementation brief — jira-moves-at-approve (wave: Jira at approve)

- **Plan (canonical):** docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2916 merged
- **Branch:** `feature/jira-moves-at-approve` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on main, plot-review app)

This is the third and last slice of `tickets-follow-the-delivery-loop`. Its two
prior waves are merged: `feature/the-plan-comment-renders-records` → #2932,
`feature/merged-slices-update-the-comment` → #2950. Nothing in this slice
depends on either merge landing in a particular order relative to this one —
it touches a different caller (`approve.ts`) and a different rule
(`issue-status.ts`), not the renderer or the progress count the other two
slices built.

### What to build

Two things, both named by the plan's Design section and its Jira decision:

1. **Wire the missing `approve` caller of `plot-issue-status.sh`.** Today
   `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts:46-57`) owes
   a write at `approved`, `delivered` and `released`, but only two of the three
   callers exist: `deliver.ts:531` (deliver) and `deliver.ts:944` (release).
   `approve.ts:1174` runs `plot-plan-state.sh` only — so on a Jira tracker, an
   approved plan's issue never moves, because the Jira connector answers
   `unaskable` to `issueComment` (`tracker-jira.ts:293`) and `no-target` to
   every `planStateWrite` (`:297-300`), and nothing else asks it to move.
   Add a `plot-issue-status.sh` call in `approve.ts` right after the existing
   `plot-plan-state.sh` call at line 1174 (same `try` block, same
   `approvedPlan.file` argument), report its outcome on the summary the same
   way `planState` already is, and let a failed write leave the approval
   standing — the shell script's own contract already guarantees this
   (`plot-issue-status.sh`'s header: "A WRITE THAT FAILS IS REPORTED, NEVER
   RAISED"). Do not gate approval on the tracker write succeeding.

2. **Move the three status-word config reads from the shell into the
   bundle.** `plot-issue-status.sh:39-41` today reads `Tracker approved
   status`, `Tracker delivered status` and `Tracker released status` via
   `plot-config.sh get` in shell, then passes them to
   `board/plot-issue-status.mjs` as `--approved`/`--delivered`/`--released`
   flags. The plan asks for these three reads to move into the `.mjs` bundle
   itself, through the `Scripts` port's `config` method — the same pattern
   `local-checks.ts:172-175`, `deliver.ts:457-459` and `gate.ts:235-236` 
   already use (`ctx.scripts.config(key, fallback)`). The entry source is
   `packages/board/src/server/entry/issue-status.ts`; its `run()` currently
   takes the words from argv (`flagsFrom`, `:89-103`) rather than reading
   config itself. `scriptsShell(context)` (`packages/domain/src/adapters/scripts/scripts-shell.ts:42`)
   builds a `Scripts` port from the same `ShellContext` this entry already
   holds — call `.config('Tracker approved status', ''), .config('Tracker
   delivered status', ''), .config('Tracker released status', '')` inside
   `run()` instead of requiring the shell wrapper to supply them as flags.

### The decision the plan settles — do not re-derive it

**No per-merge Jira transition.** The design explicitly names only three
points (Approved, Delivered, Released) and says "a late transition can move a
ticket backwards" — this is the same hazard the comment-progress slice (#2950)
found for `plan:approved`/`plan:delivered` labels, applied to Jira status
words. Do not add a Jira write triggered by the index's `pr merged` finding,
and do not try to make the Jira write level-triggered or idempotent beyond
what `plot-issue-status.sh` already does (it already reports `already` as a
distinct outcome — see `FALLBACK` in `issue-status.ts:46-52`).

**This slice does not touch the comment renderer or the progress count.**
Those are `rules/plan-issue-comment.ts` and `sliceProgress` in
`rules/deliverable.ts` — both already shipped by the other two slices. This
slice's only touch points are `approve.ts` (new caller) and
`issue-status.ts`/`plot-issue-status.sh` (config reads moving location).
Resist folding in any renderer or progress-count changes.

### Done when

The plan's `## Done when` is implicit in its Design section — no explicit
checklist — so the bar is: an approved plan whose `## Plot Config` declares a
`Tracker approved status` word gets that status written to every issue it
names, at the moment `/plot-approve` runs, with the same failure-is-reported
contract the deliver/release callers already have. Plus:

- A unit test on `approve.ts`'s new call path: approving a plan with a
  configured `Tracker approved status` calls `plot-issue-status.sh` and
  surfaces its outcome in the summary; approving a plan with no status word
  configured, or no issue, writes nothing extra (the bundle's own
  `issueStatusWrites` already returns `[]` for that case — don't re-check it
  in `approve.ts`).
- A unit test on `issue-status.ts`'s `run()`: the three status words are read
  from config via `scripts.config(...)` inside the entry, not from argv —
  confirm `wordsFrom`/`flagsFrom`'s `--approved`/`--delivered`/`--released`
  flags are removed (or kept only as an internal fallback if a caller still
  needs to override, per what you find when you read the current callers of
  `flagsFrom` under `packages/board/src/server/entry/issue-status.ts` and its
  tests) and the shell wrapper's `plot-config.sh get` calls are deleted.
- `packages/domain` coverage stays at 100% — the plan states this for every
  new domain rule; this slice should add minimal or no new domain-rule
  surface, since the rule (`issueStatusWrites`) itself does not change, only
  its callers and where its inputs are sourced.

Plus the repo's standing gates: no committed board bundle in the diff
(`scripts/check-no-bundle-diff.sh`), changeset present and correctly ordered
(description first, `bumps:` block last) if this change should be released,
and run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push — run what it prints. The suites named in `## Plot Config`'s `CI suites`
key run in CI on every pull request; do not run `pnpm run test:e2e` locally,
it is CI's gate only.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows
past its merge base. This slice *removes* three `plot-config.sh get` lines
from `plot-issue-status.sh`, so it should net-shrink the shell line count
rather than grow it — but double check after editing: don't add the config
reads back into the shell wrapper under a different name.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the
controller once ready:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create` directly. Once the PR exists, append
`→ #<number>` to this branch's line in the plan's `## Slices` section (the
`feature/jira-moves-at-approve` line under `### Jira at approve`).

### Scope guard

This branch owns:

- `packages/board/src/server/entry/approve.ts` (the new issue-status call,
  near line 1174)
- `packages/board/src/server/entry/issue-status.ts` and its test
  (`packages/board/test/unit/issue-status.test.ts`)
- `skills/plot/scripts/plot-issue-status.sh` (removing the three config
  reads and the flags it passes)
- Any `approve.ts` unit tests under `packages/board/test/unit/` covering the
  new call

Both prior slices of this plan (`feature/the-plan-comment-renders-records`,
`feature/merged-slices-update-the-comment`) are already merged — there is no
live sibling branch to collide with. If you find something the plan did not
anticipate, report it rather than improvising outside scope — in particular,
the Open Question about the revert ticket record (#2904) is explicitly out
of this plan's scope; do not build toward it here.
