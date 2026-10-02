# Skeptic — round 1

Position: amend

The direction is right and has a precedent (`test:e2e`). But the cause is asserted from one snapshot, the selection rule has measured blind spots on this repository, the gate is easy to bypass, and the only effect measure in Done when cannot separate this plan from the 8→5 cap change made the same evening. The plan can pass every test it names and still not deliver a faster fleet or the same defect rate.

## 1. Factual claims checked against origin/main

- `skills/plot-implement/SKILL.md:239` carries the "Plus: <the repo's gates …>" line: TRUE (the line wraps over 239-240).
- `.plot/briefs/the-loop-waits-out-a-usage-limit.md:70` lists `pnpm test`, `test:contracts`, `test:board`, `typecheck`: TRUE (the `### Gates` section at 68-70).
- `skills/plot/templates/worker-prompt.sh:186` says "run the repo's gates, and never skip a failing test": TRUE.
- `.plot/worker-prompt.sh` says "Follow CLAUDE.md: … never skip tests": TRUE (line 190).
- `test:contracts` runs 115 files under a 1500 s bound (`package.json:19`): TRUE, 115 `test/reconcile/*.test.mjs` files.
- `test:board` "runs 24 integration files and 133 unit files" under 1200 s (`package.json:18`): FALSE in its labels and its total. `test:board` runs three things: the board's `node --test test/*.test.mjs` (24 top-level `.mjs` files, not integration tests), then `vitest run`, which collects 133 files under `test/unit` AND 63 files under `test/integration`. That is about 220 files, not 157. The plan understates the cost it wants to remove.
- The domain package has 129 test files with a coverage gate (`packages/domain/package.json:23-24`): TRUE (129 under `test/`, plus 12 corpus files). Note that the root `package.json` has no `test:coverage` script, so the literal `pnpm run test:coverage` that slice 3 lists only runs inside `packages/domain` or via `--filter`.
- CI runs all suites on every PR: TRUE (`ci.yml:129`, `:186`, `:206`, `:884`, `:889`).
- `plot-controller-gate.sh` "already matches commands against a list": PARTLY. It matches three script basenames, and at line 182-200 it EXEMPTS every call whose working directory is a linked worktree, which is exactly where a fleet agent runs. A new arm placed after that exemption never fires for a fleet agent.
- The load figures (16 cores, load 55-148 from 01:00 to 02:35, six of seven agents in a test command at 02:33, the board scan timeout): NOT VERIFIABLE. No recorded artifact (log, `uptime` series, `ps` capture) is cited, and the 02:33 reading is one sample.

## 2. Changelog and Done when coverage

- "Over one hour with 5 agents, load stays below 32": no slice delivers it as a causal claim. The cap moved from 8 to 5 on the same evening (`1ccbbab4` notes), so a 5-agent hour after slice 2 measures the cap plus the plan together. There is no 5-agent baseline without the change, so a pass cannot be attributed to this plan and a fail cannot be attributed to anything else.
- The same line is placed in slice 2's PR body, but the gate is slice 3. Slice 2 changes only prose (template, prompts, CLAUDE.md). The measured hour therefore tests prose compliance, which this repository's own CLAUDE.md calls a rule that "will eventually be violated".
- Existing briefs on main still list the full suites. Slice 2 changes the template only, so every slice whose brief was written before slice 2 keeps running the suites during the measured hour. No slice rewrites or flags them.
- "The same defect rate" has no Done when line at all. The Open Point that would measure it (first-run CI failures the selection would have missed) lands in slice 1's PR body, AFTER approval. The decision to trade local coverage for load is made before its cost is known.
- The other Done when lines (bundle output on a shell-only and a domain-rule branch, a brief naming the command, an unattended refusal, no new `plot-*.sh`, CI green, changesets) are each delivered by a named slice.

## 3. What would break or silently under-deliver

- Basename selection misses most of what fails in this repository. Measured on origin/main: 33 of 129 domain test files import through a barrel (`../src/index.js` or `../src/adapters/index.js`), so a rule change selects none of them. Domain tests import `.js`, not `.ts` (only 13 test files contain a `.ts'` string), so a literal `git grep -F <name>.ts` selects almost nothing; matching on the stem instead over-selects `index`, `schema`, `types`.
- Transitive reach is invisible to the rule. `plot-config.sh` is sourced by most scripts but only 21 of 115 contract tests name it; `plot-tmp.sh` is named by 4. A domain rule reaches the contract tests through a bundle under `skills/plot/scripts/board/`, and only 13 contract tests name any bundle. A board `src` change reaches the 63 integration tests through `board-server.mjs`, which they do not name by source path. These are the slow, failure-prone suites, so the selection skips exactly the tests most likely to go red.
- Under-selection moves the failure to CI, and a red CI round trip means a correction and a relaunch on the same machine. If the first-run CI failure rate rises, the fleet re-runs agents, and the load saving can be spent on restarts. The plan does not measure this rate before or after.
- The gate is string-matched and trivially bypassed: `node --test test/reconcile/*.test.mjs`, `pnpm --filter @plot-pm/domain exec vitest run --coverage`, `pnpm --filter @plot-pm/board exec vitest run`, or `env -u PLOT_UNATTENDED pnpm run test:contracts` all run the same suites. In the 02:33 snapshot, three of the six test commands were not of the `pnpm run <suite>` form the gate lists.
- The gate keys on `PLOT_UNATTENDED`, an environment variable. `plot-controller-gate.sh:33-36` explicitly rejects an env var as the distinguisher ("an env var is something an agent SETS") and uses the desk (linked worktree) instead. Adding an env-keyed arm to that file contradicts its own design rationale.
- `test/reconcile/controller-gate.test.mjs` asserts the gate's current behaviour; a new arm placed before the desk exemption changes the exit path for desk calls and may break its "a desk call passes" cases.
- Existing memory entries and CLAUDE.md sections tell agents to run single contract files alone and re-run under load. Those instructions stay and the agents will keep following them; the plan does not count them.

## 4. Estate and repository rules

- `refs-git.ts:178` already implements `changedFiles(branch)` as `git diff --name-only origin/<main>...<branch>` behind the `Refs` port. The new `local-checks` adapter should extend that port (add uncommitted and untracked paths) rather than add a second reader of the same diff.
- No existing related-test selector was found in `packages/*/src`, `skills/plot/scripts` or `scripts/`.
- The rule in `packages/domain/src/rules/`, a bundle rather than a new `plot-*.sh`, and readings as values all respect the repository rules. The gate arm in a shell hook that asks a bundle verb follows the `plot-agent-settings.mjs` precedent.

## 5. Amendments before approval

- Correct the `test:board` claim: 24 `node --test` files plus 133 unit and 63 integration vitest files.
- Attach the load evidence as a recorded series (or drop the figures to what was recorded), and record a 5-agent baseline hour BEFORE slice 2 so the Done when target measures this plan and not the cap.
- Move the defect-rate measurement out of slice 1's PR body into the plan before approval: over the last 50 merged fleet PRs, count first-run CI failures in files the basename selection would not have chosen. Add a Done when line that the first-run CI failure rate after slice 2 does not exceed that baseline by a stated margin.
- Define the matching rule exactly: strip `.ts`/`.tsx` to the `.js` import form, state the over-selection stoplist, and either follow barrels and sourced scripts one hop or name them as always-selected (`plot-config.sh`, `plot-tmp.sh`, `src/index.ts`, `adapters/index.ts`).
- Add a rule for bundles: a change under `packages/domain/src` or `packages/board/src` selects the contract tests that name the rebuilt bundle and a bounded integration subset, or the plan states that these suites are CI-only by design and accepts the measured miss rate.
- Gate on the desk (linked worktree), as `plot-controller-gate.sh` already does, not on `PLOT_UNATTENDED`; place the arm before the desk exemption; and match the suite by what runs (`test/reconcile/*.test.mjs`, `vitest run --coverage`, `@plot-pm/board … vitest run`) rather than by the `pnpm run` alias, with tests for each alias form and for `env -u`.
- Make slice 2 wait on slice 3, or move the load measurement to slice 3's PR body, so the measured hour runs with the gate in place. State what happens to briefs already on main.
