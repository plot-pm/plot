## Implementation brief — adoption-notices-a-stale-default-branch (wave 1: The probe asks the host what the default is)

- **Plan (canonical):** `docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-probe-asks-the-host-for-the-default` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #971

Wave 2 (`bug/adoption-proposes-the-main-branch-key`) waits on this branch: it compares the field this branch adds, so it cannot start until this one merges.

### What to build

`skills/plot/scripts/plot-detect-repo.sh` reports `default_branch` from `origin/HEAD` alone (line 64, contract comment line 20). `origin/HEAD` is a clone-time cache. In the reported clone the GitHub default had moved to `develop`, `origin/HEAD` still said `main`, and the board read plans from `origin/main` — one untitled group, `develop` listed as a branch, two of three plans missing.

This branch adds ONE reading to the probe: the host's default branch, as its own JSON field beside `default_branch`, plus an explicit "could not ask" value. `default_branch` keeps its current meaning and value. No skill changes on this branch; wave 2 consumes the field.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The probe reports and never decides.** It does not emit `default_branch_stale`, `agree`, or a proposed key. The header of `plot-detect-repo.sh` and CLAUDE.md both state it: the probe *"reports counts and never the answer they imply"*; the thresholds moved into `proposeStack` on 2026-09-08 and the fields that decided were deleted. A comparison field here is the second answer that split removed. Wave 2's skill compares.

**Keep `default_branch` as is.** Do not overwrite it with the host's answer. The local reading is half of the comparison; replacing it destroys the evidence the proposal must name ("the plan: the proposal names both answers").

**"Could not ask" is a value, never an empty string that reads as agreement.** Host unreachable, `gh` unauthenticated, no `git_host`, or a non-zero exit → the field says so explicitly (e.g. a separate status field `ok`/`unknown`, the shape `plot-board-probe.sh` uses for auth: *"Report that we cannot tell, never that it is fine"*). Read the adapter's exit code, not the emptiness of stdout.

**Ask through `plot-host.sh default-branch`, never `gh` directly.** `scripts/check-host-cli-callers.sh` is a CI gate: `plot-host.sh` is the ONE place that talks to the host CLI. A `gh repo view` in the probe fails that gate.

### A finding the plan did not anticipate — resolve it on this branch

**On Bitbucket, `plot-host.sh default-branch` reads `origin/HEAD` first** (`plot-host.sh:3002-3006`): `git symbolic-ref ... || bb repo view ...`. The API is only a fallback when the clone has no `origin/HEAD`. So on a Bitbucket clone, the "host's answer" IS the stale cache, the two readings always agree, and the defect stays invisible there. GitHub (`gh repo view --json defaultBranchRef`) asks the host correctly.

Two routes; this branch picks one and says so in the PR:

1. Make the Bitbucket arm ask `bb` first and fall back to `origin/HEAD` only when `bb` cannot answer. This changes the adapter for every caller (`/plot-idea:252` and others), which the plan's premise already treats as the host-asking reader.
2. Leave the adapter alone and report `unknown` from the probe on Bitbucket, stating that the adapter answers from the cache there.

Route 1 matches the plan's intent ("the host is asked"). If it widens scope beyond what fits, take route 2 and report the gap rather than claiming Bitbucket is covered. Also note: the Bitbucket arm's `||` never fires when `sed` succeeds on empty input — the pipeline's exit is `sed`'s. Verify before relying on the fallback.

### A second finding, for wave 2 (do not act on it here)

The plan says `/plot-board-setup` runs `plot-board-probe.sh` and not the adoption probe. That is out of date: `skills/plot-board-setup/SKILL.md:83` runs BOTH `plot-board-probe.sh` and `plot-detect-repo.sh`, since 2026-08-26 (#451). So a field added here reaches board setup too, and wave 2's open "which probe" choice is already answered. Nothing to do on this branch except keep the field in `plot-detect-repo.sh`.

### Rules carried over

- Absent is not false: an unasked host is `unknown`, not `main`, not `""`.
- Read the exit code, not the emptiness of the output.
- The probe is read-only and must stay fast at adoption; it runs the host call once. It is not on the board's hot path and must not be added there.
- JSON is assembled with the probe's existing `j` escaper — do not hand-build quotes.

### Done when

The plan's `## Done when` list is the specification. For this slice:

- The probe's JSON carries the host's default branch beside `default_branch`, and a distinct "could not ask" state. **Test with a stubbed `plot-host.sh`** (or the probe's existing seam) for three cases: host agrees, host disagrees (`develop` vs `main` — the reported case), host fails. The disagree case is the one a naive implementation that reads `origin/HEAD` twice passes the agree test with.
- The failure case asserts the field is NOT equal to `default_branch`. An implementation that falls back to the local reading on failure passes every other test and reintroduces the silence the plan forbids.
- `default_branch`'s value is unchanged for every existing fixture (`test/reconcile/init.test.mjs`, `init-stack.test.mjs`).
- The header comment's field list documents the new field(s).
- If route 1 is taken: a `plot-host.sh` test that the Bitbucket arm asks `bb` before `origin/HEAD`.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `./scripts/check-host-cli-callers.sh`. Not `test:e2e` — CI's gate. A changeset: `'plot': patch`, description first, `plan: docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md` and `bumps:` block last.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (not `gh pr create`), then append `→ #<number>` to this branch's heading annotation in the plan's `## Slices` section (the `(Branch: …, PR: #N)` form inside the heading).

### Scope guard

This branch owns: `skills/plot/scripts/plot-detect-repo.sh`, its tests under `test/reconcile/`, a changeset, and — only on route 1 — the `default-branch` arm of `skills/plot/scripts/plot-host.sh` and its test.

It does not own: `skills/plot-init/SKILL.md`, `skills/plot-board-setup/SKILL.md` (wave 2), `plot-board-probe.sh`, `packages/board/src/**` (the board's three-step resolution stays as is, per the plan).

Verified at dispatch (2026-09-24): no other remote branch touches `plot-detect-repo.sh`, `plot-init/SKILL.md`, `plot-board-setup/SKILL.md` or `rules/stack.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
