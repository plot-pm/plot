## Implementation brief — a-start-step-leaves-no-claim-and-no-desk (slice 2: a worker-less checkout yields its branch)

- **Plan (canonical):** `docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-worker-less-checkout-yields-its-branch` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the repo's PR review; the plan's `Review:` is `in-session`

Slice 1, `bug/the-implement-step-stops-at-the-brief`, is independent of this branch. Neither waits on the other: this slice also clears a checkout that a person's `/plot-implement` left.

### What to build

An agent that the supervisor hands a slice cannot take the branch while another worktree holds it. Measured 2026-10-01: agent `11945014` was handed `bug/the-merge-subject-is-one-rule`, and `reset_desk` (`skills/plot/scripts/plot-worker-loop.sh:871`) ran `git checkout -b "$branch"` and then `git checkout "$branch"`. Git refused both because `.worktrees/the-merge-subject-is-one-rule` held the branch. That checkout was clean: no change, no commit, no `.plot-worker.*` file. The board row read *held in a local worktree* until a person ran `git worktree remove`.

Three parts:

1. **The rule.** `checkoutYield` in `packages/domain/src/rules/checkout-yield.ts` takes readings of the worktree that holds the branch and answers `{ yields: true }` or `{ yields: false, condition }`. It tests six conditions in this order: `live-worker`, `blocked-marker`, `uncommitted-changes`, `unpushed-commits`, `registered`, `main-checkout`. An `unknown` reading keeps the checkout. The plan's table names the shell source of each reading. Write the rule as an arrow function with a factual TSDoc block, the style `rules/reapable.ts` and `rules/start-command.ts` already use.
2. **The bundle.** `skills/plot/scripts/board/plot-checkout-yield.mjs`, built from a new entry under `packages/board/src/server/entry/`, with its line in `packages/board/build.mjs` and a `-merge` line in `.gitattributes`. Copy the shape of `entry/start-command.ts`: the narrow import `@plot-pm/domain/rules/checkout-yield`, one tab-separated readings line on stdin, `yields` or `keep\t<condition>` on stdout, exit 2 for unreadable input. Check that the package's `exports` map and any index list the new rule path the way they list `start-command`.
3. **The loop.** `reset_desk` changes in one place. When both checkouts in step 2 fail, the loop reads the holding path from `git worktree list --porcelain`, takes the readings, and asks the bundle. On `yields` it runs `git worktree remove "<path>"` without `--force`, logs *"removed the worker-less checkout at <path> that held <branch>"*, and retries step 2 once. On `keep` it leaves the checkout alone and writes a `PLOT-BLOCKED` in its own desk naming the path, the branch and the condition. A bundle that cannot be asked keeps the checkout and writes the same marker with the condition `unaskable`.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The loop calls the bundle; it does not copy the rule into shell.** The cost rule in `docs/shell-and-domain.md` permits a hop in a script that runs once per agent per pass only when it is rare. This call fires only when `reset_desk` fails because a worktree holds the branch, which is once per take-up. `node -e ''` starts in 34 ms and a shipped bundle answers in 39 ms, so the cost is one 39 ms call on a path that already runs git four times. `desk_reset_refusal` stays as it is: it asks about the loop's OWN desk, and this asks about ANOTHER one.

**`git worktree remove` without `--force`.** A force flag would delete the uncommitted file the `uncommitted-changes` reading missed. Without it git refuses on a modified or untracked tree, so a wrong reading costs a refused removal and not lost work. Do not add `--force`, `reset --hard` or `clean`. This is the same refusal `reset_desk`'s own comment at `plot-worker-loop.sh:864-870` gives for plain checkouts.

**Reuse the reap words.** `live-worker`, `blocked-marker`, `uncommitted-changes` and `unpushed-commits` are four of `ReapRefusalSchema`'s six values (`packages/domain/src/entities/worktree.ts:30`). Use the same spellings so an operator greps one vocabulary. `registered` and `main-checkout` are new to this rule. Do not extend `ReapRefusalSchema`: the reaper's condition set stays what it is.

**Read the checkout's readings, not the asking desk's.** `desk_reset_refusal` reads `$PLOT_WORKTREE`, the agent's own desk, and its header names why it skips `liveWorker`: the asking agent is the live worker. Here the subject is the OTHER worktree, so `live-worker` IS asked, through `plot-worker-state.sh`, which the loop already sources. Passing the agent's own path would refuse every case.

**`registered` is read from the registry directory.** A manifest naming the checkout's path means another agent owns that desk, even with no live pid between two slices. The directory is the one `PLOT_MANIFEST_FILE` sits in. Do not hardcode `.plot/agents`: `Agent registry` is configurable (`plot-config.sh get "Agent registry"`), and `drop.ts` already hit that mistake.

**`unknown` keeps.** With no `@{upstream}` the unpushed count cannot be taken. `desk_reset_refusal` treats that as no refusal because a reset rewrites nothing. Removing a checkout deletes its only copy of an unpushed commit, so here an unreadable count keeps it. That is the opposite polarity to `desk_reset_refusal` on purpose, and a comment in the loop must say so. A reviewer who copies the other function's `''|0|*[!0-9]*) ;;` case here removes a checkout holding unpushed work.

**The main checkout is never removed.** `git worktree list --porcelain` prints it first. Test the holding path against that first entry, and add a reading for it even though git itself refuses to remove it, so the refusal names `main-checkout` and not git's own sentence.

**Carried over unchanged from the estate:**

- Absent is not false. A reading the shell could not take is `unknown`, never `0` or empty.
- Read the exit code, not the emptiness: the bundle's exit 2 means it could not answer, and the loop must not read that as `yields`. Test the failing-bundle case.
- A refusal ends the action. On `keep` the loop writes the marker and takes no second route to the branch. No `git worktree add` fallback onto a different path for the same branch: git refuses it.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **Every condition has its own unit case, in the order tested, plus one case where two conditions hold at once.** A rule that tests in a different order passes the single-condition cases and fails the two-condition one, which pins which word the marker carries.
- **`unknown` on each reading keeps.** Run six cases, one per reading. A rule that treats a missing reading as clean passes every known-reading case.
- **The contract test (`test/reconcile/`) holds the branch in a clean worker-less worktree and asserts three things:** the loop checks the branch out, the worktree path no longer exists, and the log carries the removal sentence. Its second case holds the branch in a worktree with one uncommitted file and asserts the worktree and the file survive and the marker names `uncommitted-changes`. A loop that removes with `--force` passes the first case and fails the second.
- **A third contract case stubs the bundle to exit 2** and asserts the worktree survives and the marker names `unaskable`.
- **100% branch coverage on `checkout-yield.ts`.** Run the domain coverage command the repo's other rules use and read the branch column.

Plus the repo gates: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds the artifact) and `pnpm run typecheck`, under Node 24 (`nvm use`; pnpm crashes on 26). Commit the rebuilt `skills/plot/scripts/board/plot-checkout-yield.mjs`. Do not run `pnpm run test:e2e` locally; CI owns it. Existing loop tests (`test/reconcile/deskreset.test.mjs`, `workerloop.test.mjs`) must stay green, and the new cases belong in one of them or beside them.

### Bookkeeping

- Changeset `.changeset/a-worker-less-checkout-yields-its-branch.md` with `'@plot-pm/board': patch` in the frontmatter, description first. A board package change takes package frontmatter and no `bumps:` skills block. If the loop change needs a `plot` skill bump as well, add `'plot': patch` and the `bumps:` block last with the `plan:` line. Run `./scripts/check-changeset-packages.sh`. `.changeset/` holds siblings' files; add your own and touch none.
- Add the bundle's row to `CLAUDE.md`'s Helper Scripts table, in the style of the `board/plot-start-command.mjs` row: what it answers, who calls it, its size, why it is its own bundle.
- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. The slice heading carries `PR:` for slice 1, so follow that form: `(Branch: bug/a-worker-less-checkout-yields-its-branch, PR: #N)`.

### Scope guard

This branch owns `packages/domain/src/rules/checkout-yield.ts` and its test, the entry under `packages/board/src/server/entry/`, the bundle and its `build.mjs` and `.gitattributes` lines, the `reset_desk` change in `skills/plot/scripts/plot-worker-loop.sh`, the contract test, one `CLAUDE.md` table row and one changeset.

Not this branch's: `--brief-only` in `skills/plot-implement/SKILL.md`, `composeImplementPrompt` and the Implement capability reason (slice 1, `bug/the-implement-step-stops-at-the-brief`); `claimedBranches` and `queueOfPlan`, which still read every remote branch as claimed; `plot-dispatch.sh --release` and its race with the supervisor (#1152); `ReapRefusalSchema` and `rules/reapable.ts`; the board half of #1090, shipped in v2.22.0.

In flight on 2026-10-02: slice 1 edits `skills/plot-implement/SKILL.md` and `packages/board/src/server/implement.ts`, neither of which this branch touches. Other open branches may edit `plot-worker-loop.sh`; rebase onto main before you open the PR and keep the `reset_desk` change to the one place named above so a textual conflict stays small. If you find something the plan did not anticipate, report it rather than improvising outside scope.
