## Implementation brief — an-agent-refused-every-write-ends (wave 4: Self-heal)

- **Plan (canonical):** `docs/plans/2026-10-24-an-agent-refused-every-write-ends.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2509 merged
- **Branch:** `bug/claim-only-branch-returns-to-queue` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waits on wave 1 (`bug/refused-writes-end-as-permission-denied`), **merged** as PR #2545 (`a8f34a4c9`). Wave 2 (`bug/loop-writes-blocker-for-refused-agent`) merged as #2599. Wave 3 (`bug/fleet-start-probes-worker-writes`) is PR #2737, open; this branch waits on neither it nor wave 2.

### What to build

Observed 2026-10-23 in ewz-kus-portal: three agents were refused every write. Each left a claim commit on a pushed ref, no PR, and no work. Freeing them took three manual steps: delete the remote refs, `git fetch --prune`, remove the dead desks and local branches. `plot-dispatch.sh --release` refused while the host answered 429, and the supervisor kept counting `orphaned-claims=3` from stale `refs/remotes/origin/*`.

The slice makes the tick return such a claim to the queue by itself: a branch that holds only the claim commit, whose agent ended `nothing-done` or `permission-denied`, and that no PR carries. The release prunes the tracking ref and reaps the desk. Where the host cannot be asked, the claim-only commit is local evidence that no PR carries work. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Read the existing release path before adding one.** `releaseClaim` (`packages/domain/src/workflows/dispatch-verbs.ts:468`) decides; `claimReleaseShell` performs it through `plot-dispatch.sh --release`; `gatherReadingsAndRelease` (`packages/fleet/src/shared/release-claim-reader.ts`) gathers the readings. `endingAction` (`rules/ending-action.ts:339-348`) already answers `release-claim` for `nothing-done` with no commit beyond the claim and no open PR. The plan's second open question — does this differ from `release-claim` only when the host is unreachable, or also in stale-ref and desk cleanup — is this slice's first job. Answer it in the PR from a reading of those three files, with the line numbers.

**`releaseClaim` refuses `pr-open` when the host cannot answer** (`dispatch-verbs.ts:491-496`): *"a release deletes a ref that cannot be re-created, so silence is not permission."* That refusal is the observed 429 failure and is also correct for a ref whose PR state is unknown. The host-unreachable case therefore needs a different licence than a PR answer: the claim-only commit as local evidence. State exactly what that evidence is (the branch has zero commits ahead of the default branch beyond claim markers, which `claimAnswer` → `stale-claim` and `deadClaim` already read) and keep it to a branch no manifest holds live.

**`permission-denied` is a `NEEDS_PERSON_ENDINGS` member** (`ending-action.ts:223`) and answers `needs-a-person`, not `release-claim`. Wave 1's guard states why: *a fresh session meets the same refused permissions.* The plan's slice 4 names `permission-denied` among the endings that self-heal, and that contradicts the rule on `main`. Releasing the claim is safe (nothing is lost), but it re-queues the slice into an agent that is refused again, and wave 2's `PLOT-BLOCKED.md` is the person's question — `releaseClaim` refuses a desk with a marker. Do not change `endingAction` to make the plan's sentence true. Decide which of the two holds, state it in the PR, and amend the plan if the plan's sentence is the one that is wrong. A `permission-denied` claim stays held for a person; the write probe of wave 3 is what stops the next one from being pushed.

**Destructive path: the host answers, not git.** Per *One Answer To "Did This Land"*, a decision to delete a ref reads `mergedAt` through the host port. Never use `git merge-base --is-ancestor`: measured 2026-09-04, ancestry disagreed with the host on ten of ten merged branches. `scripts/check-ancestry-decisions.sh` refuses an undeclared ancestry call. Claim-only is a statement about the branch's own commits, not about whether it landed, and a branch the host reports MERGED is `plot-release-refs.sh`'s, never this release's.

**Absent is not false.** An unreadable ending, an unanswered PR reading and a failed ref listing answer *leave*, never *release*. A release is the destructive arm.

**Prune the tracking ref, not only the remote.** The `orphaned-claims=3` count came from `refs/remotes/origin/*` that outlived the deleted remote refs. A release that deletes the remote ref and leaves the tracking ref leaves the count wrong. Assert the count falls, not only that the release ran.

**Layering holds.** The decision lives in the domain as a rule over readings; the tick (`registryd`) gathers readings; the adapter performs the release. No `spawn` in the domain, no new `plot-*.sh` caller outside an adapter. `scripts/check-shell-lines.sh` refuses shell growth: this slice should touch no `.sh` file.

### Done when

The plan has no `## Done when` list; its Changelog line and the Self-heal paragraph of its Approach are the specification. Assertions a naive implementation would pass without:

- A claim-only, PR-less branch whose agent ended `nothing-done` is released, and the tracking ref is gone afterward. Catches a release that deletes the remote ref only.
- The same branch with the host unreachable (429 or unanswered) is released from local evidence. Catches reusing `releaseClaim` unchanged, which refuses `pr-open`.
- A branch carrying one commit beyond the claim is not released, host reachable or not. Catches an evidence rule that reads *no PR* as *no work*.
- A branch with an open PR, a merged PR, a live holder, or a `PLOT-BLOCKED` marker is not released. Catches dropping a refusal the shell enforced.
- A `permission-denied` ending keeps the answer the table gives it today. Catches rewriting `endingAction` to match the plan's sentence.
- Corpus tier, if the shell `--release` and the domain rule both decide the claim-only case: a disagreement names both answers (see `docs/shell-and-domain.md`). On a disagreement the branch stops; do not adjust either side to pass.

Plus: a changeset (`plot` and/or `@plot-pm/board`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Domain code stays arrow functions with factual TSDoc and no decision history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite locally. Name `scripts/check-shell-lines.sh` in the PR if any `.sh` file changes: growth is paid for in the same change.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Self-heal` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the claim-only self-heal: its rule in `packages/domain/src/rules/`, the tick's reading and call in `packages/fleet/src/server/entry/registryd*.ts` and `packages/fleet/src/shared/release-claim-reader.ts`, the tracking-ref prune in the release adapter, and their tests.

Not this branch: the `permission-denied` classification (#2545, merged), the loop-written blocker (#2599, merged), the start-time write probe (#2737, open), and `endingAction`'s `NEEDS_PERSON_ENDINGS` table.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
