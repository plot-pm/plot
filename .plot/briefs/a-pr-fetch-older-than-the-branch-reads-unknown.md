## Implementation brief — the-board-reads-a-pr-while-its-ci-runs (wave 3: A branch newer than the PR fetch)

- **Plan (canonical):** `docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-pr-fetch-older-than-the-branch-reads-unknown` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 3 of 3, the last. Wave 1 (`bug/a-pending-check-outranks-mergeability`) merged as #1352 and wave 2 (`bug/a-pending-check-is-asked-again`) as #1364. Nothing waits on this branch except `/plot-deliver`.

### What to build

A branch whose tip commit is newer than the last PR fetch reads its PR as `unknown` instead of `none`, so its row stops saying "commits, no PR ever opened".

The failure (#1240), measured 2026-10-03: `infra/agents-md-mirrors-claude-md` read "commits, no PR ever opened" for about 8 minutes while #1239 was open. The cause: `claimedReadings` and `wipReadings` (`packages/board/src/server/fleet.ts`, search `const claimedReadings`) derive `prState` as `pr ? 'open' : hostUnasked ? 'unknown' : 'none'`. `hostUnasked` is `entry.prs === null`, the fetch-never-landed case only. A fetch that landed at 10:00 says nothing about a PR opened at 10:05 for a branch pushed at 10:04, yet it reads as the host's assertion that none exists. `quietKind` turns that `'none'` into `abandoned`, the word that tells a person the branch can be deleted.

Two parts, in this order:

1. **A domain rule in `packages/domain/src/rules/quiet.ts` takes two instants as values** and answers whether the fetch can speak about the branch: the last PR fetch time and the branch's tip commit time. Pure, no clock read, exported from `packages/domain/src/index.ts`. Where the tip is newer than the fetch, `prState` is `'unknown'`; `quietKind` already answers `quiet` for `'unknown'` (arm 4), so no new `QuietKind` word and nothing new crosses the wire.
2. **`fleet.ts` supplies the two instants** to `claimedReadings`, `wipReadings` and the places that call them (`rowQuietKind` at its `state === 'claimed'` and `state === 'wip' && !pr` arms; the `classifyGroup` fallthrough that builds the note). The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The kind and the sentence come from one reading.** The 2026-09-20 defect (`an-unasked-host-is-not-an-absent-pr.test.ts` header) was a row captioned "commits, no PR ever opened" under a kind that declined to claim it, because `classifyGroup` and `rowQuietKind` each derived `prState` on their own. Derive the new reading once, in the domain, and pass the same value to both. A fix in `wipReadings` alone leaves `claimedReadings` and the `rowQuietKind` path wrong. Test the sentence and the kind on the same fixture.

**`hostUnasked` stays as it is.** It is one boolean per entry; this fact is per branch. Do not widen `hostUnasked` into a per-branch value: its positional uses (`fleet.ts` `rowsFromPulse`, the `classify(...)` call with `hostUnasked || held?.state === 'unknown'`, the `:7925` spelled-out defaults) feed the slice verdict, and withholding `eligible` for a branch the fetch simply predates is a different decision that the plan does not make.

**The two clocks are not the same clock — read this before choosing the instants.** `entry.prAt` is epoch milliseconds of the last successful fetch (`fleet.ts`, search `entry.prAt = Date.now()`). `entry.ages` is minutes since each tip, computed in `branchAges` at the moment of the git refresh and stored without that moment. `rowsFromPulse` receives `ages` and a render-time `now`. `now - ageMinutes * 60_000` is therefore wrong: it moves the commit forward by however long the age map has sat in the cache. Either carry the tip's epoch seconds out of `branchAges` (it already reads `%(committerdate:unix)`) or derive it from the time the ages were read. Pick one, state it in the PR, and test with a fixture where the render `now` is minutes after the age read, so the two readings give different answers.

**Absent is not false, in both inputs.** `prAt === null` is already `hostUnasked` and keeps its path. A branch with a `null` age (no readable tip) must not be read as newer or older than anything: keep today's reading for it. The rule never turns a missing instant into `unknown` or into `none`.

**The boundary is strict and named.** "Newer" means the tip is later than the fetch. Equal or earlier reads as today. Test the equal case; a `>=` that nobody tests flips a row at the second the two land together.

**A commit timestamp is the author machine's clock.** A tip dated in the future keeps the row `unknown` until a fetch lands after that date. The plan is silent on a bound. Either accept it and say so in the PR, or cap it (for example, ignore a tip later than `now`). Record the choice; do not leave it implicit.

**The recovery is the next fetch, and it needs no new request.** The PR refresh runs on its own 60 s timer; the row reads `abandoned` again only if a fetch dated after the tip finds no PR. Do not add a refresh trigger, a request, or a change to `PR_REQUESTS_PER_REFRESH`. Wave 2 owns the refresh and is merged.

**Check one thing and report it, do not fix it.** `prAt` is stamped on a partial answer too (`partialSaid` rows are kept and `prError` is set). A partial fetch is weaker evidence of absence than a whole one. If you find the new rule reads a partial fetch as proof, say so in the PR; changing `refreshPrs` is not this branch's scope.

### Done when

The plan's `## Done when` list is the specification. The third item is this branch's: *a branch whose last commit is newer than the PR fetch reads `prState: unknown` and no `abandoned` note; the same branch after a newer fetch with no PR reads `abandoned`.* The first browser-test item shipped in #1352 (`agents-tab.browser.test.ts`); add no second one. The assertions that exist because a naive implementation would pass without them:

- **Both halves in one test.** The same fixture, once with `prAt` before the tip and once with `prAt` after it, must give `unknown`/no `abandoned` and then `abandoned`. A test of only the first half passes on a rule that never answers `abandoned` again.
- **Run it on `origin/main` first and keep the failing output.** Drive `rowsFromPulse` directly, the way `an-unasked-host-is-not-an-absent-pr.test.ts` does. Make the arms disagree: with the same `ages` and a `prs` map holding no entry, only `prAt` may differ between the two cases.
- **The render clock case.** `ages` read at T, render `now` at T+10 min, fetch at T+5 min with the tip at T-1 min: the tip is older than the fetch, so the row reads `abandoned`. A rule that computes the tip as `now - age` calls it newer and fails this.
- **Sentence and kind agree** on a `claimed` branch and on a `wip` branch, both at `unknown`.
- **A branch with an OPEN PR, and a branch with a merged PR, are unchanged** whatever `prAt` and the tip say. It catches a rule applied above the PR and merge arms.
- **The domain rule has a unit test with no browser and no server**, beside `packages/domain/test/quiet.test.ts`, covering `null` for each input and the equal boundary.

Plus: a changeset for `@plot-pm/board` (`patch`), description first and the `bumps:` block last, with `plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md` (copy the shape of `.changeset/a-handed-slice-carries-its-charter.md`). Do not edit versions by hand. `packages/domain` is arrow-function code; a helper you write in `fleet.ts` is an arrow too. Do not commit `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Close the board before `pnpm test:board` and run under Node 24 (`nvm use`).

This slice touches no `.sh` file. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; if you find a reason to touch shell, growth is paid for in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), not `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/quiet.ts`, its export in `packages/domain/src/index.ts`, and its test in `packages/domain/test/quiet.test.ts`.
- In `packages/board/src/server/fleet.ts`: `claimedReadings`, `wipReadings`, the callers that pass them `hostUnasked` (`classifyGroup`'s fallthrough, `rowQuietKind`), the `rowsFromPulse` plumbing for the two instants, and `branchAges` if you carry the tip epoch out of it. Nothing else in the file.
- `packages/board/test/unit/an-unasked-host-is-not-an-absent-pr.test.ts` and its neighbours where they assert the quiet readings.
- The changeset.

Not this branch's:

- `prRowPlacement`, `classifyGroup`'s PR-row group and `prState`: merged in #1352.
- `refreshPrs`, the pending-check re-ask, `PR_REQUESTS_PER_REFRESH` and the PR store fold: merged in #1364.

Both sibling branches are merged, and `git ls-remote --heads origin` returned no ref for this branch on 2026-10-08, so a collision is possible only with unrelated work in `fleet.ts`. Rebase on `origin/main` before the first push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
