## Implementation brief — plot-reap-yes-deletes-a-different (wave 3: Commits after merge)

- **Plan (canonical):** docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2828 merged
- **Branch:** `bug/plot-reap-keeps-commits-after-the-merge` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app required on main)

This branch is wave 3 of 4. Waves 1 (`bug/plot-reap-pins-every-tip-it-deletes`, #2850) and 2 (`bug/plot-reap-names-an-unknown-host-answer`, #2861) both show `Started:` records in the plan's `## Status` but — as of this brief — carry no commits beyond their claim on `origin/main`: `git log --oneline origin/main..origin/bug/plot-reap-pins-every-tip-it-deletes` and the sibling for wave 2 are both empty. Wave 4 (`bug/plot-reap-yes-acts-on-the-recorded-run`) has not started. The plan's own line-number citations (`reap.ts:911,1048,1171`) are **waves 1 and 2's expected post-merge state**, not what main holds today — do not expect those exact lines; re-locate by content (the worktree kind's given-up delete, the branch kind's delete, the claim kind's delete) when this branch starts.

### What to build

`runBranchKind` in `packages/board/src/server/entry/reap.ts` currently decides "may I delete this local branch" from one boolean, `hasMergedPr` (set true either by `ctx.refs.contains(br, origin/<default>) === 'yes'` or by `ctx.host.prMerged(br) === 'merged'`, around `reap.ts:1021-1033` on current main). That boolean loses two kinds of real work:

1. **A branch whose local tip is past the PR's merged head.** The branch kind never checks this — it deletes on "a PR for this branch name merged" alone, with no comparison between the local tip and what actually landed. The worktree kind already does this comparison (`unpushedCommits`, `reap.ts:449-485` on current main, which calls `ctx.host.prMergedHeads(branch)` and `ctx.trees.unpushedPatches`). The branch kind must reuse that same guard rather than re-deriving it.
2. **A branch with no commits of its own that reads as contained.** `ctx.refs.contains` uses `git merge-base --is-ancestor`, which answers `yes` for a branch that never diverged (e.g. a stale local ref sitting at an ancestor of main) just as readily as for one truly merged. Right now both cases delete as "merged into main". After this slice, only a branch that actually had commits of its own may be deleted via the containment path; a branch with none is kept for a person.

### Settled decisions — do not re-derive them

**`hasMergedPr` splits into a host answer and a containment answer.** The plan (Design → Approach, Decisions list) is explicit: these are two different questions with two different actions. A host-merged answer plus a tip past the merged head is a keep, reusing `prMergedHeads`/`unpushedPatches`. A containment-`yes` answer with zero commits of its own is a keep; containment deletes a local ref only when `realCommits` (from `@plot-pm/domain/rules/empty-claim`, already imported in `reap.ts:18`) counts at least one real commit on `origin/<default>..<branch>`.

**"Commits of its own" is read off the first-parent line, not raw `merge-base`.** Open question in the plan, but it states the proposed reading explicitly: a tip off the first-parent line of `origin/<default>`. `Refs.firstParentLine(sha, max)` already exists (`packages/domain/src/ports/refs.ts:684`, implemented `refs-git.ts:774`) — use it rather than adding a new git invocation. The plan names the safe direction: a repository that merges by fast-forward then keeps every contained branch (never over-deletes).

**This is the one sanctioned exception to "a destructive decision reads the host's `mergedAt` and nothing else."** `CLAUDE.md`'s *One Answer To "Did This Land"* (around line 578) states that rule for remote/host-level decisions. This slice amends that section to name the exception precisely: containment may delete a **local ref**, and only because wave 1 (`refs/plot/reaped/<branch>/<sha>`) pins its tip first — recoverable, unlike a remote delete. It must never extend to a remote ref, a desk, or a phase. Write the amendment as a named exception, not a loosening of the general rule.

**The ancestry-decision marker at `refs-git.ts:763` (`contains`) is currently labeled `plot-ancestry: evidence`, justified by "the caller's age rule decides."** The plan says this slice "corrects the `refs-git.ts:763` marker so it names reap's use, or adds a reap-side declaration." `scripts/check-ancestry-decisions.sh` requires every ancestry call to declare its kind within five lines above it — `contains` is called from multiple sites (dispatch, reap), and the comment today does not name reap's specific use (delete decision, with the pin-first safety net). Check what the gate script actually requires before choosing "correct the existing comment" vs. "add a second declaration at reap's call site" — read `scripts/check-ancestry-decisions.sh` to see whether it reads the port implementation's comment or the call site's.

**The branch kind and the claim kind must agree on "no work of its own" without double-deciding the same branch** (plan Design, third paragraph after Slice 3's lead paragraph). Three cases, already enumerated by the plan:
- Commits past `origin/<default>` that are all empty claim markers (`isWhollyEmptyClaim` is true) → branch kind keeps with `keep — an empty claim; the claim kind decides`; claim kind decides via `firstClaimRefusal`.
- A contained branch with no commits of its own (empty `origin/<default>..<branch>` range, no commit of its own on the default branch's first-parent history) → branch kind keeps after this slice; claim kind also skips it (`isWhollyEmptyClaim` is false on an empty range, `reap.ts:443` on current main). Stays for a person.
- Any commit of its own that is not an empty marker → only the branch kind decides.

Get this wrong and either a branch is silently never reaped (both kinds skip it) or it's reaped twice in a way that produces confusing duplicate rows.

### Done when

The plan's `## Done when` is implicit in Slice 3's description and the Decisions list; treat the "Tests" section's Slice 3 paragraph as the spec:

- Domain unit test: a merged answer with a tip past every merged head and patches not on `origin/<default>` gives a keep reason (not a delete).
- Domain unit test: containment with no commits of the branch's own gives a keep reason.
- Contract test: a scratch repo with a squash-merged branch plus one later commit; `--yes` keeps it, and the commit stays reachable from `refs/heads/<branch>` (i.e. nothing deleted it).
- Contract test (`test/reconcile/sweep.test.mjs`): `a claim-only branch is kept by the branch kind and decided by the claim kind` — asserts exactly one `keep — an empty claim; the claim kind decides` row in the branch section AND the claim section's own row for the same branch (both present, neither branch deleted by the wrong kind).
- Contract test: `a contained branch with no commits of its own is kept by both kinds` — asserts a branch-kind `keep` row and no claim-kind row at all for that branch.

Each of these exists because a naive split of `hasMergedPr` (e.g. "if contains==yes, delete, full stop" or "if host says merged, delete, full stop") passes the *old* tests but fails these new ones — they are the regression tests for the two failure modes this slice exists to close.

Plus: this repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related/changed-file tests and typecheck for whatever package you touch (`packages/board/**`, `packages/domain/**`), plus the gate tests and `scripts/check-*.sh` scripts. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run them locally as a matter of course; a failure there comes back as a correction.

`scripts/check-shell-lines.sh` is not expected to matter here — this slice is TypeScript (`reap.ts`, `sweepable.ts`) plus a `CLAUDE.md` prose amendment, no `.sh` file under `skills/` grows. If a later discovery requires touching a shell script, that growth must be paid for in the same change (remove shell elsewhere, or move the rule into the domain).

### Bookkeeping

Open the PR through the controller once there's a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and titles the PR from the plan's wave heading ("Commits after merge"). Do not run `gh pr create` directly. Push the first real commit as soon as it exists — don't wait for the whole slice to be done before pushing.

When the PR is created, append `→ #<number>` to this branch's line under the `### Commits after merge` heading in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/board/src/server/entry/reap.ts` — `runBranchKind` and the helpers it calls (`hasMergedPr` split, reuse of `prMergedHeads`/`unpushedPatches`, the "commits of its own" check via `firstParentLine`)
- `packages/domain/src/rules/sweepable.ts` — `LocalBranchReadings`, `BranchSweepRefusal`, `branchSweepProblems`/`firstBranchRefusal` as needed to carry the split answer (coordinate with wave 2's `MergedAnswer` shape if it has landed by the time you start — see the note above that wave 2 has no commits yet; check again before writing code)
- `packages/domain/src/adapters/refs/refs-git.ts:763` marker correction (or a reap-side declaration), and whatever `scripts/check-ancestry-decisions.sh` actually demands
- `CLAUDE.md`'s *One Answer To "Did This Land"* section — the new named exception

Other branches in flight on this plan, verified at dispatch time rather than guessed:
- `bug/plot-reap-pins-every-tip-it-deletes` (wave 1, #2850) — touches the same three delete sites in `reap.ts` (`911,1048,1171` on the plan's post-wave-1 numbering) to add pin-before-delete. **This branch's work depends conceptually on wave 1's pinning existing** (the `CLAUDE.md` amendment says containment may delete a local ref "because slice 1 pins its tip") but wave 1 merges first in the plan's wave order, so by the time this branch is picked up for real implementation, wave 1 should already be on `main`. If it is not yet merged, say so rather than guessing at its shape.
- `bug/plot-reap-names-an-unknown-host-answer` (wave 2, #2861) — changes `LocalBranchReadings`'s host-answer field from `boolean hasMergedPr` to a `MergedAnswer` (`merged | not-merged | unknown`) plus refusal kind, in the same `sweepable.ts` file this branch edits. The plan calls this out explicitly: "Slices 2, 3 and 4 all change `runBranchKind` and `sweepable.ts`, and the wave order keeps them from running at the same time." Confirm wave 2 is merged into `main` before starting this branch's edits to `sweepable.ts` — if it isn't, this branch is blocked, not just adjacent.
- `bug/plot-reap-yes-acts-on-the-recorded-run` (wave 4) — not yet started; builds on this branch's split `hasMergedPr`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
