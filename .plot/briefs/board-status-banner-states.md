## Implementation brief — board-status-banner-offline-tickets-and (wave 1: PR status)

- **Plan (canonical):** docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Branch:** `bug/board-status-banner-states` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the plot-review app, per the repo's `Plan PRs`/review config

Slice 2 (`bug/board-offline-tickets-age-and-rows`) waits on this branch because both edit `packages/board/src/server/fleet.ts`. Slices 3–5 touch disjoint files and run in parallel.

### What to build

The PR status banner reads `prStatus` in `packages/domain/src/rules/pr-status.ts`. Four findings from issue #2477 (#2441, #2463) show the banner stating something the plan table in `docs/plans/2026-10-23-info-vs-warning-vs-error-and.md` does not allow:

1. `prStatus` sets `backoffInSeconds` only where `resetApplies(kind)` is true, which is `quota` only (`refusal.ts:77`). A 429 `secondary` refusal therefore never shows its backoff end. The plan says a 429 and its backoff end appear in the banner. Set `backoffInSeconds` from `input.nextInSeconds` for every refusal kind.
2. `prStatusLevel` returns `error` only when `ageSeconds === null`. The plan table lists "credentials missing" as `error`, and with data on screen the function returns `warning`. Return `error` for missing credentials in both cases.
3. `NOTICE_PATTERNS` ends the credential notice at `read from \S+`. For `… read from the environment` the match stops after `the`, and `environment` stays in the remainder as a false outage cause. Match the whole sentence for every source.
4. `NOTICE_PATTERNS` has no entry for the `BITBUCKET_REVIEW_USER` credential-source notice that the `HostNotice` docstring claims to cover. Read the exact text `plot-host.sh` prints (the credential-source `echo … >&2` lines near `plot-host.sh:1750` and `:2808`, and the Bitbucket review-app path near `:544`) and add a pattern that matches it in full.

Board wording: `packages/board/src/app/lib/agent-rows/host-notes.ts` (about line 446) says *the host reported no failure* while `hostAnswer` reports the host unreachable for the same render. Make the sentence state what the data shows. The comments that say `prIntervalMs` never varies (`host-notes.ts:13`, `fleet.ts` near the `prIntervalMs` field, `schema.ts:4368` area) are false, because `scheduleNextPr` stretches the interval per entry. Rewrite them to describe `scheduleNextPr`.

Re-read each finding against `main` before you edit: the issue's line numbers come from `84b1638e4`.

### Settled decisions — do not re-derive

**The level is a domain property.** The CLAUDE.md rule *Every rendered state is a domain property* applies: decide `error` versus `warning` in `pr-status.ts` and assert it in `packages/domain/test/pr-status.test.ts`. A fix in the `.tsx` or in `host-notes.ts` leaves the unit tests blind to it.

**`resetApplies` keeps its meaning.** It answers *may a RESET time be printed* for the primary limit, and `refusal.ts:77` documents why a secondary limit's primary reset is a different ceiling. Do not widen `resetApplies` to fix finding 1. `backoffInSeconds` reads `input.nextInSeconds`, which is the gate's own backoff end (`backoffUntil`), a different number from the reset. The existing test *"a spender count is dropped for a kind it does not explain"* shows the pattern: fields are dropped per kind on purpose, so check each existing test that asserts `backoffInSeconds` is null for `secondary` or `outage` and change only the ones the plan table overrules.

**Missing credentials has no `RefusalKind`.** `refusalKind` returns `outage` for any message it cannot place, and the existing test *"error row: no data and missing credentials reads outage with no backoff"* feeds `gh: authentication required`. Decide the credential detector once, in the domain, from the host's own wording; do not add a string match in the board. If the detector needs a new field on `PrStatus`, add it there and keep `RefusalKind` closed (`RefusalKind` is also used by the issue footer).

**The notice pattern ends where the notice ends.** The file's existing rule: *any text after a notice stays in the remainder*. A pattern that over-matches would swallow a real failure that follows a notice on the same line, so match the sentence plot-host prints and no more. Add a test whose remainder is a real failure after a credential notice.

**Rules carried over unchanged.** Absent is not false: a null `nextInSeconds` stays null, never `0`. Read the exit code and the wording, not the emptiness. A new function you write is an arrow (`export const f = (…) => …`); the TSDoc states what the export does and how it fails and does not narrate this finding's history.

### Done when

The plan's `## Slices` entry for this branch is the specification: PR status rule, notice pattern and host-notes wording (#2441, #2463). Assertions that exist because a naive implementation would pass without them:

- A `secondary` refusal with `nextInSeconds: 30` reports `backoffInSeconds: 30`. Without it, the fix could set the field only for `quota` again.
- Missing credentials with `ageSeconds: 10` reads `error`, and the same input with `ageSeconds: null` still reads `error`. Without the pair, a fix that only moves the `ageSeconds === null` branch passes one of them.
- `plot-host: JENKINS_USER and JENKINS_API_TOKEN read from the environment` leaves `remainder` null, and a real failure on the next line stays in the remainder. Without it, `environment` stays behind as an outage cause.
- The `BITBUCKET_REVIEW_USER` notice is extracted with its full text.
- The notices-only banner no longer says the host reported no failure while the host is unreachable. Assert it on the sentence `prStatusEntry` returns (a unit test in `packages/board/test/unit/`), not in a browser.

Plus: this slice changes `packages/domain` and `packages/board`, so add a changeset (`'@plot-pm/board': patch` with the description first and the `bumps:` block last; run `./scripts/check-changeset-packages.sh`). Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you find the fix needs `plot-host.sh`, stop and report it, because growth in shipped shell must be paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/pr-status.ts`, `packages/domain/test/pr-status.test.ts`, `packages/board/src/app/lib/agent-rows/host-notes.ts` and the comment lines named above in `packages/board/src/server/fleet.ts` and `packages/board/src/contract/schema.ts`. Keep the `fleet.ts` edit to those comment lines, because slice 2 (`bug/board-offline-tickets-age-and-rows`) edits `fleet.ts` next and rebases on this branch.

Sibling branches in the plan: `bug/board-build-joins-honour-opts` (`fleet-state.ts`), `bug/board-estate-runs-once-per-head` (`board.ts`, `trees-git.ts`) and `bug/board-client-fetch-bound-and-click` (`App.tsx`). None shares a file with this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
