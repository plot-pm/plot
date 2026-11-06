## Implementation brief — who-may-approve-a-release-and (wave "Reviewer role")

- **Plan (canonical):** `docs/plans/2026-11-03-who-may-approve-a-release-and.md` on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/the-reviewer-loads-its-role-file` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (`Review: pr`); `plot/review` is required on `main`

This is the last wave of the plan. Both slices it waited on have merged: the loader (`feature/one-loader-reads-a-role-file`, #3191) and `feature/the-release-review-is-switched-on` (#3175). Nothing waits on it.

### What to build

The reviewer starts today from `.plot/charters/reviewer.json`, read from the main checkout's working tree (`packages/board/src/server/entry/review.ts:348`, reader at `:600`), and no code loads `.claude/agents/reviewer.md`. A PR head or a dirty main checkout can therefore change the reviewer's definition, and the role file that fixer, main-repair and the unblocker already load from a fetched `origin/<default>` is ignored for the one role that gates every merge.

Build this on top of what exists:

- `reviewPr` calls `roleFilesAt` (`packages/fleet/src/shared/role-files.ts`) with `role: 'reviewer'`, `settings: false`, and an `outDir` under `.plot/state/reviewer/`. It takes `model`, `effort` and `maxTurns` from `reviewer.md`. `@plot-pm/board` already imports `@plot-pm/fleet/shared/*` (`contract/schema.ts:22`; the fleet `exports` map has `./shared/*`).
- `reviewerCommand` (`packages/domain/src/rules/review-verdict.ts:157`) stops taking a charter. It takes the role's `model`, `effort` and `maxTurns`, and keeps every floor flag it builds today: `--tools` from `REVIEWER_TOOLS`, `--disallowedTools` from `REVIEWER_DENY`, `--permission-mode dontAsk`, `--strict-mcp-config`, `--setting-sources user`, `--add-dir <reviews dir>`. The reviewer loads its definition by `--agent reviewer --agents "$(cat -- <agentsFile>)"`, the shape `roleCommand` (`rules/role-command.ts:62`) uses.
- `ReviewDeps` replaces `readCharterText` with the two ports `roleFilesAt` needs (`Trees.fetch`, `Refs.defaultBranch` and `Refs.showFile`). `review.ts:98` already holds `trees`; add a `refs`.
- Delete `.plot/charters/reviewer.json`. Remove only the reviewer's reader (`review.ts:13`, `:348-351`, `:600-603`). The `charter` entity and `packages/domain/test/charter.test.ts` stay: other agents use them (`packages/fleet/src/server/entry/prompt.ts:58`).
- A role file that widens the floor refuses `reviewer-role-widens` and names the key. A start with an absent or unreadable `reviewer.md` refuses with the file and the loader's reason (`default-branch-unfetched`, or `.claude/agents/reviewer.md is not on origin/<default>`), so `review-not-passed` is never the only signal.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **`roleCommand` is not the reviewer's command, and `roleAgentsJson` cannot find a widening.** `roleCommand` requires a `settingsFile` and passes `--settings`; the reviewer has none, and its flags must stay the code's floor. Do not give the reviewer an empty settings file to fit the function. `roleAgentsJson` (`role-command.ts:109`) drops every key outside `JSON_KEYS` without a word, and `mcpServers` is outside it, so a role file that declares MCP servers translates to clean JSON. Run the widening check on the role file's frontmatter text, which the loader does not return, or on a parse that sees every key. A check over the JSON output passes the case the plan names.
- **The widening rule, as the plan states it.** Refuse when `tools` names anything outside `REVIEWER_TOOLS`, when `permissionMode` is set, when `disallowedTools` is wider than the floor allows, or when `mcpServers` is set. Name the key in the refusal. The current `reviewer.md` declares `tools: Read, Grep, Glob`, `model`, `effort`, `maxTurns: 40`, `description`, `prompt` and `isolation`, and no `permissionMode`, so it passes. Test that exact file passes.
- **The charter's other fields are already covered.** `name`, `prompt`, `model` and `effort` are in `reviewer.md`'s frontmatter. `capabilities: ["read-only"]` is replaced by the floor and the `tools` list. `harness` is unset in the charter and stays the default `''`. The old refusal for a harness other than `claude` goes with the charter.
- **`role-gate.ts`'s reviewer exception (`rules/role-gate.ts:69`, `:277`) and the writer identity #3074 compares against stay unchanged.** The plan decided both.
- **Fetch before the read, from the default branch.** The reviewer reads `origin/<default>` through `roleFilesAt`, never the checkout and never the PR head. That is what stops a PR head rewriting its own reviewer. The tree the reviewer reads the PR in (`review-<pr>-<sha7>`) stays a detached worktree at the head; only the role definition moves.
- **Turn limit from the file.** `maxTurns` comes from `reviewer.md` (`40`). Do not add a constant like main-repair's `MAIN_REPAIR_MAX_TURNS`, which the loader slice removed.
- **No real agent run in CI.** The process-free proof is `review.test.ts` with the fake `agentRun`: a verdict still writes `plot/review` on the head. A real agent run is outside CI; say so in the PR body rather than claiming it.

Rules carried over unchanged: absent is not false (a missing `reviewer.md` refuses, it never starts a reviewer with defaults); read the exit code, not the emptiness; a refusal ends the action and the review never writes `success` for a run that did not start.

### Done when

The plan's `## Done when` and the Reviewer role test list are the specification (`packages/board/test/unit/review.test.ts`). Lifted assertions a naive implementation would pass without:

- A `reviewer.md` that adds `Bash` to `tools` refuses `reviewer-role-widens`, starts nothing and writes no status. Without it, a loader that only translates the file passes every other test.
- A `reviewer.md` that sets `mcpServers` refuses by name. This is the case `roleAgentsJson` hides; a check on its JSON output fails this test and an implementation that checks the JSON would not notice.
- A `reviewer.md` that sets `permissionMode` refuses by name.
- An absent `reviewer.md` refuses naming `.claude/agents/reviewer.md`. The existing test at `review.test.ts:336` (harness not `claude`) is replaced, not left alongside a dead charter fake.
- The reviewer command carries `--model`, `--effort` and `--max-turns` from `reviewer.md` and keeps every floor flag; assert each flag by name, as the test at `:318` does for the three it holds today.
- A `reviewer.md` whose text on the checkout differs from `origin/<default>` runs with the `origin/<default>` text. This is the fixer's test shape at `auto-fixer.test.ts:196`.
- With the fake `agentRun`, a clean answer still writes `plot/review` = `success` on the head SHA.

Plus the repo gates: `skills/plot/scripts/board/plot-review.mjs` is generated, so commit no bundle (`scripts/check-no-bundle-diff.sh`); update the `board/plot-review.mjs` row in `skills/plot/scripts/README.md:97`, which names `.plot/charters/reviewer.json` (`scripts/check-helper-table.sh`); add a changeset (package `plot` or `@plot-pm/board`; description first, `bumps:` block last, `plan:` line naming this plan's path inside it). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge. Write the new function bodies as arrows (`export const f = (…) => …`).

### Bookkeeping

When the PR opens, run `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts`, `packages/domain/src/rules/review-verdict.ts` (`reviewerCommand`), their tests (`packages/board/test/unit/review.test.ts`, the domain test for `reviewerCommand`), `.plot/charters/reviewer.json` (delete), the `plot-review.mjs` README row, and one changeset.

It does not own `packages/fleet/src/shared/role-files.ts` or `rules/role-command.ts`. If the widening check needs a new export from either, add the export and nothing else there. It does not touch `rules/role-gate.ts`, `continue.ts` or the release-approve files.

Verified at dispatch (2026-11-06, `origin/main` at `4e09924c3`): no open PR touches `entry/review.ts`, `review-verdict.ts`, `role-files.ts`, `role-command.ts` or `.plot/charters/reviewer.json`. The other five slices of this plan are merged (#3083, #3103, #3186, #3190, #3191).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
