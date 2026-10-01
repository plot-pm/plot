## Implementation brief — plot-keeps-its-files-inside-the-repository (wave 1: The desk root is one rule)

- **Plan (canonical):** `docs/plans/2026-10-01-plot-keeps-its-files-inside-the-repository.md` on `main`
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-desk-root-is-one-rule` (base: `main`). The remote ref exists and points at `a29ac9e9`, the approval commit, with no work on it.
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

Wave 2, `bug/action-records-move-into-the-repository`, waits on this branch. It owns the once-only migration of existing action records and its fixture test.

### What to build

With no `Worktree root` configured, Plot writes dispatch worktrees (`plot-wt-*`) and action records (`plot-<kind>-<id>.log`, `.state`) into the checkout's parent, a directory the repository does not own. Nine places compute the root, and they disagree on the default: seven use the parent and two use `.worktrees`. Found while fixing #1126: fixture repositories created directly in `TMPDIR` received the board's records in `TMPDIR` itself.

The fix is one domain rule, `deskRoot`, in `packages/domain/src/rules/desk-root.ts`, with these rows:

| Configured | Answer |
|---|---|
| absent or empty | `<repo>/.worktrees` |
| absolute | that path |
| relative | resolved against `<repo>` |

`agentLogDir` (`packages/board/src/server/agent-log.ts:171`) calls it. Every shell site asks it through one new bundle, `skills/plot/scripts/board/plot-desk-root.mjs`. The branch also writes the Concept file `docs/domain/desk-root.md`, adds the ignore line, and adds the tests. The plan is canonical. This brief is orientation.

### The sites, verified on `origin/main` 2026-10-01

The line numbers in the plan have moved in one script. The current sites:

| Script | Line | Today's default | Notes |
|---|---|---|---|
| `plot-approve.sh` | 131 | `$repo_root/..` | `wt_root`, unconditional; reads no key at all |
| `plot-deliver.sh` | 84 | `$repo_root/..` | the same |
| `plot-dispatch.sh` | 241 (`resolve_wt_root`) | `$rr/..`, prefix `plot-wt-` | the creation side |
| `plot-dispatch.sh` | 2434 (`--migrate`) | refuses: "nothing to migrate" | see the `--migrate` paragraph below |
| `plot-fleetctl.sh` | 580–582 (`resolve_wt_root`) | `$repo_root/..`, prefix `plot-wt-` | a copy of the dispatch function |
| `plot-resolve-artifact.sh` | 189–191 | `$repo_root/..`, prefix `plot-wt-` | composes a fresh desk path |
| `plot-reap.sh` | 417–428 (`LOG_DIR`) | `$ROOT/..` | where the sweep deletes logs |
| `plot-reap.sh` | 457+ (`WT_ROOT`) | empty | where a desk must sit to be a candidate |
| `plot-reconcile-scan.sh` | 2569 (`desk_root`) | empty | section 21 |
| `plot-board-probe.sh` | 189–190 | `".worktrees"` | the pruned name in a `find` |
| `plot-quiet-stretch.sh` | 92 | `".worktrees"` | |

**The `Done when` grep is narrower than these sites.** `git grep -nE 'repo_root/\.\.|"\.worktrees"'` does not match `$rr/..` in `plot-dispatch.sh` or `$ROOT/..` in `plot-reap.sh`. A branch can pass that grep and still keep two private defaults. Use the grep as a floor, and also run `git grep -nE '/\.\.\"? *&& *pwd|/\.\.\)' skills/plot/scripts/*.sh` and read every `Worktree root` read: `git grep -n '"Worktree root"' skills/plot/scripts/`.

### Decisions the plan settles — do not re-derive them

**The default is `.worktrees`, not the parent.** `/plot-init` already writes `Worktree root: .worktrees` (`composeAdoption`, `packages/domain/src/rules/adoption.ts:513`), and both probes already assume it. The comment above `agentLogDir` reads *"THE FALLBACK IS TODAY'S LOCATION, NOT AN ERROR … creating one because a log needs somewhere to go invents a directory nobody asked for"*. The plan reverses that decision. Rewrite the comment to state the new rule. Do not keep the old argument beside it.

**The domain takes readings, not a filesystem.** `deskRoot` takes the configured value and the repository root as strings and returns a path. It calls no `fs` and no `git`. The directory does not need to exist. This is the same string work `agentLogDir` does today with `path.resolve`. The rule module imports `node:path` only if the purity gate permits it. Outside `adapters/` the domain may import `zod` and nothing else (`ci.yml`, purity gate). If `node:path` is refused, compose with string operations, as the shell does (`${root%/}`).

**The repository root is the MAIN checkout, for every caller.** `plot-reap.sh:440–447` records the measurement: on 2026-09-10, `git rev-parse --show-toplevel` from inside a desk resolved `.worktrees` beneath that desk, so every tree read as unplaceable. With `.worktrees` as the default, that failure applies to every caller and not only to the reaper. `plot-approve.sh`, `plot-deliver.sh` and `plot-fleetctl.sh` use `--show-toplevel` today. Each caller passes `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` as the root, with `--show-toplevel` as the fallback only where git cannot answer. `plot-quiet-stretch.sh:80–90` already does this; copy its form. On the board side, `agentLogDir`'s `repoRoot` is already the served checkout.

**One bundle, per *A Shell Script Asks The Domain*.** Every caller runs once per operator command, so the bundle's ~39 ms start-up is the permitted cost (`docs/shell-and-domain.md`). Follow `packages/board/src/server/entry/free-agent-command.ts`: import through the narrow path (`@plot-pm/domain/rules/desk-root`, which `./rules/*` in `packages/domain/package.json` already exports), export `run` and `EXIT`, run only when invoked directly, and use the `pathToFileURL(realpathSync(...))` guard. Register it in `packages/board/build.mjs`. Each `const …Artifact` / `const shipped…` declaration stays on ONE LINE, because the bundle-set derivation at the top of that file matches line by line (`build.mjs:84–107`). Add `skills/plot/scripts/board/plot-desk-root.mjs -merge` to `.gitattributes`, which `scripts/check-bundle-attributes.sh` checks. Commit the built bundle, and add a row for it to the Helper Scripts table in `CLAUDE.md`.

**No script keeps a fallback default.** If the bundle cannot answer (no `node`, a missing file), the script stops with the reason. It does not compute the parent itself. A silent fallback is a second default, and two defaults are the defect this plan fixes.

**The `plot-wt-` prefix goes with the parent default.** Under the new default the answer is the relative-path row, so a new desk is `.worktrees/<branch-with-dashes>` with no prefix, the same as a configured `.worktrees` today. Existing `plot-wt-*` desks stay where they are, because every reader that asks *which worktree holds this branch* asks `git worktree list` (THE HELD-BRANCH GATE in `plot-dispatch.sh`). Keep the reaper's legacy `plot-wt-` path recognition (`plot-reap.sh:97–99`). It is how those desks are reaped after this change.

**`plot-reap.sh` `LOG_DIR` follows the rule.** The comment at `:448–452` keeps `LOG_DIR` on `$ROOT` because *"changing where a sweep DELETES from is a blast radius"*. After this change the board writes logs into the desk root, so a sweep that reads the parent sweeps nothing Plot writes. `LOG_DIR` becomes `deskRoot` of the main checkout. The sweep's filename filter is unchanged, so the blast radius stays the set of `plot-<kind>-*` names.

**`WT_ROOT` and `desk_root` stop being empty.** Both are empty when the key is absent today, so that the parent, which holds a person's sibling checkouts, never counts as a desk root. The new default is `<repo>/.worktrees`, which Plot owns, so that argument no longer applies. Both take the bundle's answer. A sibling checkout in the parent is still not under the desk root, so it stays silent, as section 21 requires.

**`plot-dispatch.sh --migrate` is out of scope except for its text.** The plan says *"It does not move live worktrees."* `--migrate` is the operator's explicit command to move them. Keep its behaviour when the key is absent. Correct the two `echo` lines at `:2437–2438`, which will claim that worktrees live beside the repo. If you find that `--migrate` needs a behaviour change to stay consistent, report it in the PR. Do not change it.

**The ignore line goes into the COMMON git dir.** When the answer lies inside the repository and `git check-ignore -q <path>` says it is not ignored, the caller that creates the directory appends the repo-relative path (`/.worktrees/`) to `$(git rev-parse --git-common-dir)/info/exclude`. Git reads `info/exclude` from the common dir only, so a linked worktree's private gitdir is the wrong place. The write is idempotent: append only when the line is absent. Two callers create the directory: the dispatch desk creation in `plot-dispatch.sh` and the board's first log write through `agentLogDir`. Both must add the line, because the `Done when` check reads `git status --porcelain` after a dispatch and the board writes a log during that dispatch. Put the shell half in one function that both shell creators source or call. Do not write it twice. The domain may answer *is this path inside the repo, and what is its repo-relative form*. The file write is an adapter's or the script's.

**`migrateAgentLogs` is wave 2's.** Changing `agentLogDir` makes `dest !== src` true for an unconfigured repository, so the existing migration starts to move files from the parent with no code change. That is the plan's design. Do not edit `migrateAgentLogs` or add the parent-to-`.worktrees` migration fixture test, because `bug/action-records-move-into-the-repository` owns both. Keep the existing migration tests (`agent-log.test.ts:259+`) green.

**The Concept file is the first in `docs/domain/`.** The directory does not exist on `main`. The format is in `docs/superpowers/specs/2026-10-01-the-domain-grows-with-every-change-design.md:34–45`:

```
# Desk root
The directory under which Plot creates dispatch worktrees and writes its action records.
- Layer: Domain
- Concept status: implemented
```

Then a **Terms** list (*desk*: a dispatch worktree; *action record*: `plot-<kind>-<id>.log` and `.state`), then the rule table. Tag the rule module's top TSDoc with `@concept desk-root`. Gate B (`check-concepts`) is not built, so no gate checks this today. Write it as if the gate existed. Do not create `docs/domain/README.md`: the glossary plan owns it.

**Carried over unchanged:** absent is not false: an empty `Worktree root` value is the absent row, not a relative path `""`. Read the exit code, not stdout's emptiness, when a script asks the bundle. TSDoc in `packages/domain/` states what the export does and does not narrate history (CLAUDE.md, *The Domain Package*). The reasoning goes into the commit message. Use arrow functions.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive change passes without them:

- **A unit test per table row, plus the empty string.** `''` must give `<repo>/.worktrees`. A test for "absent" alone passes an implementation that treats `''` as relative and returns `<repo>`.
- **A trailing slash.** `.worktrees/` and `/abs/dir/` give no trailing slash. Composed desk paths double it otherwise.
- **The dispatch fixture checks the parent's listing before and after,** not only that `<repo>/.worktrees/<desk>` exists. A dispatch can create the new desk and still drop a `.log` or `.state` file in the parent, and the existence check alone misses that.
- **`git status --porcelain` is read in the fixture repository after the dispatch and after a board log write.** Testing the dispatch alone misses the board creating `.worktrees/` first.
- **A run from inside a desk.** One script test (the reaper or the scan is enough) runs from a linked worktree with no key configured and resolves the MAIN checkout's `.worktrees`, not `<desk>/.worktrees`. Without it, the `--show-toplevel` regression returns unseen.
- **The existing tests that assert the parent default flip, and none is deleted.** Expect changes in `packages/board/test/unit/agent-log.test.ts:84,198` and in `test/reconcile/{dispatch,fleetctl,migrate,reap-log,reap-detached-desk,desk-finding,scan,boardprobe,init-worktree-root}.test.mjs`. Rewrite each assertion to the new answer. A test that asserted `plot-wt-` beside the repo with no key becomes a test of the new location. The guard test at `agent-log.test.ts:120` (*"no module outside agent-log.ts resolves the parent directory itself"*) stays and must still pass.
- **`pnpm run test:board` leaves zero entries in its root** with the fixture repositories unchanged. Do not move fixtures out of `TMPDIR` to make this pass.

Plus the repo gates: `nvm use` (Node 24, or `corepack pnpm` if homebrew pnpm crashes), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds the artifact), `pnpm run typecheck`, `./scripts/check-bundle-attributes.sh`, `./scripts/check-temp-paths.sh`, and `./scripts/check-changeset-packages.sh`. Do not run `pnpm run test:e2e` locally: it is CI's gate. Add a changeset with the description first and the `bumps:` block last. It names `'plot': patch` and `@plot-pm/board`, plus `plan: docs/plans/2026-10-01-plot-keeps-its-files-inside-the-repository.md`. Copy the format from git history if `.changeset/` holds only siblings' files. Commit the rebuilt `board-server.mjs` and the new bundle.

### Bookkeeping

- Push the first real commit as soon as it exists. The ref is a claim with no work on it.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append it inside this slice's heading in the plan's `## Slices`, in the form `(Branch: bug/the-desk-root-is-one-rule, PR: #N)`. The trailing `→ #N` form parses as no PR for a heading-annotated plan. Make this edit on `main` from a detached scratch worktree, not in the shared main checkout.
- **`plot-controller-gate.sh` refuses any Bash command whose text names `plot-dispatch.sh`**, even a `git show` or a `sed -n` that only reads the file. Read and edit that file with the Read and Edit tools, or build the name from parts in the shell (`D="plot-dis""patch.sh"`). Tests that run it through `node --test` are not affected.

### Scope guard

This branch owns:

- `packages/domain/src/rules/desk-root.ts` and its unit test
- `docs/domain/desk-root.md`
- `packages/board/src/server/entry/desk-root.ts`, its `build.mjs` registration, the shipped `skills/plot/scripts/board/plot-desk-root.mjs`, and its `.gitattributes` line
- `agentLogDir` and its comment in `packages/board/src/server/agent-log.ts`, but not `migrateAgentLogs`
- the root resolution in the nine scripts in the table, and the ignore-line helper
- the test rewrites listed above, the `CLAUDE.md` Helper Scripts row, and the changeset

Other branches in flight, checked on 2026-10-01:

- `bug/start-works-by-default` (PR #1129, open) changes `packages/board/build.mjs` around line 852 (it renames the free-agent-command bundle to `plot-start-command.mjs`) and `plot-dispatch.sh` at hunks 14, 1024, 1086–1156, 1450, 2263 and 2305. It does not change `resolve_wt_root` (`:228–260`) or `--migrate` (`:2428+`). Add the new bundle's block to `build.mjs` away from line 852, for example at the end of the bundle section, so a merge of either PR does not conflict on the other. If #1129 merges first, rebase onto it before you push.
- `bug/action-records-move-into-the-repository` (wave 2) has no ref yet. It owns `migrateAgentLogs` and its fixture.

If you find something the plan did not anticipate, report it in the PR rather than improvising outside scope.
