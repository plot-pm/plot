# Round 1 — moderation

Subject: `docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md` at `839959a6`.

| Juror | Position | What the juror did |
|---|---|---|
| skeptic | amend | Checked every cited line and count on `origin/main`; measured basename coverage over the test globs |
| operator | amend | Read the gate, the loop's correction path and the briefs on main; measured how many test files name the most-changed scripts |
| domain | amend | Read the ports, the bundle build, `plot-config.sh` and the gate hook; the live gate refused one of its own read-only greps |

The panel is unanimous on `amend`. No juror ran a suite, by instruction: the machine was at load 50-60.

## Agreed by all three

- **The gate arm as placed never fires for a fleet agent.** `plot-controller-gate.sh` exits 0 when the command names none of its three scripts, and again for every linked worktree. A fleet desk is a linked worktree. The arm goes before both exits.
- **The gate must match what runs, not any token.** The live gate refused a read-only `git grep` that named a gated script. A suite word in a commit message, a `grep` or a PR body must pass. The expansions an agent will type (`node --test test/reconcile/*.test.mjs`, `pnpm --filter @plot-pm/domain exec vitest run --coverage`) are either listed or stated as passing.
- **`test:board` runs 24 `node --test` files, 63 vitest integration files and 133 unit files**, not 24 and 133. The root `package.json` has no `test:coverage`; CI runs `pnpm --filter @plot-pm/domain exec vitest run --coverage` (`ci.yml:884`).
- **Basename selection over-selects for the files agents change most** (`plot-dispatch.sh` 69 test files, `plot-fleet-scan.sh` 56, `plot-config.sh` 43, `board-server.mjs` 38) and under-selects for TypeScript, whose tests import `.js` paths and barrels. Generated bundles must not select.
- **The typecheck trigger cannot be built into the rule.** Root `typecheck` checks only the board package, and `.ts`/`.tsx` is one language's spelling. It is a configured check per glob.
- **The Done-when load line belongs to no slice** and cannot separate this plan from the cap change from 8 to 5 made the same evening.

## Where the jurors differ

- **When the miss rate is measured.** The skeptic wants the share of first-run CI failures the selection would not have chosen counted before approval. The operator and domain jurors accept it in slice 1's PR body. The moderation sides with a gate rather than either timing: the count needs the selector slice 1 builds, so it cannot precede slice 1, and the slice that moves agents off the full suites does not merge until the count is in and under a stated bound.
- **What keys the gate.** The skeptic and operator key it on the desk (a linked worktree, the gate's own measurement). The domain juror keeps `PLOT_UNATTENDED=1` as a cheap shell prefilter. Both hold: the desk decides, and the prefilter only avoids a `node` start on every Bash call of every session.
- **Bundle-reached tests.** The skeptic offers two answers: select a bounded integration subset, or declare those suites CI-only and accept the measured miss rate. The plan takes the second, because the board integration suite starts the built artifact and its cost is the cost this plan removes.

## What no lens looked at

All three lenses read the plan's text and the code it cites; none asked where a CI failure goes after the agent has left. The operator named the `Correction budget` route (`plot-worker-loop.sh:235-264`), which delivers a failed build as a correction **while the agent is still on the slice**. The moderator checked the other half on the live fleet: `attention.ts:113` maps `build failed` to `needsHuman`, and on 2026-10-02 the agent on `bug/a-started-agent-leaves-its-starters-group` opened PR #1168, went free at about 02:35, took another slice in the same desk, and CI failed at 02:43 with no slice for the correction to reach. A person found and fixed it. Moving the suites to CI moves their failures into exactly this gap, so the gap is closed first, in its own slice.

## Amendments applied

1. Facts corrected: the `test:board` count, the coverage command, and the load figures stated as single samples with the recorded baseline named.
2. New first slice: an agent keeps its slice until its PR's checks finish, so a failed run reaches it as a correction.
3. The rule reads changed paths through the `Refs` port (`changedFiles`, extended with working-tree paths), not a new adapter.
4. One config key, `Local checks`, holds `glob = command` pairs separated by `;`, with `{tests}` (selected test files) and `{changed}` (changed paths, for runners that follow imports, such as `vitest related`). The typecheck is a pair like any other. `plot-config.sh` strips parentheses and normalises commas, which the plan states.
5. Generated bundles never select (read from `.gitattributes`, as `plot-deliverable-search.sh` does), and a path naming more test files than `Local checks limit` (default 20) reports *CI runs these* instead of a list.
6. The entry is named: `packages/board/src/server/entry/local-checks.ts`, its `build.mjs` block, its `.gitattributes` `-merge` line, the narrow import path; the brief and prompts name it by a path that resolves under a plugin install.
7. The gate arm sits before both exits, is decided on the desk with `PLOT_UNATTENDED=1` and a configured suite word as the shell prefilter, matches the command's runner position against `CI suites` entries spelled as CI runs them, and passes reads and messages. It reaches this fleet after a release and a plugin update, which the plan states.
8. Order: the slices land as a chain, 1 to 4, each waiting on the one before (a multi-branch `waits:` reads only its first branch, #1153); `CI suites` lands with slice 2, the gate is slice 3, and the brief and prompt change is slice 4. The miss rate is counted in slice 2's PR body and slice 4 does not merge above the bound.
9. The load comparison runs after slice 4 merges, against the one-hour baseline recorded 2026-10-02 from 02:55 with the cap at 5 and the running agent count in every sample (7 at the start, because agents above a lowered cap finish their slices), and is recorded in the plan before delivery.
