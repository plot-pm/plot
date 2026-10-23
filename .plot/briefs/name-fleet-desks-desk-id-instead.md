## Implementation brief — name-fleet-desks-desk-id-instead (wave: Rename)

- **Plan (canonical):** [docs/plans/2026-10-23-name-fleet-desks-desk-id-instead.md](../../docs/plans/2026-10-23-name-fleet-desks-desk-id-instead.md) on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2376 merged
- **Branch:** `infra/name-fleet-desks-desk-id-instead` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This is the plan's only slice and only branch — no wave ordering, no sibling to wait on.

### What to build

A fleet desk is a worktree `plot-dispatch.sh` creates for a free agent. Its name has read `free-<id>` since the fleet existed, and that name never changes once the desk takes a slice — so a desk working `bug/release-gate-names-an-unfinished-must` still has a directory called `free-eaee9638`. The vocabulary elsewhere (`rules/reapable.ts`, `plot-desk-dirt.sh`, reconcile section 21) already calls these worktrees desks; only the directory name disagrees.

Change the one line that names a new desk, `skills/plot/scripts/plot-dispatch.sh:2566`:

```bash
start_wt="$wt_root/${wt_prefix}free-$(plot_session_id | cut -c1-8)"
```

to use `desk-` instead of `free-`. Leave every existing `free-<id>` worktree on disk untouched — renaming a live worktree breaks its worker's pid file, manifest and claim, and the reaper already removes desks over time as they finish.

### The decisions the plan settles — do not re-derive them

**This is a one-line change, confirmed safe by grep, not by inspection.** The plan's Design section claims no reader matches the `free-` prefix on a desk's directory name — re-verify this before changing the line, don't take it on faith:

```bash
grep -rn "free-" skills/plot/scripts packages --include="*.sh" --include="*.ts" --include="*.mjs" --include="*.js"
```

Checked at brief-writing time (2026-10-23): every other hit is either a comment quoting a measured path (`plot-open-pr.sh:196`, `plot-reconcile-scan.sh:2707`), an unrelated `free-form`/`free-text` phrase (`idea.ts`, `plot-plan-meta.sh`, `plot-fleet-scan.sh`), or the atomic-write temp suffix `plot-free-tmp` (`plot-agent-manifest.sh`, `plot-gate.mjs` bundle) — which names a *file*, not a desk, and shares no logic with the desk prefix. No source file under `packages/board/src` derives a session id from the worktree directory name. If your own grep turns up a live match this one missed, stop and report it — the plan's premise would be wrong, not just this brief's restatement of it.

**Both prefixes must keep working for existing desks.** Any reader that does match a desk by its directory-name prefix (none was found, but if the implementation touches one) must accept `desk-` and `free-` both — a `free-<id>` desk created before this change still runs and must still be recognised as a desk until the reaper clears it.

**Test fixtures using `free-<id>` session/worktree strings are not evidence of prefix-matching logic.** `packages/board/test/unit/{ended-desks,agent-is-free,continue-route,fleet,the-fleet-payload-carries-design,the-fleet-payload-carries-verification}.test.ts` and two browser tests under `test/integration/` all use `free-<id>` strings as arbitrary fixture IDs — confirmed none of these derive meaning from the prefix itself; they're just a convenient fixture value, not a prefix match under test. They do not need updating. What *is* missing is coverage for the new name: add one test asserting a freshly dispatched desk is named `desk-<id>`.

### Done when

The plan's `## Slices` entry is the specification: desks created from now on are named `desk-<id>`, existing `free-<id>` desks stay recognised, and a test proves the new name.

Concretely:
- A test (shell-level, exercising `plot-dispatch.sh`'s start path, or the narrowest test that reaches the line) asserts a newly started desk's worktree path matches `desk-[0-9a-f]{8}`, not `free-`.
- Nothing in `rules/reapable.ts`, the reaper, reconcile, or the registry breaks for a live `free-<id>` desk — these recognise a desk by its `.plot-worker.pid` file per the plan's Design section, not by directory name, so this should require no code change in those files; confirm it with a run of their existing tests rather than assuming.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this branch's change lives under `skills/plot/scripts/`, so expect it to select the gate tests (`scripts/check-*.sh` family) and `test/reconcile/*gate*.test.mjs`. The suites in `CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain vitest with coverage, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run `test:e2e` locally.

**`scripts/check-shell-lines.sh` applies to this slice.** It touches a `.sh` file (`plot-dispatch.sh`), so the gate ratchets this PR's total shipped shell line count under `skills/` against the merge base. A one-line string change costs nothing here, but if the added test needs more than a trivial shell addition, pay for it by removing shell elsewhere in the same change or by writing the check in the domain and reaching it through a bundle — the gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it has no way to find the plan or wave heading. `plot-open-pr.sh` reads which plan names the branch and opens the PR with the wave heading ("Rename") as the title, the plan and this brief in the body.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-23-name-fleet-desks-desk-id-instead.md:49`). No project board is configured in this repo's `## Plot Config`, so there is no "Ready" status to set. Close tracker issue #2375 in the PR description or with a linking keyword — the Motivation section is this issue restated.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-dispatch.sh` — the one line at `:2566` that names a new desk, plus whatever minimal reader change is needed if the re-verification grep above finds a live prefix match
- a new or extended test asserting the new desk name, in whichever test file already exercises `plot-dispatch.sh`'s start path

This plan has no other branch — it is a single-slice, single-branch plan, so there is no sibling in flight to collide with.

If you find something the plan did not anticipate — in particular, a live reader that does match the `free-` prefix and was missed by the grep above — report it rather than improvising outside scope.
