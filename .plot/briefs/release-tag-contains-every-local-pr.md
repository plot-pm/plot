## Implementation brief — release-resolution-reads-a-cross-repo (wave 2: Release tag covers every local PR)

- **Plan (canonical):** docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3082 merged
- **Branch:** `bug/release-tag-contains-every-local-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

Wave 1 (`bug/release-pr-reads-local-references`, PR #3087) is merged on `main`. It
changed `releasePr` in `packages/domain/src/rules/release-tag.ts` to return a
`ReleasePrResult` (`local` with every non-deferred local PR number / `all-foreign`
with repos / `none`), and wired `deliver.ts`'s release arm to call it over
`branchClaims` rows. This wave is next in the chain; wave 3
(`bug/scan-release-asks-the-domain`) waits on this one.

### What to build

`packages/board/src/server/entry/deliver.ts:815-824` still narrows `local`
to its single highest number before asking the host — look for the comment
already sitting there: `// prResult.outcome === 'local' — the first local PR
number, as today: tag resolution still reads a single PR's merge commit; wave
2 widens this to every local number.` That comment is wave 1's author handing
you the exact seam. Remove the narrowing: ask the host for **every** local PR
`releasePr` returned, resolve the tag from whichever merged **last** (by
`mergedAt`, never by number), and refuse unless that tag contains **every**
non-deferred local PR's merge commit.

Concretely:
- `releaseTag`'s input (`ReleaseTagReading`) currently models one PR
  (`lastPr`, `mergeCommit`, `containingTags`). Change it to model a set: one
  row per local PR number carrying its `mergeCommit`, `mergedAt`, and
  `containingTags` (read through `Refs.tagsContaining`, same as now — just
  once per PR instead of once per plan). `wantedVersion` stays plan-level.
- `releaseTag` resolves `lastPr`/tag by the row with the latest `mergedAt`
  (string ISO-8601 compare is sufficient — `Pr.mergedAt` is already
  ISO-8601 or `null`; a `null` on a PR `releasePr` already counted as local
  is the existing `no-merge-commit` refusal, now per-row instead of
  plan-wide).
- Add the new refusal `tag-misses-pr`: once a tag is chosen from the
  latest-merged row, check every OTHER non-deferred local row's merge commit
  is also in that tag's containing set. Refuse `tag-misses-pr` naming the PR
  number and the first tag that DOES contain it (mirror the existing
  `tag-does-not-contain`/`tag-mismatch` detail shape — one string naming the
  PR and the repair).
- `deliver.ts`'s `local` branch (`:815-824`) currently does: take
  `prResult.numbers[numbers.length - 1]`, one `ctx.host.prState` call, one
  `ctx.refs.tagsContaining` call. Change to: call `ctx.host.prState` once per
  number in `prResult.numbers` (not just the highest), collect
  `{ number, mergeCommit, mergedAt }` per PR, call `ctx.refs.tagsContaining`
  once per PR that has a `mergeCommit`, then hand the whole set to the
  reshaped `releaseTag`.

### Decisions already settled — do not re-derive them

**Local means unprefixed; that is wave 1's decision, not this wave's to
revisit.** `releasePr` already separates local from foreign. This wave only
widens how many *local* numbers get a tag check — it does not touch the
local/foreign split.

**Resolve the tag from the PR that merged LAST, by `mergedAt`, never the
highest number (decided in the plan's Design § Release tag).** A plan with
local #50 (merged late) and #60 (merged first) must resolve to the tag that
contains #50 — picking by number order would reproduce the exact defect this
plan exists to fix, just one level down (wave 1 fixed cross-repo number
collisions; this wave fixes same-repo mis-ordering). The test
`PR #60 merged before #50, and the tag of #60 does not contain #50, refuses
tag-misses-pr naming #50` is the plan's own regression check for this — it
must fail before your change and pass after.

**One host call per local PR, no more.** The plan prices this explicitly:
"This adds one host call per extra local PR, and a plan with one local PR
costs what it costs today." Don't batch multiple numbers into one
`prState` call (the port doesn't support that) and don't add a call this
plan didn't ask for (e.g. re-reading a PR already answered `none`/refused).

**`all-foreign` already asks no host and reads no tag — leave that branch
alone.** It's wave 1's code (`deliver.ts:803-806` area) and out of this
wave's scope.

### Done when

The plan's `## Done when` is implicit in its `### Tests` section — treat
these as the specification (file: `packages/domain/test/release-tag.test.ts`):

- `#33` + `other/repo#280` still answers local `[33]` — unchanged by this
  wave (wave 1's test), confirm it still passes with the reshaped
  `ReleaseTagReading`.
- **New:** PR #60 merged before #50, both local: `releaseTag` refuses
  `tag-misses-pr` naming #50.
- **New:** both #50 and #60 merged, tag contains both: resolves normally
  from whichever has the later `mergedAt`.
- Keep the existing `resolved`/`no-merge-commit`/`no-tag`/
  `tag-does-not-contain`/`tag-mismatch` cases working for the single-local-PR
  case — they're regression coverage, not dead code, because a plan with one
  local PR is still the common case.

And in `test/reconcile/deliver-release.test.mjs` (shell-level, `gh` stub):
- **New:** PR #60 merged before #50, both local: refuses `tag-misses-pr` and
  writes nothing (`State:` unchanged, no `Released:` line). The stub
  (`test/reconcile/deliver-release.test.mjs:59-73`) needs a per-number merge
  commit AND a per-number `mergedAt` — right now it answers one fixed SHA via
  `GH_STUB_SHA`; extend it to look up both by PR number so two different
  local PRs can carry two different commits and merge times.

Plus: the repo's gates. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it resolves which suites your change touches
(`packages/domain/**` → `pnpm --filter @plot-pm/domain exec vitest related
--run` and `tsc --noEmit`; the reconcile shell test glob). List no full
suite here; the local-checks command is the source of truth for what to run.
This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not
apply.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the
controller once there's something to review:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. When the PR is created, append
`→ #<number>` to this branch's line under the plan's `## Slices` ›
`### Release tag covers every local PR` heading, in the same commit as the
work that opens it.

### Scope guard

**This branch owns:** `packages/domain/src/rules/release-tag.ts` (the
`ReleaseTagReading`/`releaseTag` reshape), `packages/domain/test/release-tag.test.ts`,
the `local` branch of `packages/board/src/server/entry/deliver.ts`'s
`runRelease` (around line 772-824 — read the current file, line numbers will
have drifted since this brief was written), and
`test/reconcile/deliver-release.test.mjs`'s stub and its new cases.

**Leave alone:** `releasePr` itself and the `all-foreign` branch (wave 1,
merged) — do not re-touch `packages/domain/src/rules/cross-repo-reference.ts`.
Scan section 6 (`plot-reconcile-scan.sh`, `plot-release-chain.mjs`) is
wave 3's (`bug/scan-release-asks-the-domain`) — it waits on this branch
merging first, per the plan's own ordering, so don't pre-empt its shell
changes here even though the plan's Design describes them in the same
breath.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
