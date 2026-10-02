## Implementation brief — a-branch-carries-no-built-bundle (slice 1: Main builds its bundles)

- **Plan (canonical):** `docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/main-builds-its-bundles` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This slice comes first. `bug/a-pr-carries-no-bundle` waits on it, and `bug/the-artifact-repair-is-retired` waits on that one.

### What to build

After each push to `main`, a workflow builds the 34 generated bundles and pushes them to `main` as a GitHub App. Today every PR commits its own build, so each merge makes every other open PR conflict. Measured 2026-10-02: after #1185 merged, all 10 open PRs read DIRTY, and 9 conflicted only in bundles. A merge train (#1188) was the only way seven green PRs landed.

This slice builds only the main-side producer. PRs keep committing bundles until slice 2, so **this slice is safe alone**: `main` is already fresh after each merge, and the workflow finds nothing to push.

Four parts, all in the plan's Design section 1:

- **A new workflow on `push` to `main`**, in a `concurrency` group with `cancel-in-progress: true`. It runs `pnpm build:board`. If the generated paths differ from `HEAD`, it commits them as `plot: build the board artifact` and pushes to `main` with an installation token of the App.
- **`ci.yml`'s `Board build + artifact freshness` step** (`.github/workflows/ci.yml:1081`) reports a stale build as a warning and exits 0 on `push` to `main`. It stays an error on `pull_request`. A separate step fails when the bundles on `main` are still stale after the workflow ran, so a broken workflow becomes visible.
- **`release.yml`'s `release` job** runs `pnpm build:board` before it tags and refuses to tag when the generated paths differ.
- **`package.json:22`**: the `version` script drops its trailing `&& pnpm run build:board`, so the release PR carries no bundle and takes `main`'s.

### Decisions the plan settles — do not re-derive them

**The App pushes to `main`; there is no bot PR.** A bot PR was rejected. GitHub holds a workflow on a bot-authored PR at `action_required` (`ci.yml:6-22`, measured 2026-09-23: 11 of 12 runs on the release PR never ran). A bot PR would also need its own exemption from the slice 2 gate, and a 16–18 minute `validate` run restarted by every push during a merge burst. The operator chose the App route on 2026-10-02.

**`GITHUB_TOKEN` cannot do this push.** A push made with it does not start workflows, and it cannot bypass the ruleset. An App installation token does start them. Use `actions/create-github-app-token`, pinned by commit SHA like every other action in this repo, and check out with that token so `git push` uses it.

**Concurrency cancels instead of queueing.** A run for an older push must not push an older build over a newer one. `cancel-in-progress: true` guarantees that. Do not copy `release.yml`'s `cancel-in-progress: false`, which has a different job: a publish must not be cut off.

**A refused push loses nothing.** If `main` moved while the build ran, the push is refused. Do not rebase, retry in a loop or force. The next push's run builds the newer tree. A force push here would remove a person's merge.

**The loop guard.** The App's own push starts the workflow again. That run builds, finds the generated paths equal to `HEAD`, and pushes nothing. The condition is the tree, not the author. A test proves it.

**`main` stays green between a merge and its build.** Until the App's push lands, `main` holds the previous build for one workflow run, about 3–5 minutes. A required check that failed on that state would make `main` red by design (the panel's round 1 finding). So on `push` to `main` the freshness step warns and exits 0, and the workflow owns freshness.

**The lag check needs a measurable rule.** The plan says *"stale more than one workflow run after the merge that changed the source"*. One reading that a script can decide: on a push whose head commit is the App's `plot: build the board artifact`, a build that still differs from `HEAD` is a failure. The workflow ran and left the tree stale, so the build is not deterministic or the push dropped paths. On any other push the same finding is the warning. If you choose another rule, name it in the workflow comment and test it.

**The generated set is `BOARD_ARTIFACT_PATHS`, never the directory.** `skills/plot/scripts/board/` holds 36 files. 34 are generated. `README.md` and `plot-monitor.mjs` are written by hand, and a `git add skills/plot/scripts/board/` would commit them. Stage the generated paths one by one. Read the set from the same derivation as `scripts/check-bundle-attributes.sh` (`build.mjs`'s `shipped*` declarations), never from a typed list. That derivation found a ninth bundle the plan that created it had missed.

**The bundles stay tracked on `main`.** The plugin installs from the repository (`.claude-plugin/marketplace.json` names `source: ./`) and runs `skills/plot/scripts/board/*.mjs` directly. Untracking them was not an option.

**Rules carried over unchanged from related work:**

- Read the exit code, not the emptiness of stdout. A step that prints nothing and exits 0 is a different answer from one that prints nothing and exits 2.
- A decision that must be tested belongs in a script, not in workflow YAML. Put the "build, compare, commit, push" logic in `scripts/` so a fixture test can run it. Workflow YAML has no test tier here.
- Do not describe history in the shipped comments. State the current behaviour.

### Prerequisite — owned by a person

**A fleet agent cannot create the App.** The App needs `contents: write` on `plot-pm/plot`, a place on the ruleset bypass list for the PR and `validate` requirements, and its id and private key stored as repository secrets. Measured 2026-10-02: the repository holds no Actions secrets, and `gh secret list -R plot-pm/plot` printed none when this brief was written.

Before you write the workflow, run `gh secret list -R plot-pm/plot`. Take the secret names from that output. Do not invent names. If the secrets are absent, write `PLOT-BLOCKED.md` naming the missing App and secrets, and stop.

Two Open Questions in the plan stay open until the App exists. Confirm both on the first real run and write the outcome in the PR:

- A ruleset bypass lets the App push to `main` past the PR requirement and the required `validate` check.
- The App's push starts the push-triggered workflows.

### Done when

The plan's slice line is the specification: the workflow builds and pushes with a concurrency group and a loop guard, `main`'s freshness step warns and a lag check fails, the release job checks freshness before it tags, and the `version` script stops building.

Assertions that exist because a naive implementation would pass without them:

- **A fresh tree pushes nothing.** Run the logic against a scratch repository whose generated paths equal `HEAD`. It makes no commit and exits 0. A naive version that always commits creates an endless loop of App pushes.
- **A stale tree commits only generated paths.** Change one bundle and also touch `skills/plot/scripts/board/README.md`. The commit holds the bundle and not the README. This catches a directory-wide `git add`.
- **A refused push exits without a retry or a force.** Run it against a bare remote that moved. The script reports and exits, and the remote's newer commit is still there.
- **The warning and the failure are different exits.** A stale build on a person's merge exits 0 with a warning, and on the App's own build commit exits non-zero.
- **The release check refuses a stale tree.** Prove it with the same fixture. A naive check that only runs the build passes on a stale tree.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. List no full suite. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction.
- A new script in `scripts/` needs its name to pass `./scripts/check-script-names.sh`, and a temp path through `plot-tmp.sh` or the shell gate refuses it (`./scripts/check-temp-paths.sh`).
- Add a changeset. Package `plot`, level `patch`, with the description first and the `bumps:` block last. Name the plan on a `plan:` line inside the block. Copy the format from `git log -- .changeset`, because `.changeset/` is often empty.
- Pin every new `uses:` to a commit SHA with the version in a trailing comment, as `release.yml` does.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Do not commit a `PLOT-BLOCKED.md` marker. If you must stop, write it in the worktree only.

### Scope guard

This branch owns `.github/workflows/` (the new workflow, `release.yml`, and only the freshness step in `ci.yml`), `package.json`'s `version` script, one script under `scripts/` with its fixture test under `test/reconcile/`, and the changeset.

Verified at dispatch: no open remote branch changes `.github/` or `package.json` except `changeset-release/main`, which rewrites `package.json`'s version fields and is not yours.

Do not touch what the later slices own:

- `bug/a-pr-carries-no-bundle`: `scripts/check-no-bundle-diff.sh`, moving `build:board` ahead of the tests in `ci.yml`, the commit-time gate, the desk filters, `reset_desk`, and the switch-off of the board's automatic repair at `resolver.ts:236-237`. It also rewrites the text that says "commit the artifact" (`.plot/worker-prompt.sh:186`, the `ci.yml:1080` message, `CLAUDE.md`, `docs/definition-of-done.md`, `.gitattributes`). Leave those sentences as they are.
- `bug/the-artifact-repair-is-retired`: `plot-resolve-artifact.sh`, `resolver.ts`, the `Repair` display and every other removal in the plan's Design section 3.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
