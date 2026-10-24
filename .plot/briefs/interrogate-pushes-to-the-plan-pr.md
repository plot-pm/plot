## Implementation brief — interrogate-cannot-reach-a-draft-plan (wave 2: Push the artifacts)

- **Plan (canonical):** docs/plans/2026-10-24-interrogate-cannot-reach-a-draft-plan.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2517 merged
- **Branch:** `bug/interrogate-pushes-to-the-plan-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 2 of 2. Wave 1, `bug/interrogate-reads-the-plan-pr` (→ #2556), merged
2026-10-24: `POST /api/interrogate` now resolves a Draft plan from its open
plan PR's head and runs the configured `Interrogate command` in a detached
worktree of `origin/idea/<slug>` (`interrogateWorktreePath`,
`prepareInterrogateWorktree`, both in `packages/board/src/server/interrogate.ts`).
That worktree stays in place after the run and this wave's job starts there.

### What to build

`/challenge-the-plan`, run inside that worktree, still edits the plan the way
it always has: it writes the `Rounds:` line to `## Status`, the
`CHALLENGE-THE-PLAN-METADATA` block, and the Open Points section
(`skills/challenge-the-plan/SKILL.md`, Phase 5b and Phase 7) — but those edits
land in the detached worktree's working tree, which has no branch to commit
to and is never pushed. Nothing in the route or the skill today moves that
diff onto `idea/<slug>`, so under `Plan PRs: required` every panel round is
silently discarded: the plan PR's reviewer sees no `Rounds:` bump, no Open
Points, no record that an interrogation happened at all.

This wave makes the round's diff reach `idea/<slug>`. The plan's Design
section names three pushed artifacts: the `Rounds:` increment, the Open
Points section, and the `CHALLENGE-THE-PLAN-METADATA` block — all three come
from one plan-file edit, so one commit carries all three.

### Decisions the plan settles, and the one it leaves to you

**The write-to-a-plan-PR-branch mechanism already exists; this is reuse, not
new plumbing.** `bookOnPlanPr` in
`packages/board/src/server/entry/needs-design.ts:501-543` is the precedent:
`needs-design` hits the identical shape (a phase move that must land on an
open plan PR's branch, not main) and solves it with
`ctx.trees.fetch` → `ctx.refs.resolve('refs/remotes/origin/<head>')` →
refuse if a same-named local branch disagrees with the remote (its commits
are not this command's to discard) → `ctx.trees.addBranch(tmpwt, head,
'origin/<head>')` → write the file → `ctx.trees.stage` →
`ctx.trees.hasStagedChanges` (no-op early return if the edit changed nothing)
→ `ctx.trees.commitAs` → `ctx.trees.push(tmpwt, head)` → `removeOnly` or
`removeWithBranch` depending on whether the local branch pre-existed. Every
step goes through the `Trees` port (`packages/domain/src/ports/trees.ts`),
implemented by `packages/domain/src/adapters/trees/trees-git.ts`. **Do not
invent a GitHub/Bitbucket Contents-API commit** — no such mechanism exists
anywhere in this codebase; every commit-to-a-branch here goes through a real
git worktree plus `git push`, and `bookOnPlanPr` is the one to copy, not
`interrogate.ts`'s own `prepareInterrogateWorktree` (that one builds a
**detached** worktree deliberately, for reading only — see its own comment,
"the new tree stays in place after the run").

**The plan's first open question is yours to close, and the route's own
shape argues for one answer.** `handleInterrogate` never runs the panel
itself — it writes a prompt file and starts the configured `Interrogate
command` through the `agentRun` port (`startBoardRun`, "THROUGH the agentRun
PORT... the run is not awaited before the 202"), the same way `/plot-idea`
and `/plot-reslice` hand off to an agent rather than doing the work inline.
By the time the round ends, the route has long since answered 202 and moved
on; nothing in `interrogate.ts` is still running to catch the skill's output
or push on its behalf. A route-side push would need the route to poll or
block until the agent finishes — a shape this file does not have today and
the plan's Design section does not ask for. **The agent-side push — the
skill itself runs `git add`/`git commit`/`git push` from inside the worktree
it is already running in, once Phase 5b and Phase 7 finish writing — fits the
existing hand-off without changing `interrogate.ts`'s control flow at all.**
If you choose this, the skill's commit+push step is the equivalent of
`bookOnPlanPr`'s four write calls, done as plain `git` commands inside the
worktree rather than through the `Trees` port (the skill is not board code
and does not import it). State that choice explicitly in the plan's Open
Questions checklist rather than leaving it silently decided by what got
written.

**The second and third open questions are narrower, and this wave answers
them by scope, not by designing new behavior.** Whether the route should also
serve an Approved plan taken back for interrogation is explicitly out of
scope — the plan's Motivation names only the Draft case, and `needs-design`
already owns the Approved-taken-back path. A plan PR branch that moved during
the run (someone pushed to `idea/<slug>` while `/challenge-the-plan` was
running) should refuse rather than silently overwrite or rebase —
`bookOnPlanPr`'s own guard (`needs-design.ts:512-514`, "the local branch...
differs from origin/... this command does not reset a branch holding work")
is the shape to match: refuse by name, push nothing, leave both the remote
branch and the worktree's uncommitted diff for a person to reconcile. Do not
build a rebase-and-retry path — nothing in the plan asks for one, and a
retry that resolves a conflict unattended risks losing either side's
intent.

**The round is owed even when nothing else changed.** Phase 5b of
`challenge-the-plan/SKILL.md` runs at the end of every round, including one
that found no gaps — a round that survives scrutiny unchanged still needs the
`Rounds:` bump and the metadata block, because the count is the only record
that someone looked. Whatever push mechanism you build must fire on that
same "every round" cadence, not only on rounds that produced an Open Points
entry: an empty staged-diff check (`hasStagedChanges`, as `bookOnPlanPr` does)
is the existing pattern for "nothing to commit," and firing it after Phase 5b
always writes something (round count moves even when Open Points doesn't).

### Done when

The plan has no `## Done when` list; the specification is the plan's Design
section's step 3 and the three named artifacts. Concretely:

- A completed `/challenge-the-plan` round against a Draft plan resolved via
  its open plan PR (the wave-1 path) results in `idea/<slug>` carrying a
  commit with the `Rounds:` increment, the Open Points section, and the
  `CHALLENGE-THE-PLAN-METADATA` block — all three in one commit, matching
  what a same-branch (no plan-PR) round already writes locally. Catches: a
  push that lands only the metadata block or only the `Rounds:` line,
  leaving the two to disagree (the SKILL.md rule they must not).
- A plan PR branch that has moved (local-vs-remote mismatch, if the chosen
  mechanism uses a worktree port) refuses by name and pushes nothing — both
  the plan's working-tree edit and the remote branch are left for a person.
  Catches: a silent overwrite of someone else's commit to `idea/<slug>`.
- A round that changes no decision (no new Open Points, same categories
  covered) still produces a push, because `Rounds:` moved. Catches: a
  no-op-looking round being treated as nothing-to-commit when the round
  count itself is the diff.
- The `## Plot Config` fallback path (no open plan PR — `Plan PRs: optional`,
  or a Draft plan already on the default branch) is unaffected: that round
  still commits locally in `opts.repoRoot` exactly as it does before this
  wave, with no push added where none was needed before.
- New tests live beside wave 1's, in
  `packages/board/test/unit/interrogate-route.test.ts` if the push is
  route-triggered, or in `skills/challenge-the-plan`'s own test coverage (it
  currently has none — a full lifecycle walkthrough per
  `skills/plot/README.md`'s documented test runs is this repo's standard for
  skill behavior) if the push is agent-side. Write new helpers as arrow
  functions in `packages/domain/src/**` and any new `packages/board/src/**`
  file.

Plus: a changeset for whichever package changes (`plot` if only the skill
moves, `@plot-pm/board` if `interrogate.ts` or its callers move) per the
repo's versioning rules — description first, `bumps:` block last. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the suites in the `CI suites` config key run in CI, and a
failure there comes back as a correction. List no full suite.
`scripts/check-shell-lines.sh` refuses a pull request whose shell under
`skills/` is longer than at its merge base — this slice likely touches no
`.sh` file (the skill is markdown, the route is TypeScript), but if it grows
one, pay for it in the same change.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the
work moves), never `gh pr create`. When it exists, append `→ #<number>` to
this branch's line in the plan's `## Slices` section. Push the first real
commit as soon as it exists.

### Scope guard

This branch owns the push mechanism — wherever it lands: `challenge-the-plan`
SKILL.md's Phase 5b/7 write step if agent-side, or a new function in
`packages/board/src/server/interrogate.ts` plus its tests if route-side —
and the plan's Open Questions checklist (mark the first question answered,
naming which side you chose and why). It does not touch
`prepareInterrogateWorktree`, `resolveInterrogatePlanPr`, or any of wave 1's
read-path functions except to call them or read the worktree path they
expose. Wave 1 (`bug/interrogate-reads-the-plan-pr`) is merged, so there is no
other branch in flight on this plan to collide with — `git log` since
approval shows only wave 1's own commit on `interrogate.ts`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
