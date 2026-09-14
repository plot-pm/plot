## Implementation brief — the-build-gate-sees-every-bundle

- **Plan (canonical):** `docs/plans/2026-09-14-the-build-gate-sees-every-bundle.md` on `main`
- **Approved:** 2026-09-14, jwloka, in-session
- **Branch:** `bug/the-build-gate-sees-every-bundle` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI green, reviewer reads the diff

One slice, one branch, no wave ordering. Nothing waits on this and it waits on nothing.

### What to build

Two independent one-hunk fixes, both found on 2026-09-14 while the fleet delivered `a-merge-commit-carried-work`, and both invisible to a person working in the repository root.

**The freshness gate.** `.github/workflows/ci.yml:857` runs `pnpm run build:board` and then diffs exactly one path, `skills/plot/scripts/board/board-server.mjs`. That directory holds **24** bundles. Editing `adapters/refs/refs-git.ts` on PR #908 restaled three of them — `board-server.mjs`, `plot-ask.mjs` and `plot-registryd.mjs` — and CI named only the first. Widen the diff to the directory and print the filenames the diff actually found.

**The plan link.** `plot-open-pr.sh:88` prefixes `$repo_root/` onto `plan_dir` so the glob on `:99` resolves from any working directory. The resulting `meta.file` is absolute, and `:191` hands it to the domain as `PLOT_FILE`, which becomes the PR body's plan link. From a worker desk that reads `/Users/…/.worktrees/free-9e72e356/docs/plans/….md` — a dead link on the git host. Strip the `$repo_root/` prefix at the second consumer only.

The plan is canonical and carries the full measurement for each. This is orientation.

### The decisions the plan settles — do not re-derive them

**This is a gate defect, not a message defect — do not fix only the string.** Proved by mutation on 2026-09-14: append a line to `plot-ask.mjs` and the current check **passes**. A stale bundle that is not `board-server.mjs` reaches main today, and every skill and shell script in this estate executes something from that directory. Widening the error message while leaving the diff path alone would close the symptom and leave the hole.

**Widening to the directory costs no false positives, and that was measured.** On a clean main, `pnpm run build:board` rewrites **nothing**; with one bundle dirtied it writes only inside `skills/plot/scripts/board/`. The build's output set and the gate's diff path become the same set — that identity is the argument, not an estimate of risk. Do not add exclusions to guard against a false positive nobody has observed.

**The error prints `git diff --name-only`, never a constant.** Hardcoding the filename is the half that made the three-bundle case cost two CI runs: the first repair fixed what the message named and failed again on the next run. The step must report what it found.

**`plot-open-pr.sh:88` must stay exactly as it is.** `case "$plan_dir" in /*) ;; *) plan_dir="$repo_root/$plan_dir" ;; esac` exists so the glob on `:99` works from any directory, and removing it breaks the search. The plan states this explicitly. Relativise where the value is **used**, not where it is globbed.

**`plan_file` has exactly two consumers, and only one is wrong.** `basename` on `:121` is indifferent to the prefix — verified, `plan_slug` is unchanged either way. `PLOT_FILE` on `:191` is the PR body. Strip for the second and touch nothing else.

**`rules/slice-pr.ts:161` is not at fault and must not be changed.** It renders `readings.planFile` verbatim, which is correct: a rule that rewrote a caller's path would be inventing a repository root it cannot see. The domain reaches no filesystem — that is the layering rule, not a local preference. The absolute path arrives from the caller, so the caller fixes it.

**A plan outside the repository keeps its absolute path.** The strip is a **prefix removal** (`${plan_file#"$repo_root"/}`), not a `realpath --relative-to`. A path that does not start with `$repo_root/` passes through unchanged, because a link that cannot be made repo-relative is better absolute than wrong.

**Carried over unchanged from this estate's standing rules:** read the exit code, never the emptiness of output — an unreachable command and an empty result are different answers. And `git diff --quiet` over a directory answers *did anything change*; `git diff --name-only` over the same path answers *what*. The step needs both, in that order.

### Done when

The plan's `## Done when` is the specification:

- appending a line to `plot-ask.mjs` makes the freshness step fail, **and the error names `plot-ask.mjs`**
- a clean checkout still passes the step
- the glob on `plot-open-pr.sh:99` still resolves, and `plan_slug` is unchanged
- a PR body built from a worktree desk carries `docs/plans/…` rather than an absolute path
- `pnpm run test:contracts` passes

Two of these exist **because a naive implementation passes without them**:

- *the error names `plot-ask.mjs`* catches the fix that widens the diff and leaves the hardcoded string. The gate would then be correct and its report still misleading — exactly the state that cost two runs.
- *`plan_slug` is unchanged* catches a fix applied at `:88` instead of `:191`. Moving the strip upstream makes the PR body right and silently breaks the glob for any caller not standing at the repository root, which is the same population the bug came from.

Verify the mutation test by actually running it — append a line to `plot-ask.mjs`, run the step's commands by hand, confirm the failure and the filename, then restore the bundle **from git** (`git checkout -- skills/plot/scripts/board/plot-ask.mjs`), never from a copy you took.

Plus the repo's gates: `nvm use` first (Node 24 — `pnpm` crashes on 26), then `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers into sandbox repositories, and running it locally starves the machine. A changeset is required: this ships under `skills/`, so use a `plot` package frontmatter with a `bumps:` block naming `plot` (patch), description **first** and the `bumps:` comment **last**.

### Bookkeeping

Push the first real commit as soon as it exists.

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

**Do not run `gh pr create`.** It takes its title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

Note the recursion: this branch **edits the script that opens its own PR**. Open the PR from the checkout you are working in, and if `plot-open-pr.sh` misbehaves after your edit, that is your change failing its own acceptance test rather than an unrelated tooling fault.

### Scope guard

This branch owns exactly two files:

- `.github/workflows/ci.yml` — the `Board build + artifact freshness` step only
- `skills/plot/scripts/plot-open-pr.sh` — the `PLOT_FILE` argument on `:191` only

Plus the changeset it adds under `.changeset/`.

**Do not touch** `packages/domain/src/rules/slice-pr.ts`, `plot-open-pr.sh:88`, or any bundle under `skills/plot/scripts/board/` — those are build output, and a bundle committed by hand is the defect this branch exists to catch. Other files in `.changeset/` belong to sibling branches; add yours and touch none of theirs.

No other branch is in flight over either file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
