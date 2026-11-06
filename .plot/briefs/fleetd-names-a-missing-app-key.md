## Implementation brief — app-keys-resolve-from-one-folder (wave 2: Probe)

- **Plan (canonical):** `docs/plans/2026-11-06-app-keys-resolve-from-one-folder.md` on `main`
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3202 merged
- **Branch:** `feature/fleetd-names-a-missing-app-key` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The Resolver slice this waits on merged as #3203 (2026-11-06 17:27 UTC), so `appKeyPath` and the id-only line are on `main`. The sibling `infra/plot-config-names-app-ids-only` (the `CLAUDE.md` lines) waits on the Resolver only, not on this branch; the two share no file.

### What to build

On 2026-11-06 #3196 named a `Merger app` key path that did not exist yet. Every merge through the merger app then refused `host-refused` for about 30 minutes, and the first sign was a refused merge, not a log line. The fix in this slice: fleetd and the board each check the declared App keys once, when they start, and log one line per key that is missing or unreadable, naming the path the resolver tried.

Build on what exists:

- `mergerAppShell(context)` in `packages/domain/src/adapters/merger-app/merger-app-shell.ts` runs `plot-merger-token.mjs --check`. Exit 0 reads `usable`, 4 reads `invalid` with the script's stderr as `reason` (that reason names the key path), 5 reads `absent`, anything else reads `unread`. `--check` mints no token and makes no network call, so the probe costs one `node` start per key and no API budget.
- fleetd's start is `run()` in `packages/fleet/src/server/entry/registryd-main.ts`, which writes `fleetd-start.json` at the top and reports a failure through `warn`. The probe goes there, once, before the tick loop. `run()` takes `warn` and `seams`, which is how its tests observe it.
- The board's start is the `server.listen(...)` callback in `packages/board/src/server/index.ts`, which logs with `console.log` and `console.warn`.

The log line is one line per key, with the config key, the reading and the path. It is a pure function in the domain (`readings → string[]`), so the wording and the "which readings log nothing" rule are unit-tested with no daemon and no browser. Both entry points call it and write what it returns.

### Decisions the plan settles — do not re-derive them

**Log only. The probe holds nothing.** The plan's one open question proposes this, and the reason is measured: `merger-app-missing` and `merger-app-invalid` already hold every row (`docs/review-status-rollout.md:150`), so a hold on top adds no safety and makes fleetd stop merging on a key a person can fix in one minute. Do not add a refusal, an exit code or a held state. Do not touch `auto-merge.ts`; it already logs each hold once per PR (`auto-writes.ts:61`), and a second line from the probe at start is the intended addition, not a duplicate to remove.

**Once at start, not per tick.** A per-tick read is one `node` spawn per key per tick for a state that changes when a person moves a file. The plan wants the warning at the moment an operator is watching the start.

**An undeclared key logs nothing.** `absent` (exit 5) means `plot-config.sh` ran and the line is not there. This repository declares `Review app` and `Merger app` and has no `Writer app` line, so a probe that logs for `absent` prints a false alarm on every start. Absent is not missing.

**A key through the adapter, not a new `spawn`.** The CI ratchet *One place reaches a process* counts direct `spawn`/`execFile` sites outside `packages/domain/src/adapters/`: 19 against `allowed=28`, measured 2026-09-07. A new call from fleetd or the board raises it. Reach the script only from an adapter implementation (the layering rule), and have the controllers call the domain.

### The point the plan's wording hides

The plan says "every declared App key ... through the existing `merger-app-shell.ts` adapter and its `plot-merger-token.mjs` call". That call checks the `Merger app` only, and also the same-id-as-Writer rule. Nothing today checks `Review app` or `Writer app` without minting a token or signing a JWT. So the existing call covers one of the three keys, and this repository's `Review app` key, the one `plot-review.mjs` needs, is the one with no check.

Pick one and say which in the PR body:

1. **Add a check mode for the other two keys** that calls `resolveApp(configKey, here)` and exits 0, 4 or 5 on the same contract as `--check`, and read it through the same adapter. Recommended: the reader stays one function and the three keys read alike.
2. **Probe the Merger app only**, and name the Review and Writer keys as not covered in the PR body and the plan.

Whichever you pick, `plot-merger-token.mjs` keeps its current call shapes and exit codes. `mergerAppShell` and `auto-merge.ts` depend on them, and `packages/domain/test/merger-app-shell.test.ts` is the test that must stay green. A new check goes in a new mode or file, not in a changed exit code.

Note the Review app's trust anchor: `plot-review-writer.mjs` reads `Review app` from `origin/<default>`, not the working tree, so a desk cannot choose its own review login. `resolveApp` reads the working tree. The probe is diagnostic and holds nothing, so reading the working tree is correct here. Do not "fix" `plot-review-writer.mjs` to match, and do not make `resolveApp` read git.

### Rules carried over unchanged

- **Absent is not false; read the exit code, not the emptiness.** A check that did not answer (`unread`) is not `usable`. Log it as a check that did not answer, never as a usable key and never as nothing; a silent probe is the failure this slice exists to remove.
- **No credential in the line.** Log the config key, the reading and the path. Never the key's contents, a JWT or a token.
- **The probe never stops the start.** A throw or a hung `node` spawn in the probe does not stop fleetd from ticking or the board from serving. Catch it, log that the probe failed, go on. Same shape as the `fleetd-start.json` write.
- **The board's ready line does not wait for the probe.** The probe runs after `listen` binds. `mergerAppShell` uses `execFileSync`; run it after the ready line prints, not before.
- **The domain style.** Arrow functions, TSDoc that states what a function returns and how it fails, no history in comments. The reasoning belongs in the commit message.

### Done when

The plan's `## Done when` list is the specification. The plan has none, so these are it: fleetd logs one line per missing or unreadable key at start, the board does the same, the line names the path, and a usable or undeclared key logs nothing. Assertions that exist because a naive implementation would pass without them:

- **Id-only line, key present in the folder, logs nothing.** Use a scratch repository whose `CLAUDE.md` declares `Merger app: <id>` with no path, and put the key at `$XDG_CONFIG_HOME/plot/plot-merger.<id>.private-key.pem` with `XDG_CONFIG_HOME` pointing into a scratch directory. A probe that reads the path from the config line alone logs a false alarm here. Never point a test at the real `~/.config`.
- **Id-only line, key absent, logs the folder path.** The line names `.../plot/plot-merger.<id>.private-key.pem`, not an empty or generic message.
- **Undeclared key logs nothing.** A repository with no `Merger app` line produces no output. A probe that logs for `absent` passes the other cases and fails this one.
- **A refused probe does not stop the start.** Make the reader throw and assert fleetd still ticks and the board still serves.
- **One line, once.** Run two ticks and assert the probe line appears once.
- **A test per daemon**, as the plan says. `packages/board/src/server/index.ts` is a top-level script with no function to call, so extract the start probe into a module the entry calls, and test that module with an injected reader and logger. Add one assertion that the entry calls it.

Plus the repo's gates. Add a changeset for package `plot` with the description first and the `bumps:` block last (`plot: patch`; the probe adds a log line and no capability the operator drives, and the changeset package must be `plot` or `@plot-pm/board`). Run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice needs no `.sh` edit. If you touch one, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

`scripts/check-no-bundle-diff.sh` refuses a committed generated bundle. `packages/board/**` and `packages/fleet/**` build into `skills/plot/scripts/board/*.mjs`; run `pnpm build:board` only to test locally, then restore every generated path from `origin/main` before you push.

### Bookkeeping

Push the first real commit as soon as it exists. When the PR is open (`../plot/scripts/plot-open-pr.sh`, never `gh pr create`), append `→ #<number>` to this branch's line under `### Probe` in the plan's `## Slices` section.

### Scope guard

This branch owns the start probe in `packages/fleet/src/server/entry/registryd-main.ts`, the start-up call in `packages/board/src/server/index.ts` and the module it extracts, one pure rule and one reader under `packages/domain/src/` (the reader in `adapters/merger-app/`), their tests under `packages/*/test/`, and one changeset.

It does not own `skills/plot/scripts/plot-github-app.mjs` or `plot-review-writer.mjs` (Resolver, merged), `CLAUDE.md` or `AGENTS.md` (Config slice), `auto-merge.ts`, or the existing exit codes of `plot-merger-token.mjs`.

In flight at dispatch (verified 2026-11-06 against open PRs): #3204 `sprint/card-alignment`, #3198 `feature/one-card-grammar-plans`. Neither names these files. The Config slice has no branch or PR yet and edits `CLAUDE.md` and `AGENTS.md` only.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
