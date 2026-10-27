## Implementation brief — the-reaper-keeps-leftovers-that-no (wave: Deferred desk)

- **Plan (canonical):** `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2758 merged
- **Branch:** `bug/a-deferred-desk-with-a-pushed-head-is-reapable` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (per plan `Review: pr`)

The other two slices of this plan are both merged: #2785 (pid reuse) and #2791
(claim branch). This is the last slice. `main` already carries
`packages/domain/src/rules/branch-given-up.ts` and its `branchGivenUp`
export — this slice reuses it rather than writing a second reading of the
same annotation.

### What to build

#2714: the reaper keeps a desk whose branch a plan has given up (`deferred:`
or `moved:`), even though the branch's head is fully on the remote and
nothing local would be lost by removing the checkout. Two refusals hold it
today, both in `reapProblems` (`packages/domain/src/rules/reapable.ts:111-145`,
called from `packages/board/src/server/entry/reap.ts` around line 780):

- `blocked-marker` — `markerRecordsWork` (`reap.ts:725-745` in the current
  `runWorktreeKind` loop) is set true whenever `origin/<default>..HEAD` holds
  a file-changing commit, pushed or not. A deferred branch with 4 pushed
  commits always sets it true.
- `no-merged-pr` — `MergeReading` is `merged | not-merged | unreachable`, and
  a deferred branch never merges, so this always fires second.

Build: a reapable path through those two refusals, gated on the branch being
given up, fully pushed, clean, and carrying no open PR. On `--yes`, remove
the checkout and its manifest (never the remote ref, never the local
branch except under the fetch-confirmed condition below).

### The decisions the plan settles — do not re-derive them

**Never delete `origin/<branch>`, under any outcome.** The panel's safety
and rootcause jurors both flagged that the plan's own Approach §3 originally
said "removes the desk and its refs", which contradicts the issue text ("the
work stays on the remote branch") and contradicts
`refDeletionProblems` (`reapable.ts:235-254`), which refuses `given-up`
*first*, before any merge check — specifically so that no merge state can
overturn a person's deferral. The plan text you're reading already reflects
the correction: Design §3 says "it never deletes `origin/<branch>`" and
Design's "What given up means" repeats it. Do not reintroduce this — a test
must assert the remote ref survives the reap.

**Reuse `branchGivenUp`, don't write a second "is this given up" reading.**
`packages/domain/src/rules/branch-given-up.ts` already exists (landed with
#2791) and is called from `claimDisposition` in `reap.ts:1034-1069`. It takes
`(branch, plans: readonly PlanBranchLines[])` and returns `true` only when at
least one plan's parser reports the branch's slice `deferred` AND no
Active-index plan still schedules it as an active (non-deferred) slice. That
second half is what tells a slice that *moved and continues on the same
branch* apart from one that's actually abandoned — reuse the same
`claimDisposition`-style plan-reading path (`ctx.plans.readPlans`, filtered
to files whose text contains the branch name) rather than inventing a
third reader of plan annotations.

**The closed-PR condition was considered and dropped — do not add it back.**
Panel disagreement 4 (`.plot/panels/2026-10-27-the-reaper-keeps-leftovers-that-no/panel.md:35`)
was between keeping a "closed-unmerged PR" reading (requiring a new
`Host.prState` call and a Bitbucket `DECLINED`/`SUPERSEDED` mapping) versus
dropping it. The operator dropped it: with `givenUp && unpushed == [] && no
uncommitted work (besides the marker) && no open PR`, removing the checkout
loses nothing whatever the PR's exact closed/declined/superseded state is.
The branch's own name changed from `bug/a-deferred-desk-with-a-closed-pr-is-reapable`
to `bug/a-deferred-desk-with-a-pushed-head-is-reapable` to record that —
see plan Notes. So the only host read this slice needs is the **open-PR**
veto, not a closed-PR confirmation.

**Reading "no open PR": use `ctx.host.prState(branch)` directly, matching
`readPlanPr` in `entry/approve.ts:261-271`.** There is no `Host.openPr()`
verb and none is needed — `prState` already returns a `PrLookup` (`Pr |
null`). The idiom already used three times in this file (`approve.ts`,
`design.ts`, `needs-design.ts`):

```ts
const lookup = await ctx.host.prState(branch);
if (!lookup.ok) { /* unaskable — keep the desk, per plan Design §3 */ }
const openPr = lookup.value !== null && lookup.value.state === 'OPEN';
```

Do **not** use `rules/landed.ts`'s `openPr()` helper here — that function
reads `false` on an unaskable lookup (`readings.open === 'found'`), which is
the right call for its own caller (`plot-pr-merged.sh`'s veto, which already
treats silence as non-veto by design) but is the *wrong* direction for this
slice: the plan's acceptance list is explicit that "an unanswered host"
must keep the desk, not clear it for removal. Read `lookup.ok` directly
instead of routing through that helper.

**"Head on the remote" is the existing `unpushed` reading, not a new one.**
`unpushedCommits` (`reap.ts:435-460`) already measures this. Because a
deferred branch is never `merged`, call it with `merge: 'not-merged'`,
which takes the cheap path — `ctx.trees.unpushedCommits(worktree, [])`
straight from git, no host call, no `prMergedHeads`. `unpushed === []` is
the "head on remote" reading; `'unknown'` keeps the desk via the existing
`unpushed-commits` refusal in `reapProblems`.

**`markerRecordsWork` for this path counts against `origin/<branch>`, not
`origin/<default>`.** The existing worktree loop computes it against
`origin/<default>..HEAD` for the live/mainline path, which is correct there
— it's asking "does this marker sit on work main doesn't have yet." For a
given-up branch that's the wrong question (every one of its 4 commits is
ahead of `origin/<default>` by construction, deferred or not). Add a
second branch of that computation — or a parameter — so the deferred-desk
path asks `fileChangingCommitCount` against `origin/<branch>..HEAD`
instead: zero file-changing commits beyond the pushed head, combined with
the root-marker-only dirty check, is what lets `markerRecordsWork` read
`false` and the marker through to the existing `refused-empty` path
(`reapable.ts:122-128`'s doc comment on `markerRecordsWork === false`).

**Lift exactly two refusals, in `reapProblems`, not by bypassing it.** Add a
`givenUp: boolean` reading to `TreeReadings` (mirroring `RefReadings.givenUp`,
which already exists one struct over) and extend `reapProblems`
(`reapable.ts:111-145`) so that when `givenUp` is true: the `blocked-marker`
push only fires when `markerRecordsWork !== false` (already its exact
condition — no change needed there, since the branch-scoped
`markerRecordsWork` computed above will read `false`), and the `no-merged-pr`
push is skipped when `givenUp` is true (new condition). Every other
refusal — `live-worker`, `uncommitted-changes`, `on-default-branch`,
`unpushed-commits` — stays exactly as ordered today. This is why the panel
called the rule change narrow: it widens one `if` by one condition, it does
not add a new refusal kind.

**Open-PR is a new refusal, not a reuse of `no-merged-pr`.** Add an `openPr:
boolean` reading to `TreeReadings` (same shape as `RefReadings.openPr`,
already defined) and push a new refusal — name it in `ReapRefusal`
(`packages/domain/src/entities/worktree.ts`) and give `reap.ts`'s refusal
switch (around line 793-813) a case for it, e.g. `reason = 'open PR — not
given up yet'`. Only read this field at all when `givenUp` is true (the
host call is otherwise wasted on every live/merged desk the loop already
walks); an unaskable host for this one branch means "keep", which the new
refusal's push must express directly, not by defaulting the field to
`true`.

**Save the marker text to `refusals.tsv` before removal, exactly as the
existing `refused-empty` path does (`reap.ts:745-760`).** This slice's
worktree already carries a `PLOT-BLOCKED` marker (that's one of the two
refusals being lifted), so the removal must go through the same
`markerFile !== ''` branch that writes `.plot/state/refusals.tsv` — it is
not new code, it is making sure the deferred-desk path reaches code that
already exists for the `markerRecordsWork === false` case.

**Delete the local branch only after a fresh fetch confirms nothing
unpushed; otherwise leave it.** Panel disagreement 3
(`panel.md:33`) was between deleting the local branch unconditionally (code
juror) and keeping it as a safety net (safety juror). The plan's Design §3
resolves it: "It deletes the local branch only when `unpushed` is `[]`
against an `origin/<branch>` it fetched in the same run; on a failed fetch
the local branch stays." Fetch `origin <branch>` explicitly in this code
path (the surrounding loop reads `unpushed` from whatever ref state is
already checked out — re-fetch before trusting it for a destructive local
delete) and re-check `unpushedCommits` against the fresh fetch before
calling `ctx.trees.deleteBranch`. The checkout removal (`ctx.trees.removeOnly`)
is unconditional on this; only the *local branch* delete is gated on the
fresh fetch succeeding.

**No ancestry decision.** "Head on the remote" is the `unpushed` commit
count against the branch's own upstream, not `git merge-base --is-ancestor`
against `main` — the code juror's note (`code.md:55`) is explicit that this
slice needs no new ancestry call, and `scripts/check-ancestry-decisions.sh`
will refuse an undeclared one if you add it.

### Done when

The plan's `## Done when` is its acceptance list under "Deferred desk"
(Design, Acceptance section) — lift these into tests:

- A desk on a branch a plan marks `deferred:`, with one file-changing commit
  pushed, head equal to `origin/<branch>`, an untracked root
  `PLOT-BLOCKED.md`, a dead worker and no open PR reads `keep … PLOT-BLOCKED
  marker` today; after the change `--yes` removes the checkout and its
  manifest, saves the marker text to `refusals.tsv`, deletes the local
  branch after a fetch, and leaves `origin/<branch>` present. This is the
  test that fails on `4a1b8a5fa` (the panel's reproduction commit) and must
  pass after.
- Six single-flip keep arms, each catching a wrong removal: an open PR; an
  unanswered host (for the open-PR read); a live worker; a dirty path
  besides the marker; one unpushed commit (the kept row must name its sha,
  matching the existing `unpushed-commits` refusal's `detail`); a branch an
  Active-index plan still schedules as an active (non-deferred) slice.
- The local branch stays when the fetch fails — a seventh arm, distinct from
  the six above because it's about the *local-branch* delete gate, not the
  checkout-removal gate.
- A domain unit test for the widened `reapProblems` (new file or extend
  `packages/domain/test/reapable.test.ts`, per the tests juror's file-naming
  note) covering the `givenUp` + `markerRecordsWork` interaction and the new
  `openPr` refusal, independent of the board entry.

Plus: `pnpm build:board` before running any test that exercises the built
`plot-reap.mjs`, and restore the generated bundle before push — do not
commit it (`scripts/check-no-bundle-diff.sh` refuses a PR carrying it; see
CLAUDE.md's board-artifact-conflict procedure if a rebuild is ever staged by
accident). For tests, run `node packages/board/dist/plot-local-checks.mjs`
(resolved from this repo's root — the plugin-shipped equivalent is
`skills/plot/scripts/board/plot-local-checks.mjs`) before each push, and run
what it prints. The suites listed under the `CI suites` config key in
`CLAUDE.md` run in CI, not locally; a failure there comes back as a
correction, not something to pre-run.

`scripts/check-shell-lines.sh` refuses a PR whose shipped shell under
`skills/` grew past its merge base. This slice is TypeScript-only (domain +
board entry); if you end up touching any `.sh` file, that growth must be
paid for in the same change.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads which plan names this branch and titles the PR from the plan's
slice heading ("Deferred desk"). When it succeeds, append `→ #<number>` to
this branch's line under `## Slices` → `### Deferred desk` in
`docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md`, matching the
`→ #2785` and `→ #2791` annotations already on the other two slices' lines.

Push the first real commit as soon as it exists — this branch has no ref on
origin yet.

### Scope guard

This branch owns:

- `packages/domain/src/rules/reapable.ts` — widen `TreeReadings`/`RefReadings`
  and `reapProblems`, per above
- `packages/domain/src/entities/worktree.ts` — the new `ReapRefusal` case
- `packages/board/src/server/entry/reap.ts` — the readings that feed the
  widened rule (branch-scoped `markerRecordsWork`, the `openPr` host read,
  the fetch-before-local-delete), and the refusal-text switch
- `packages/domain/test/reapable.test.ts` (or a new sibling) and
  `test/reconcile/reap-*.test.mjs` fixtures for this case
- `.changeset/` — one new changeset naming this plan (see `plan:` line
  convention in CLAUDE.md § Versioning)

Both sibling slices (#2785, #2791) are merged and `main` already carries
their changes — nothing here should touch `rules/branch-given-up.ts`,
`rules/sweepable.ts`, `rules/desk-loop-alive.ts`, `rules/agent-state.ts`, or
`plot-worker-state.sh`. `reap.ts`'s `claimDisposition` and `runClaimKind`
(kind 3) are also out of scope — this slice only touches kind 1, the
worktree loop (`runWorktreeKind`).

Out of scope per the plan's own "Out of scope" section: `deskLoopAlive`,
`pidAliveEverywhere`, the registry's `deskPidAlive`/`rowState`, and
`plot-dispatch.sh --release`. Do not touch any of them even if a test
failure seems to point there.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
