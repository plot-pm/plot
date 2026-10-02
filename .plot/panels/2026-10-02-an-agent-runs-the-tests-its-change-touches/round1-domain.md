# Domain — round 1

Position: amend

## 1. Factual claims checked on origin/main

The plan file on origin/main is byte-identical to the working-tree copy.

- `skills/plot-implement/SKILL.md:239` holds *"Plus: <the repo's gates — test commands, build artifacts, changeset,"*, and the quote ends on line 240. True.
- `skills/plot/templates/worker-prompt.sh:186` holds *"run the repo's gates, and never skip a failing test"*. True.
- `.plot/worker-prompt.sh` holds *"Follow CLAUDE.md: pnpm install if node_modules is missing, never skip tests, …"* (line 190). True.
- `.plot/briefs/the-loop-waits-out-a-usage-limit.md:70` lists `pnpm test`, `test:contracts`, `test:board`, `typecheck`. True.
- `package.json:18-19` are `test:board` (1200 s bound) and `test:contracts` (1500 s bound). True.
- `test:contracts` runs 115 files (`test/reconcile/*.test.mjs` = 115). True.
- `packages/domain/package.json:23-24` are `test` and `test:coverage`. True. The domain package has 129 files under `packages/domain/test` plus 12 corpus files. True as stated.
- *"test:board … runs 24 integration files and 133 unit files"*: false in two ways. The 24 files are the node:test artifact suite (`packages/board/test/*.test.mjs`), not integration files. `test:board` also runs `packages/board/test/integration` (63 vitest files, Playwright included), which the plan omits. The real count is 24 + 63 + 133 = 220 files.
- *"CI runs all of them on every PR"*: true for the work, false for the spelling. CI never runs `pnpm run test:board` or `test:coverage`. It runs `pnpm --filter @plot-pm/board test` (ci.yml:912), `pnpm --filter @plot-pm/board exec vitest run` (ci.yml:951), `pnpm --filter @plot-pm/domain exec vitest run --coverage` (ci.yml:884) and `pnpm --filter @plot-pm/domain typecheck` (ci.yml:876). This matters for slice 3: a gate keyed on script names misses the spellings that CI itself uses.
- *"`pnpm run test:coverage`"* (Motivation): the root `package.json` has no `test:coverage`. Only `packages/domain` defines it, so the measured command ran inside the package or through `--filter`.
- The CLAUDE.md quote about `test:e2e` (lines 647-649) is accurate.
- *"4-9 times the core count"*: 55/16 = 3.4, so the lower bound is 3.4. The load samples, the agent commands and the scan timeout cannot be verified from git. I did not check them.

## 2. Changelog and Done-when coverage

- Done-when *"on a branch that changes one domain rule prints that rule's tests and the typecheck"*: this repository's `Typecheck command` would be `pnpm run typecheck`, and that typechecks `@plot-pm/board` only (package.json:17). The domain typecheck is a separate command (ci.yml:876). As designed, the single key cannot express *"the domain typecheck for a domain change"*, so the line passes on a technicality and leaves the domain unchecked.
- Done-when *"Over one hour with 5 agents, load below 32"*: no slice can deliver this, because the outcome depends on the fleet, the cap and the hour. Slice 2's PR is opened before any agent runs under the new brief line. State it as a measurement after delivery, or move it to Open Points.
- Done-when *"An unattended agent that runs `pnpm run test:contracts` is refused"*: slice 3 places the arm in `plot-controller-gate.sh`. As written, that arm never fires for an agent (see 3a).
- Every other line maps to a slice.

## 3. What would break

- 3a. **`plot-controller-gate.sh` exempts every desk.** Lines ~193-201 on origin/main run `exit 0` when `--absolute-git-dir` differs from `--git-common-dir`, which is true for every dispatched agent. Before that, line ~142 runs `[ -n "$named_script" ] || exit 0` for any command that names none of the three lifecycle scripts. An arm appended "to the gate" after either line is dead for exactly the population it targets. The plan must place the arm before the `named_script` early exit and say so. Better still, give it a separate section with its own fail-open guard, because this gate's header defines its purpose as *controller routing* and says *"WHAT IS GATED IS THREE SCRIPTS"*.
- 3b. **Token matching refuses reads.** During this review, the live plugin gate refused my read-only `git grep … plot-dispatch.sh` because the path token's basename matched. A `CI suites` arm that matches the token `test:contracts` refuses the same way: `git grep test:contracts`, `jq .scripts package.json | grep test:board`, or a commit message that mentions a suite. This hits an unattended agent that edits CI or package.json, which is the agent most likely to name a suite. `ciSuiteRefusal` needs a defined matching shape, for example a suite name in the script position of `pnpm run|pnpm|npm run|yarn` after `strip_quoted_heredocs`. Test cases must include the read-only shapes as passes.
- 3c. **Cost on every Bash call.** The hook runs on every Bash tool call of every agent. Calling a node bundle costs ~35-40 ms (docs/shell-and-domain.md), and a `plot-config.sh` read adds to that, on every call. The cost rule allows this once per operator command, not once per tool call. The arm needs a shell prefilter: `PLOT_UNATTENDED=1` and the command contains one of the configured suite words. Only then should it ask the bundle.
- 3d. **The repo-relative path breaks plugin consumers.** The brief line and both prompts would say `node skills/plot/scripts/board/plot-local-checks.mjs`. An adopting project that installs Plot as a plugin has no `skills/` directory, so the path is #969's shape (`scripts/check-bundle-resolution.sh`, `test/reconcile/bundle-resolution-gate.test.mjs`). The gate's refusal text must print `$HERE/board/plot-local-checks.mjs`, quoted with `%q` like the receipt line. The brief template needs a resolved path or a name on PATH. Today the worker launch puts only `skills/plot/scripts` on PATH, not `board/`.
- 3e. A new build output without its `.gitattributes` `-merge` line fails `scripts/check-bundle-attributes.sh` (`test/reconcile/bundle-attribute-gate.test.mjs`). The plan does not name the line.
- 3f. The domain coverage gate is 100% on the pure side (packages/domain/vitest.config.ts). Slice 1 adds a rule and an adapter, and `test:coverage` would leave local runs under this plan. A coverage miss is then found only in CI, one round trip per slice. Accept that and state it, or have `localChecks` select the domain coverage run when `packages/domain/src/**` changes.
- 3g. `plot-config.sh` strips `( … )` and normalises commas in every value (lines ~255-260). A runner command that contains parentheses or commas is corrupted silently. I measured that `**/*.test.mjs = …; … = …` survives the parser. The plan must name `;` as the pair separator and state the parenthesis limit.

## 4. Estate overlap and repo rules

- `deliverable-search` finds no existing `localChecks`, `Test runners`, `CI suites` or `Typecheck command`. The deliverable is new.
- **The changed-paths reading already exists.** `Refs.changedFiles(branch)` (ports/refs.ts:121, refs-git.ts:178) runs `git diff --name-only origin/<main>...<branch>`, and `Refs.repoRoot` and `Refs.isRepository` exist too. A new "`local-checks` adapter" would be a second git reader of the same question. Extend the `Refs` port with the two missing reads instead: uncommitted and untracked paths, and files that name a string under given globs. Read the config keys through the `Scripts` port, the way `agents-fs.ts:215` reaches `plot-config.sh`. Or take the config values as arguments or stdin, the way `entry/desk-root.ts` does. The plan names no port. It must name the port.
- `localChecks` and `ciSuiteRefusal` belong in `packages/domain/src/rules/` as arrow functions that take readings as values. The plan says this for `localChecks` and only implies it for `ciSuiteRefusal`. State the signatures explicitly, for example `localChecks({ changed, references, runners, typecheck })` and `ciSuiteRefusal({ command, suites, unattended })`. Readings stay values, so the rule is synchronous and needs no mocks.
- The entry is not named. It goes in `packages/board/src/server/entry/local-checks.ts`, imported through the narrow path `@plot-pm/domain/rules/local-checks`, with a `build.mjs` block like the panel's (build.mjs:312-331) and a `.gitattributes` line. *"A bundle verb"* for the gate is also unnamed. Say which bundle answers `ciSuiteRefusal`. If it is `plot-local-checks.mjs`, its refusal verb must not load the git adapter, or the hook pays for git on every call.
- **Project-agnostic: two hardcodings.**
  - *"typecheck when any changed path ends in `.ts` or `.tsx`"* puts a language assumption into Plot's rule. Make the trigger a glob in config. One option is to fold the typecheck into the runners mechanism as a glob over changed paths, which also fixes the board-only typecheck in section 2.
  - *"over the test globs"* does not say where those globs come from. They must come from the `Test runners` globs, never from a built-in `*.test.*` pattern.

  The example values (`@plot-pm/domain`, the four suite names) appear only as this repository's config, which is correct.
- No new `plot-*.sh` script: this holds only if the arm stays inside an existing gate. `plot-install-hooks.sh` reads the gate set from `hooks/hooks.json`, so no install change follows. Keep it that way.
- The basename `git grep` runs once per changed path. Batch it: one `git grep -l -F -e a -e b …` over the runner globs, then attribute matches in the rule. On a board change the changed set includes 30+ bundles.

## 5. Amendments before approval

1. Correct the `test:board` file count (24 artifact + 63 integration + 133 unit). Note that CI spells the suites as `--filter` commands, and that the root has no `test:coverage`.
2. Name the port: extend `Refs` with working-tree paths and a batched name search, and read config through `Scripts` or as entry arguments. Drop the separate "local-checks adapter".
3. Name the entry file, its `build.mjs` block, its `.gitattributes` `-merge` line and the narrow import path. Name which bundle answers `ciSuiteRefusal`.
4. Slice 3: place the arm before the `named_script` early exit and before the desk exemption in `plot-controller-gate.sh`, with a shell prefilter on `PLOT_UNATTENDED=1` and a configured suite word. Define the matching shape so that reads and commit messages that mention a suite pass. Add those passes, and a desk-cwd refusal, to the test list. The refusal prints a script-relative bundle path.
5. Make the typecheck trigger config-driven (a glob, or a runner over changed paths), not `.ts`/`.tsx` in the rule. State that the test-search globs are the runner globs.
6. Replace `node skills/plot/scripts/board/plot-local-checks.mjs` in the brief and prompt text with a path that resolves under a plugin install.
7. Name `;` as the `Test runners` pair separator, and state that `plot-config.sh` strips parentheses.
8. Move the one-hour load measurement out of Done-when into a post-delivery measurement, or name the slice that can deliver it.
9. State whether the domain coverage gate leaves local runs, and accept the CI round trip, or select it for `packages/domain/src/**` changes.
