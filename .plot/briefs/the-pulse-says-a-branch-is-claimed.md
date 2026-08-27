## Implementation brief — a-claimed-branch-is-not-startable (wave: Seen)

- **Plan (canonical):** `docs/plans/2026-08-25-a-claimed-branch-is-not-startable.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/the-pulse-says-a-branch-is-claimed` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 1 of 2.** `Spent` follows and consumes what you publish. A third wave in
another plan — `Taken` of `an-eligible-wave-can-be-started` — is DEFERRED waiting
on this one, so two consumers depend on the field you add.

### What to build

The fleet pulse carries, per branch, whether a **ref holds it** — derived by the
scan from refs it already walks. No new git call, no host call.

### Why it is urgent, measured twice today

`isStartable` (`auto-dispatch.ts:140`) returns true for `open || wip`. `open`
means *no PR* and says nothing about whether a ref exists, so a claimed branch
counts as startable. On 2026-08-27 that produced six workers on six already-
merged waves, in two cycles an hour apart:

| branch | already merged as |
|---|---|
| an-unreachable-host-says-so | #446 |
| the-board-reads-approval-not-phase | #458 |
| the-worktree-root-is-configurable | #445 |
| a-bitbucket-issue-is-a-ticket | #449 |
| a-plan-cites-a-jira-key | #447 |
| a-jenkins-build-has-a-status | #450 |

Two opened PRs — **#473 and #476** — each ~120 commits behind main. Either would
have reverted that much work had the auto-merger taken it green.

### The decisions the plan settles — do not re-derive them

**Read from the SCAN, never a live `git ls-remote`.** `maybeAutoDispatch` runs
inside the scan's success path and must stay off the request path; a network call
per candidate branch would put host latency into the pulse. The scan already
walks refs to derive `merged` — the fact is in hand.

**A CLAIM is a branch whose only commits beyond main are claim commits.** The
scan already computes this (`real_commits_beyond_main`): `ahead > 0` with
`real == 0` is `claimed`, and real work is `wip`. Both mean a ref exists. Do not
invent a second derivation — `plot-fleet-scan.sh:3001` already emits a `claimed`
field, but that is the PLAN FILE's human-written annotation, which the contract
calls *"a REFLECTION of a claim, not the claim itself — where the two disagree,
git wins."* What this wave publishes is the git fact.

**No host call is added** (`Done when` item 5), asserted by the existing
no-network test.

### Done when

The plan's 7 items are the specification; this wave delivers the pulse field the
later items depend on. Yours in particular: **item 5** (no host call) and
**item 3** (`plot-dispatch.sh` unchanged — its ref-push claim stays the locking
mechanism).

Plus: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green; a
changeset with a `bumps:` block naming `plot` if you touch `skills/plot/`, and
`'@plot-pm/board': patch` frontmatter if you touch `packages/board` — this wave
likely touches both, so include what applies; Node 24; `trash` not `rm`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns `skills/plot/scripts/plot-fleet-scan.sh`'s branch derivation and the
contract field in `packages/board/src/contract/schema.ts`. **Do not change
`auto-dispatch.ts`** — that is the `Spent` wave. Note `bug/the-scan-parses-its-plans-once`
may also be in flight on the same scan script for a performance change; keep to
your own function and rebase onto current main before you start.
