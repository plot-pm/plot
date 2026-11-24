## Implementation brief — fleetctl-runs-in-a-submodule-checkout (wave 1: Shell root)

- **Plan (canonical):** docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-repo-root-reads-core-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review, `Review: pr`)

Wave 2 (`bug/the-state-home-reads-core-worktree`) builds the domain rule `mainCheckoutOf` and a corpus test that compares it with `plot_repo_root`. It waits on this branch. Leave the domain and the two TypeScript adapters to it.

### What to build

Issue #3043: in a submodule's working tree `<workspace>/app/web`, `plot-fleetctl.sh --status` exits 3 with "not part of the estate at `<workspace>/.git/modules/app`". `plot_repo_root` (`skills/plot/scripts/plot-desk-root.sh`) takes `dirname` of `git rev-parse --git-common-dir`. In a submodule the common dir is `<workspace>/.git/modules/app/web`, so the root becomes `<workspace>/.git/modules/app`. The check in `resolve_wt_root` (`plot-fleetctl.sh`, about line 718) then compares that path with `--show-toplevel` and refuses the real checkout.

Change `plot_repo_root` so that, where the common dir's last segment is not `.git`, it reads `git --git-dir=<common> config --get core.worktree` and resolves the answer against the common dir. `core.worktree` is relative to the common dir in a submodule (`../../../../app/web`) and may be absolute, so handle both. Resolve with `cd -- "$common/$wt" && pwd -P`: the root stays physical, as the comment above the function requires. When `core.worktree` is unset, keep today's `dirname` answer. A normal checkout (last segment `.git`) must spawn no extra process: `plot-worker-state.sh` sources this file in every per-desk probe.

Add the arm only. `plot-fleetctl.sh`, `plot_desk_root` and the bundle `plot-desk-root.mjs` should need no edit once `plot_repo_root` answers right. If the fixture shows otherwise, report it.

### Decisions the plan settles — do not re-derive them

- **The shell duplicates the rule, and declares it.** `plot_repo_root` runs once per agent per pass, so per *A Shell Script Asks The Domain* it does not call the domain bundle. A node start costs 34 ms and a bundle call 39 ms, paid per desk probe. Do not route it through `node`.
- **`plot_given_common_dir` needs no change.** A submodule's `.git` file names `../../.git/modules/app/web`, which is not under `worktrees/`. The exported answer is refused and git is asked, as today. Do not widen that check.
- **Nothing in the repo resolves a submodule checkout today.** `plot-deliverable-search.sh "submodule"` found only tree-mode and blob-kind code. Do not look for an existing helper to reuse.
- **Absent is not false.** A failed `git config` read, or an unset key, means "use the `dirname` answer", never an empty root. Read the exit code, not the emptiness.

### Open questions the plan hands to this slice

- `[question-other-readers]` Nine shell scripts read `--git-common-dir`. List each one's use in the PR body. A reader that derives a checkout path from the common dir moves to `plot_repo_root`. A reader that only locates a file under the common dir stays. Do not rewrite a reader whose answer is not a checkout path.
- `[question-host-env]` Issue #3043 says `plot-host.sh` looks for its fallback `.env` in the wrong place. Fix it only where `plot-host.sh` derives that path from the common dir. Otherwise name it in the PR body for a separate issue.
- `[question-test-fixture]` Build a real submodule fixture in `test/reconcile/desk-root.test.mjs`: `git -c protocol.file.allow=always submodule add`, inside a `mkdtempSync` root, removed by the exact name `mkdtempSync` returned. A bare `git init` fake does not exercise `core.worktree`.

### Done when

The plan's `## Done when` list is the specification, here the slice's `tests:` annotation:

- `desk-root.test.mjs`: in the submodule fixture, `plot_repo_root` prints the submodule's working tree (physical path) and `plot_desk_root` prints a path under it. This catches an arm that answers the `.git/modules/...` parent.
- `fleetctl.test.mjs`: `--status` run in the fixture does not print "not part of the estate". This catches a root fix that leaves the `resolve_wt_root` comparison failing on a logical-versus-physical path difference (`/tmp` against `/private/tmp` on macOS).
- A normal checkout and a linked desk answer as before. Assert both in the same test file: they catch an arm that fires where the common dir ends in `.git`.
- A relative and an absolute `core.worktree` both resolve. This catches an arm that only handles git's relative form.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds lines to `plot-desk-root.sh`, so pay for them in the same change: remove an equal number of commands from that file's comments-free code or from another script. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. The `core.worktree` arm may also move a script from the nine readers onto `plot_repo_root`, which removes its own derivation: count that first.

Add a changeset (`plot` package, patch) with the description first and the `bumps:` block last. Name the plan on a `plan:` line inside the block.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-desk-root.sh`, `test/reconcile/desk-root.test.mjs`, `test/reconcile/fleetctl.test.mjs`, the changeset, and any of the nine readers that the open question moves. It does not touch `packages/domain/**`, `packages/**/adapters/**` or `docs/plans/**` except the `→ #<number>` line. `bug/the-state-home-reads-core-worktree` holds those and starts after this wave merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
