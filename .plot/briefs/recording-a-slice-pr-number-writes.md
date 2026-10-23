## Implementation brief — recording-a-slice-pr-number-writes (wave 1: Fix)

- **Plan (canonical):** `docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2396 merged
- **Branch:** `bug/recording-a-slice-pr-number-writes` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the only wave of the plan. Nothing waits on it and it waits on nothing.

### What to build

On 2026-10-23 at 11:26:28 CEST the operator's main checkout held an uncommitted change to `docs/plans/2026-10-23-bounded-run-group-stop-test-times.md`: the `Started:` line and the `→ #2390` annotation. The content matched commit `e7928fe9a` (`plot: record PR #2390 for bounded-run-group-stop-test-times`), which is on origin. The main checkout's `HEAD` stayed at `6b0e15c75` and its reflog shows no commit after 10:28. So one process wrote the plan file into the main checkout while the same content was committed and pushed from another tree. A later `git merge --ff-only origin/main` refused because of the dirty file.

The fix is the one writer, changed so that the file write and the commit use the same tree. Finding the writer is the first half of the slice, and the plan's Open Questions are the checklist for it.

### Settled decisions — do not re-derive them

**`plot-open-pr.sh` is not the writer.** Measured 2026-10-23: the script holds no `→ #` append, no `sed -i`, no `>>` onto a plan, and no `git commit`. It reads the plan through `plot-plan-meta.sh` and opens the PR through `board/plot-slice-pr.mjs`. The plan lists it as a candidate; the grep rules it out. Confirm by reading it before moving on, and do not add a writer to it.

**The commit subjects name two producers.** `plot: record PR #N for <slug>` (e.g. `379564c3c`, `0e2219801`) and `plot-implement: record PR #N for <slug>` (`2953a62c2`) both exist in history. A grep over `packages/`, `skills/` and `scripts/` for the literal `record PR` in `*.ts`, `*.tsx` and `*.sh` finds no source line, so the subject is built from another string or by a bundle. Start from `packages/fleet/src/shared/implement-run.ts`, `packages/fleet/src/shared/brief-ask.ts`, `packages/fleet/src/server/entry/dispatch-command.ts` and the board's `server/entry/` handlers, and from `skills/plot-implement/SKILL.md` step 4, which tells the implementing session to append `→ #<number>` itself. That last one is a prose path: the session that follows it writes wherever its working directory is.

**The writer's path resolution decides the cause.** Record, for each candidate, whether it resolves the plan path through `$PLOT_REPO_ROOT` or `git rev-parse --show-toplevel` (the main checkout) rather than the worktree it commits from. A fleet desk exports `PLOT_REPO_ROOT`, and it is known to leak into sandbox tests. Read the code; do not assume the answer.

**The #2311 gate does not see this write.** It refuses a git write of an unattended run in the main checkout. A plain file write is not a git write. Whether the gate should also cover plain writes is the plan's third Open Question. Fixing the one writer is the slice; widen the gate only if the measurement shows a second writer, and then as a separate branch with its own plan line.

**Rules carried over unchanged.** Absent is not false: a missing plan file is a refusal, not an empty write. Read the exit code, not the emptiness of stderr. A function you write or rewrite is an arrow function. Never `git stash` in a shared worktree. Restore a mutated file from git, not from a copy of your own.

### Done when

The plan has no `## Done when` list. Its Approach is the specification, and each step becomes an assertion:

1. The plan's Open Questions are answered in the PR body: which process writes the file, and whether it resolves through `$PLOT_REPO_ROOT` or the repository root.
2. A sandbox repo with a worktree reproduces the dirty main checkout through the identified writer, and the test fails on `main` before the fix. A test that has never failed proves nothing; run it against the unfixed writer and keep that output.
3. After a record-PR run, `git status --porcelain` in the main checkout is empty and the commit holds the `Started:` line and the `→ #<number>` annotation. The test asserts the main checkout's tree, not only the commit, because a writer that commits correctly and also dirties the main tree passes a commit-only assertion.
4. The sandbox test clears `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` in its child environment, or it measures the operator's shell instead of the writer.

Plus: add a changeset (description first, `bumps:` block last) naming the package that owns the writer. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the writer is a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Never commit a rebuilt `board-server.mjs` or other generated bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, from the tree that commits that change and nowhere else. This is the very write the bug is about, so check `git status` in the main checkout after you do it. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the one writer and its test, plus the changeset. It does not own the #2311 gate, the plan file's other sections, or the board's rendering. Sibling branches in the `bugfix-2-28-2` sprint hold other bug plans; none was checked for overlap with this writer's files at brief time. Verify with `git diff --name-only origin/main...origin/<branch>` against each open sibling before touching a shared file.

If you find something the plan did not anticipate — a second writer, a gate gap — report it rather than improvising outside scope.
