## Implementation brief — who-may-approve-a-release-and (wave 5: Role-file loader)

- **Plan (canonical):** docs/plans/2026-11-03-who-may-approve-a-release-and.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/one-loader-reads-a-role-file` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This wave waits on nothing. `feature/the-reviewer-loads-its-role-file` (wave 6) waits on this branch, because it reads `reviewer.md` through the loader this branch builds. The loader must therefore serve the reviewer too, even though no reviewer code moves here.

### What to build

One loader, `roleFilesAt`, in `packages/fleet/src/shared/role-files.ts`. It fetches the default branch, reads `.claude/agents/<role>.md` and (where the role has one) `.claude/settings/<role>.json` from `origin/<default>` through `Refs.showFile`, and writes `agents.json` and `settings.json` under `.plot/state/<role>/`. The pure translation stays where it is, in `packages/domain/src/rules/role-command.ts` (`roleAgentsJson`, `roleCommand`). No domain rule awaits or writes a file.

Today three callers load a role file, and each differs:

| Caller | Reads from | Fetches first | Turn limit |
|---|---|---|---|
| fixer, `packages/fleet/src/shared/auto-fixer.ts:458` (`startFixer`, `world.readRoleFile`, default at `:746`) | the main checkout's working tree; settings path `<main>/.claude/settings/fixer.json` at `:462` | no | `maxTurnsOf(text)` (`:177`), from the file |
| main-repair, `packages/fleet/src/shared/repair-role.ts:111-113` (`writeRoleFiles`) | `origin/<default>` through `Refs.showFile` | no | `MAIN_REPAIR_MAX_TURNS = 80` (`:18`, used at `:138` and `:191`) |
| unblocker, `packages/fleet/src/server/entry/registryd-main.ts:1312-1343` (`readRoleFile`, `unblockerMaxTurns`) | the main checkout's working tree; settings path `<main>/.claude/settings/unblocker.json` at `:1342` | no | `unblockerMaxTurns(text)`, from the file |

The failure the plan fixes: a dirty or off-branch main checkout, or a stale local `origin/<default>` ref, changes which role file a run starts from. After this branch, all three read the same fetched `origin/<default>` text and take `maxTurns` from it.

**The unblocker row is not in the plan.** #3084 (`feature/fleetd-starts-the-unblocker`) merged after approval, and the plan's *Order and siblings* section already decided this case: "if it merges first, the loader slice moves its load too." Move the unblocker onto `roleFilesAt` in this branch. The plan's line numbers for the fixer (`auto-fixer.ts:454-461`) are stale; the load is now at `:458-464`.

### Decisions the plan settles — do not re-derive them

**Fetch with `Trees.fetch`, and treat only a completed fetch as success.** The loader refuses `default-branch-unfetched` when the fetch fails and writes nothing. Use `Trees.fetch(repoRoot, base)` (`ports/trees.ts:605`, `PortResult<void>`): a failure there is the refusal. Do not use `Refs.fetchRemoteHead` as the gate: it falls back to `ls-remote` after a failed fetch and then answers `absent` or `present` for a ref that was NOT fetched (`ports/refs.ts:869-883`), so `present` would pass the gate on a stale local ref, which is the defect this branch removes. `repair-role.ts`'s deps already carry `trees.fetch`; `startFixer` and the unblocker run reach a `Trees` through their worlds, so add it to their deps rather than shelling out.

**One turn limit rule: `maxTurns` from the file, no constant.** `MAIN_REPAIR_MAX_TURNS` is deleted (both uses at `repair-role.ts:138` and `:191`). `main-repair.md` already says `maxTurns: 80`, so the observed limit does not change. `maxTurnsOf` (`auto-fixer.ts:177`) and `unblockerMaxTurns` are two copies of one regex; the loader returns the turn limit once and both go. A file with no `maxTurns` reads `0`, which `roleCommand` already treats as "no limit" (`role-command.ts:62`), so the loader must refuse nothing for an absent key.

**Settings come from `origin/<default>` for every role, not from the main checkout.** The fixer and unblocker pass `<main>/.claude/settings/<role>.json` as a path into the working tree today; after this branch they pass the file the loader wrote under `.plot/state/<role>/settings.json`. A role with no settings file (the reviewer has none) writes none and its `settingsFile` stays absent; `RoleAgentRef.settingsFile` is required today (`role-command.ts:26`), so widen it or give the loader's result its own shape. Decide in the code and say which in the PR.

**Per-role output directories.** `repair-role.ts` already writes `.plot/state/main-repair/agents.json` and `settings.json`. The fixer writes a per-PR `fixerAgentsJsonPath(repoRoot, number)` and the unblocker `.plot/state/unblocker.agents.json`; two fixers on two PRs run concurrently, so a per-role directory shared by all of them would let one overwrite the other's file mid-run. The loader takes its output directory as an argument; the fixer keeps a per-PR directory, main-repair and the unblocker keep one per role.

**Rules carried over unchanged.** A refusal from `roleAgentsJson` (no frontmatter, no `description`, no body) still refuses the start by name, as `repair-role.ts:116` does. An absent role file refuses naming the file and the ref (`.claude/agents/fixer.md is not on origin/main`), never a bare `role-files-failed`; `auto-fixer.ts:459-460` returns that opaque reason today. Keep `startFixer`'s refusal names (`role-files-failed`) as the outer reason, and put the file and cause in the logged detail, so the existing reasons and their tests keep their meaning. The fixer's start outcome stays `{ started: false, why }` and spends no attempt on a refused load, as for any refused start.

### Done when

The plan's `## Done when` does not exist as a heading; the plan's *Tests* section is the specification. For this slice it says:

- `packages/fleet/test/unit/repair-role.test.ts` — a failed fetch refuses `default-branch-unfetched` and writes nothing.
- `packages/fleet/test/unit/auto-fixer.test.ts:196` — the `readRoleFile(main, role)` fake is replaced; a `fixer.md` whose main-checkout text differs from `origin/<default>` starts with the `origin/<default>` text and its `maxTurns`.

Assertions that exist because a naive implementation passes without them:

- **The fixer test must make the two texts differ** in both `maxTurns` and the body, or reading the main checkout still passes. Assert the command carries the `origin` value, not just that it started.
- **Assert the fetch happens before the read**, not only that it happens: a fake whose `showFile` answers while `fetch` fails must still refuse. Without this, a loader that fetches after reading passes.
- **A failed fetch writes no file.** Assert the output directory is absent or unchanged, so a stale `agents.json` from an earlier run cannot be what the next command reads.
- **The unblocker gets the same two assertions**, in `registryd-main.test.ts`; its fake `readRoleFile` (`registryd-main.ts:1295`) goes the same way as the fixer's.
- **No `MAIN_REPAIR_MAX_TURNS` remains**: `git grep MAIN_REPAIR_MAX_TURNS -- packages` returns nothing, tests included.

Plus: a changeset (description first, `bumps:` block last; package `plot` or `@plot-pm/board`, never `@plot-pm/fleet`; `./scripts/check-changeset-packages.sh` checks it). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction; list no full suite and do not run `test:e2e` locally. Write every new function as an arrow, and keep TSDoc factual (what it does, its parameters, what it returns, how it fails; no history of the decision). This branch changes no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/role-files.ts` (new), `repair-role.ts`, `auto-fixer.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (the unblocker's load only) and their tests. It does not touch:

- `packages/board/src/server/entry/review.ts`, `rules/review-verdict.ts` or `.plot/charters/reviewer.json`: wave 6 owns the reviewer's move and the charter's retirement.
- `packages/domain/src/rules/role-command.ts`, unless `RoleAgentRef.settingsFile` has to become optional; if it does, that is the only edit there.
- `.claude/agents/*.md` and `.claude/settings/*.json`: the files themselves do not change.

Checked against `origin/main` just now: no unmerged remote `feature/`, `bug/` or `infra/` branch changes `repair-role.ts`, `auto-fixer.ts`, `registryd-main.ts`, `role-command.ts`, `review.ts` or a `role-files` file, so no collision is known. `feature/the-release-review-is-switched-on` (#3175, `review.ts`) and wave 6 edit the reviewer side only.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
