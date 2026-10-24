# Implement leaves the main checkout on the slice branch and its pushed ref blocks dispatch

> `/api/implement` run in the operator's main checkout leaves it on the slice branch and pushes a Started-only ref that the queue reads as held, so the slice never dispatches.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2162
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2471 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/implement-restores-the-checkout`

## Changelog

- Fixed: `/api/implement` returns the operator's checkout to the branch it found, and a slice branch that holds only the Started record no longer blocks dispatch.

<!-- Board impact: the board's `/api/implement` handler and the row's release-claim offer change; the plan format, template and helper scripts do not. Rebuild the board artifact if the board package changes. -->

## Motivation

On 2026-10-20 `/api/implement` for `plot-reads-as-an-unknown-tracker` (#2077) ran in the operator's main checkout. It left the checkout on `bug/plot-reads-as-an-unknown-tracker` and pushed that branch to origin at `92111c8f9`, the Started record: a commit on `main` with no slice work and no PR.

Fleetd read the slice as held (`ref_held: true`, `worker: ended`, `local_worktree` = the repository root) and logged on every pass `claim with no agent` and `auto-dispatch: skipping plan(s) with nothing startable: plot-reads-as-an-unknown-tracker (ref-held)`. A second `/api/implement`, for `bitbucket-jenkins-pr-list-rows-past` (#2154), then ran in the same checkout, committed its brief on top of the #2077 slice branch and pushed it to `main`.

The slice stayed undispatched from approval (08:03 UTC) until a person moved the checkout to `main`, released the claim through `/api/release-claim` and deleted the local branch (09:33 UTC) — 90 minutes. A desk took it within one minute afterwards. `plot-dispatch-command.mjs <slug>` did not help: it starts a `--brief-only` implement run, which reports nothing to do.

## Design

### Approach

Three expectations from the issue, one slice each, in order of blast radius:

1. **Restore the checkout.** The implement run records the branch it found and returns to it when it ends, on every exit path. Where the run starts from the main checkout, a detached scratch worktree is the alternative; the open question below decides.
2. **No unclaimed-looking ref.** The Started push either does not happen for a brief-only run, or it pushes a ref the queue reads as unclaimed. `implement-run.ts` documents that this step "pushes no claim ref" under the registry model, so the push that occurred is the defect to locate first.
3. **A dead claim releases itself.** A claim ref with no agent and no commits beyond the default branch does not hold a slice indefinitely: fleetd releases it, or the board offers the release on the row (`release-claim.ts` already exists). The layering rule applies: the decision is a domain rule over readings, the controller calls it.

Files likely touched: `packages/fleet/src/shared/implement-run.ts`, `packages/board/src/server/release-claim.ts`, `packages/domain/src/rules/auto-dispatch.ts`.

### Open Questions

- [ ] Which code path pushes the branch: the implement run, `plot-implement`, or the Started-record writer? A reproduction in a sandbox repo answers this before slice 2 starts.
- [ ] Restore in place, or run in a scratch worktree? A scratch worktree also stops the second run from committing onto the first run's branch.
- [ ] Release automatically in fleetd, or offer it on the board row? An automatic release is a write the fleet makes unattended, so the rule needs a stated age bound.

## Slices

### Checkout

- `bug/implement-restores-the-checkout` — `/api/implement` returns the operator's checkout to the branch it found, on success and on failure → #2538

### Ref

- `bug/implement-pushes-no-held-ref` — the Started record never leaves a ref the queue reads as held <!-- waits: bug/implement-restores-the-checkout --> → #2646

### Release

- `bug/dead-claim-releases` — a claim with no agent and no commits beyond the default branch is released by the fleet or offered on the row <!-- builds: a domain rule naming an empty claim ref releasable -->

## Notes

- Created from tracker issue #2162 by an unattended `/plot-idea`. `PLOT-UNASKED: Does this plan carry significant design decisions? — default — proceeded; State: Draft`.
- Review `pr` and Impl `own branches` follow from `Plan PRs: required` in this repo's Plot Config.
