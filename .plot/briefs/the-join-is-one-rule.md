## Implementation brief — a-desk-and-its-manifest-name-each-other (slice 1: The join is one rule)

- **Plan (canonical):** `docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-join-is-one-rule` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a person reading the diff)
- **Issue:** #1086

This slice waits on nothing. Slices 2 (`bug/the-monitor-follows-the-hop`), 3 (`bug/a-continued-loop-carries-its-manifest`) and 4 (`bug/a-desk-with-no-manifest-says-so`) all wait on it, because each adds an export to `rules/desk-manifest.ts`, and slice 4 edits `registry.ts` again. Keep the module's shape easy to extend, and do not add `watchedDesk`, `loopRegistration` or `unnamedDeskLabel` here.

### What to build

The join from a desk to the manifest that names it has four implementations, and they disagree (the plan's table under `## Motivation`). The shell one is wrong: `plot_manifest_for_worktree` (`skills/plot/scripts/plot-worker-state.sh:121`) derives the manifest directory as `git -C "$wt" rev-parse --show-toplevel`/.plot/agents (`:132`). Called from a dispatched desk, `--show-toplevel` answers the DESK, not the main checkout, so the function finds no manifest; the comment at `:129-131` claims the opposite. It also ignores the `Agent registry` key. Its callers are `plot_worker_state` (`:801`) and the liveness reading (`:1008`), so every worker-state reading from inside a desk, or under a configured registry, reads the agent as unregistered. `plot-worker-monitor.sh:265-267` already avoids the function and names #1086 as the reason.

Build `packages/domain/src/rules/desk-manifest.ts` with two exports, `manifestDirectory` and `deskManifest`, and make every reader ask it:

- the shell function resolves the main checkout through `--git-common-dir` and reads `Agent registry`;
- `registry.ts`'s claimed set (`:805-833`) asks `deskManifest`;
- `manifestForWorktree` (`manifest-stamp.ts:201`) collects `{ path, worktree }` readings and asks the rule;
- `supervisor.ts:151-156` stops matching on the raw path alone;
- `joinManifestDir` (`registry.ts:417`) is removed, and `resolveManifestDir` / `resolveManifestDirAsync` call `manifestDirectory`.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The shell keeps a declared duplicate; it does not call a bundle.** `plot_manifest_for_worktree` runs per worktree per fleet-scan pass. *A Shell Script Asks The Domain* (`docs/shell-and-domain.md`) puts per-pass work on the duplicate side: a bundle answers in about 39 ms, and that cost is paid per desk on every pass. So the shell stays shell, and `packages/domain/corpus/desk-manifest.corpus.test.ts` holds the pair. Model it on `packages/domain/corpus/desk-reset.corpus.test.ts`: a CONSTRUCTED corpus of desks in temp repos, because CI's checkout has one clean worktree and a live corpus can only pass. On a disagreement the branch stops; adjusting either side to make the comparison pass is the one forbidden move.

**No new `plot-*.sh` script.** The shell side stays inside `plot-worker-state.sh`.

**`several` is its own answer.** `deskManifest` answers `named` (exactly one), `unnamed` (none) or `several` (more than one). Two manifests on one desk is an estate defect, and a first-match loop hides it. Every caller in this slice reads `several` as "no manifest". The shell function must agree: return non-zero for `several`, not the first match. Today it returns the first match, and so does `manifestForWorktree`.

**The domain takes readings as values.** `deskManifest({ desk, deskReal, manifests })` reads no filesystem. The caller computes `deskReal` and reads the manifests. Arrow functions, factual TSDoc, `zod` as the only import (the purity gate in `ci.yml`). 100% branch coverage in `packages/domain/test/desk-manifest.test.ts`.

**The main checkout comes from `--git-common-dir`.** `plot_repo_root` (`plot-desk-root.sh:38-46`) already makes this reading: the parent of the common dir, physical, with `--show-toplevel` only as the fallback.

**Rules carried over from related work:**

- Absent is not false. A missing directory, an unreadable manifest or a desk that is gone answers `unnamed`, never a crash and never a guess.
- A manifest records the RESOLVED worktree path (`realpath`), and git may report either form. Every reader matches both.
- `Agent registry` may be absolute (taken as given) or relative (joined to the MAIN checkout, never to a desk), and empty means `.plot/agents`. `CLAUDE.md` gives the reason for `Board artifact` and `Agent settings`: a desk must resolve the same file as the checkout.

### Traps the plan does not name

**1. A cache set inside `$(…)` never reaches the caller.** The plan says to read `Agent registry` once per process and cache it in `PLOT_MANIFEST_DIR`. Both callers invoke the function as `manifest=$(plot_manifest_for_worktree …)`, so an assignment inside the function dies with the subshell, and the cache never fills. Resolve the directory at source time or in a helper that the callers run outside a command substitution. Keep a caller-set `PLOT_MANIFEST_DIR` first: tests and the dispatcher set it.

**2. `git -C "$wt" rev-parse --git-common-dir` may print a RELATIVE path.** In a linked worktree it prints an absolute path. In the main checkout it prints `.git`, relative to `$wt`. `plot_repo_root` cannot be reused as it stands, because it asks git in the current directory. Resolve the path with `cd "$wt" && cd "$common" && pwd -P`, or let `plot_repo_root` take a directory. Cover both cases in the corpus, from the main checkout and from inside a desk.

**3. The plan's `{ path, worktree }` reading cannot pass its own supervisor test.** The test registers a desk by its SYMLINKED path and asserts that the REAL path reads `registered: true`. Then `manifest.worktree` is the symlink path, `desk` and `deskReal` are both the real path, and nothing matches. The manifest side needs its realpath too: the reader resolves each manifest's `worktree` and passes it (for example an optional `worktreeReal`), and the rule matches either form against either form. The shell has the same asymmetry (`wt_field == wt || wt_field == real`), so change both sides together and give the corpus a symlink fixture. State this amendment to the plan's signature in the PR body.

**4. A fifth directory resolver exists, and it is out of scope.** `agent_registry_dir` (`plot-dispatch.sh:445-453`) resolves `Agent registry` for the writer side and trims a trailing slash; `path.join` normalises one. Do not edit `plot-dispatch.sh` in this slice, because slice 2 edits the wrapper there. Give `manifestDirectory` a trailing-slash fixture so that the TS answer and the dispatcher's answer do not differ, and name the dispatcher resolver in the PR as a follow-up.

### Done when

The plan's `## Done when` list is the specification. This slice's tests must FAIL on `origin/main` and PASS on the branch. Run each one against main before claiming it.

- **`test/reconcile/workerstate.test.mjs`, desk case:** source `plot-worker-state.sh` from inside a linked worktree, with `PLOT_MANIFEST_DIR` unset and the manifest in the MAIN checkout's `.plot/agents/`, and assert `plot_manifest_for_worktree` prints that manifest. This case catches the `--show-toplevel` bug. It only fails on main if the test really runs from inside the linked worktree: the `cd` must happen before the `source`, not in a `git -C` you add.
- **Same file, registry case:** set `Agent registry` to an absolute directory and assert the same. This catches the ignored key. The registry must lie outside both checkouts, or a fallback can pass it by accident.
- **Supervisor unit case:** register a desk by its symlinked path and assert the real path reads `registered: true`. The existing `registered` cases are in `packages/board/test/unit/registryd-tick.test.ts` and `a-desk-says-who-owes-it.test.ts`. On macOS, `/tmp` against `/private/tmp` gives a symlink for free, but CI runs Linux, so create an explicit symlink.
- **`packages/domain/test/desk-manifest.test.ts`:** 100% branch coverage, including `several`, an empty `manifests`, a manifest with no `worktree`, and an empty or relative `configured`.
- **`desk-manifest.corpus.test.ts`:** path match, realpath match, symlink, none, several, configured absolute, configured relative, a call from inside a desk, and a call from the main checkout. A disagreement names both answers and the subject.
- `grep -n 'show-toplevel' skills/plot/scripts/plot-worker-state.sh` finds no manifest-directory derivation. The wrong comment at `:129-131` goes as well.

Plus the repo gates: `nvm use` (Node 24, because pnpm crashes on 26), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (which rebuilds `board-server.mjs`; commit the rebuilt artifact) and `pnpm run typecheck`. Do NOT run `pnpm run test:e2e`; it is CI's gate. Write two changesets with the description first and any `bumps:` block last: `'@plot-pm/board': patch`, and `'plot': patch` with `bumps: skills: plot: patch`, because `plot-worker-state.sh` changes. Both may carry `plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md`. Run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

- Claim the branch by pushing it before any work, if the dispatcher has not done so already. Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work continues). Do not use `gh pr create`.
- When the PR exists, append ` → #<number>` inside this slice's heading in the plan's `## Slices` (`(Branch: bug/the-join-is-one-rule, PR: #N)` is the form waved plans parse), through a scratch worktree on `origin/main`.
- Do not `git add -A` after a suite run: board tests rewrite the tracked `tiny-garden/.plot/state` fixture.

### Scope guard

This branch owns:

- `packages/domain/src/rules/desk-manifest.ts` (new, two exports only), `packages/domain/test/desk-manifest.test.ts`, `packages/domain/corpus/desk-manifest.corpus.test.ts`
- `skills/plot/scripts/plot-worker-state.sh` (`plot_manifest_for_worktree` and its directory resolution only)
- `packages/board/src/server/registry.ts` (`joinManifestDir`, the resolvers and the claimed set; NOT `synthesizeEntry`, which belongs to slice 4)
- `packages/board/src/server/manifest-stamp.ts` (`manifestForWorktree`)
- `packages/board/src/server/supervisor.ts` (the `registered` set)
- the tests named above, two changesets, and the rebuilt board artifact

Not this branch: `continue.ts` (slice 3), `plot-dispatch.sh`, `plot-agent-monitor.sh`, `plot-build-monitor.sh` and `plot-worker-monitor.sh` (slice 2 and #1041's `bug/the-loop-reports-idle`), `plot-worker-loop.sh` (slice 3), and `synthesizeEntry` / `AgentEntrySchema` (slice 4).

Verified at brief time (2026-10-02, `origin/main` at `6751c6ab`): no other remote branch changes `plot-worker-state.sh`, `registry.ts`, `manifest-stamp.ts`, `supervisor.ts`, `plot-desk-root.sh` or `workerstate.test.mjs`. Recent changes on main to these files: #1130 (`f8c6556d`), #1073 (`400299fc`). Rebase before you open the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
