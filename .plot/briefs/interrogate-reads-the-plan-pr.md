## Implementation brief — interrogate-cannot-reach-a-draft-plan (wave 1: Resolve from the plan PR)

- **Plan (canonical):** docs/plans/2026-10-24-interrogate-cannot-reach-a-draft-plan.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2517 merged
- **Branch:** `bug/interrogate-reads-the-plan-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 1 of 2. Wave 2, `bug/interrogate-pushes-to-the-plan-pr`, waits on this branch: it pushes the round's artifacts to the branch this wave makes the route read.

### What to build

`POST /api/interrogate` answers `plan-unreadable` for every Draft plan under `Plan PRs: required`. Observed 2026-10-23: `{"slug":"this-sprint-cannot-select-one-sprint"}` with plan PR #2413 open. A Draft plan exists only on its `idea/<slug>` branch until the plan PR merges, and `resolvePlanBySlug` (`packages/board/src/server/interrogate.ts:93`) reads only the main checkout's active index and plan directory. After the merge the plan is Approved and the route refuses it as `not-a-draft`, so no plan in this repository can be interrogated.

This wave changes the read half only. The route resolves the slug to its open plan PR through the host port, then runs the configured `Interrogate command` in a worktree of the PR's head branch, so `/challenge-the-plan` reads the plan where it lives. With no open plan PR (`Plan PRs: optional`, or a Draft plan already on the default branch) the route falls back to the main checkout, as it does today. The phase check reads the same file the prompt names. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The plan PR's head is the source, not the main checkout.** The main checkout cannot hold a plan whose PR is open. Reading the head is how the approve flow already reads a plan under `Plan PRs: required` ("read it from PR #N (idea/<slug>)"). Do not add a "fetch the branch into the main checkout" step: the checkout is shared with the operator's uncommitted work.

**The same blind spot lives in `readPhase` (`transition.ts:133`).** `interrogate.ts` imports it for the phase check, and its `resolvePlanBySlug` (`transition.ts:104`) is a second copy of the one in `interrogate.ts` and a third lives in `reslice.ts:137`. The route's phase read and its prompt must name one file (the comment at `interrogate.ts:89` says so). Resolve once, read the phase from that file, and do not leave the two disagreeing. Do not widen `readPhase` for `needs-design`, `reslice` or any other caller; the plan scopes this to interrogate.

**The route decides nothing about the plan.** It writes the prompt, the log and the state file outside the repository, as today. Layering holds: controller calls the domain, the domain owns the port, an adapter reaches the host and git. The route does not spawn `gh` or `git` itself — the repo's spawn ratchet (`ci.yml`, "One place reaches a process", `allowed=28`) counts direct `spawn`/`execFile` sites outside `adapters/` and fails when the number grows. Reach the plan PR through the `host` port (`prList` or `prState`, `packages/domain/src/ports/host.ts`) and a worktree through an adapter or the existing `agentRun` seam.

**Resolution rules carried over unchanged.** Absent is not false: a host that cannot answer (rate limit, no connector, timeout) is not "no plan PR". Refuse as `plan-unreadable` with the host's reason rather than falling back to the main checkout and interrogating a stale or missing file. Fall back only on an answered "no open plan PR". An open PR whose head branch is not `idea/`-prefixed is not a plan PR. Read the exit code, not the emptiness.

**Open questions in the plan are wave 2's.** Who pushes (agent or route), whether an Approved plan is served, and what a moved branch does are not this wave's. Do not decide them here. Leave the run's worktree and its cleanup in a state wave 2 can push from.

### Done when

The plan's `## Done when` list does not exist yet; the specification is the plan's Design section steps 1 and 2 and its Motivation. Concretely:

- `POST /api/interrogate` for a Draft plan that exists only on an open `idea/<slug>` PR answers 202, and the run's tree is a worktree of that PR's head. Catches: the route resolving from `opts.repoRoot` again.
- The prompt names the plan path inside that worktree, and the phase read comes from the same file. Catches: phase `null` for a PR-only plan, which is today's `plan-unreadable`.
- A slug with no open plan PR still resolves from the main checkout. Catches: the fallback breaking `Plan PRs: optional` repositories.
- A host that fails to answer refuses `plan-unreadable` and names the host's reason. Catches: a failed lookup read as "no plan PR".
- A second POST while the first runs still refuses `already-running`. Catches: a state path keyed by something the worktree changes.
- The new tests live in `packages/board/test/unit/interrogate-route.test.ts` (inject the host through `InterrogateDeps`, as the file does for config and phase). Write new helpers as arrow functions.

Plus: a changeset for `@plot-pm/board` per the repo's versioning rules (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file, and if it does, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle. Do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/interrogate.ts`, its caller, `packages/board/test/unit/interrogate-route.test.ts`, and the new test files and changeset. Touch `transition.ts` only for what the shared resolve forces. The other branch in flight for this plan is `bug/interrogate-pushes-to-the-plan-pr` (wave 2, not started); it writes the push and the artifacts and must not be anticipated here. No other plan's branch was found on `packages/board/src/server/interrogate.ts` at dispatch (`git log` since approval: no commits).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
