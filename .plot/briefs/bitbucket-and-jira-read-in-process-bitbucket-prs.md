## Implementation brief — bitbucket-and-jira-read-in-process (wave 3: in-process Bitbucket PR listing)

- **Plan (canonical):** docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md on `sprint/triggers-and-connectors`
- **Approved:** 2026-11-11, jwloka, plan-PR #3389 merged
- **Branch:** `feature/bitbucket-and-jira-read-in-process-bitbucket-prs` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to the sprint branch
- **Review of the code:** PR review per the repo's `Review: pr` convention

Wave 3 holds this slice and `jira-issues`; the two share no source file. Wave 4's `bitbucket-cutover` waits on this slice. Waves 1 and 2 are merged on the sprint branch (#3401 Jira client, #3402 Bitbucket client), so `bitbucketApi`, `connectorHttps` and `rules/env-file.ts` exist there and not on `main`. Cut from the sprint branch.

### What to build

An in-process answer to `Host.prListing` for a Bitbucket backend. Today one Bitbucket `pr-list` call starts `bash`, two `bb` capability probes, one `bb api` and one `mktemp` per page, `jq`, `node plot-listing-walk.mjs`, and per open row a `git fetch`, `git merge-tree` and `node plot-bitbucket-mergeable.mjs`. Measured on the census, an idle pass on the Bitbucket fixture starts 22 `bb api`, 10 `bb pr`, 10 `bb`, 16.5 `bash plot-host.sh` and 22 `mktemp`. This slice adds the reader and the rules it needs. It does not switch the transport: `IN_PROCESS_BACKENDS` stays `['github']` (`adapters/host/host-reads.ts:12`), and the cutover slice flips it.

Build, in `packages/domain/src/`:

- `adapters/host/bitbucket-pr-listing.ts`: answers `prListing` over the existing `bitbucketApi` (`adapters/host/bitbucket-api.ts`). It sends the requests `plot-host.sh` sends: `pullrequests?state=<S>&pagelen=50` walked to the limit by `walkToLimit` (`adapters/host/listing-paging.ts`, `envelopeNextFor`); per branch and state `q=state="<S>" AND source.branch.name="<b>"`, with `AND updated_on>="<since>"` where a window is asked (`bb_branch_query`, `plot-host.sh:1201`); and the window `q=state="<S>" AND updated_on>="<since>"`, read to the end and refused where it holds fewer rows than `size` (`bb_window_listing`, `:1360`). `all` maps to `open`, `merged`, `declined` (`bb_states_for`, `:2587`). The request count stays the shell's.
- `rules/bitbucket-pr-row.ts`: the row projection of the `pr-list` Bitbucket arm (`plot-host.sh:4846-4975`): `DECLINED` to `CLOSED`, `mergedAt` from `updated_on` on a `MERGED` row, `checks` `unknown`, `review` empty.
- A sweep completeness rule beside `pagePossiblyTruncated` (`rules/listing-page.ts`), copying `pr_sweep_report` (`plot-host.sh:1557`).
- Mergeability: fold `mergeable` with `foldBitbucketMergeable` (`rules/bitbucket-mergeable.ts:91`) over git inputs read through the `Refs` port, reading `origin/<base>` as the scan's `git fetch --prune` left it. Keep the answer per (head SHA, base SHA) in memory. An absent base ref answers `unknown` with a reason.
- A recorder script that captures `bb api` pages, and `packages/domain/corpus/bitbucket-pr-listing.corpus.test.ts` (model: `github-pr-listing.corpus.test.ts`).

### Settled decisions — do not re-derive them

- **The request count stays the shell's.** One query with `source.branch.name="a" OR …="b"` would cut requests but changes completeness, not processes, and needs its own corpus. Decided 2026-11-10, out of scope.
- **Mergeability reads the last fetch (option B), not a fetch per read.** The answer is a function of the two SHAs. Option A (fetch under a 10 s watcher and `git merge-tree` per row on every rich read) keeps about 3.5 `git` images per idle pass, and Phase 8 removes the per-pass fetch anyway.
- **Credentials come from the environment or `.env` only, and the client runs no `security` call.** This slice consumes `bitbucketApi`; it adds no credential logic. With none, the cutover keeps the shell.
- **Budget account is the workspace** (`rules/bitbucket-budget-account.ts`, already merged). Do not change the key.
- **Jenkins colours.** The rich open read overlays Jenkins colours on the shell (`_bb_jen_bind`, `plot-host.sh:4931`). The cutover slice, not this one, splits `CI: jenkins`. Do not wire any `CI` branch here.
- **A refused `next` link outside the base URL is a refusal** (`_bb_paged_walk`, `plot-host.sh:1173`). `bitbucketApi` already returns it as `BitbucketNext`; do not follow such a link.
- **Rules carried over, not re-learned.** Absent is not false: a missing row in a partial read never means "no PR". A walk refused mid-way is never whole: it returns the rows read, reads `possibly-truncated` and carries the refusal. Read the status and the notice, not the emptiness. The three completeness claims (row-limit walk's `next`, the sweep's, the window's refusal of a short read) must each survive; a second transport that drops one reads a truncated answer as whole and nothing fails.
- **Declared duplicates cost a corpus row.** Every rule copied out of `plot-host.sh` joins `packages/domain/corpus/`. On a disagreement the branch stops; do not adjust either side to make the comparison pass (`CLAUDE.md`, *A Shell Script Asks The Domain*).

### Done when

The plan's `## Done when` rows for slice *Bitbucket PR reads* are the specification:

| Claim | Check |
|---|---|
| Both Bitbucket transports return the same rows | `bitbucket-pr-listing.corpus.test.ts`: every row field and every per-state completeness word agree on every recording |
| A walk refused mid-way is never whole | a stub-server row: page 2 of 3 fails; the answer holds page 1's rows, reads `possibly-truncated` and carries the refusal |
| An idle pass starts no merge-tree for unchanged PRs | a listing row: a second read over the same head and base SHAs asks the `Refs` port nothing |
| A change in any rule-read field is a change | one row per `PrIndexRowSchema` field the Bitbucket projection sets: that field alone changed yields `changed: ['prs']` from `recordReading` |

Assertions a naive implementation passes without, and what each catches:

- The recordings hold a draft, a declined row, a merged row, a walk of more than one page, a `next` outside the base URL, a sweep of three branches and a short window. Without the multi-page and short-window recordings the truncation claims go untested.
- A corpus run with no completeness-word comparison passes while a truncated read reads whole.
- The corpus tier reads recordings only and runs with no host token (`corpus/no-host-token.ts`); a corpus test that calls `bb` live fails in CI.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base; this slice should touch no `.sh` file, and if it does, pay the growth in the same change. Add a changeset for `plot` if the slice changes shipped behaviour (none expected, as no transport switches). Do not commit a rebuilt board bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `adapters/host/bitbucket-pr-listing.ts`, `rules/bitbucket-pr-row.ts`, the sweep completeness rule in `rules/listing-page.ts` (or a neighbour), the recorder, `corpus/bitbucket-pr-listing.corpus.test.ts` and its fixtures, and the per-field change rows. It must not edit `host-reads.ts` or `IN_PROCESS_BACKENDS` (cutover), `adapters/tracker/` or any Jira file (`jira-issues`, same wave), or `packages/fleet/test/census/` (cutover). Wave 4's `bitbucket-cutover` builds on this slice's exported listing factory, so keep its signature parallel to the GitHub one in `host-reads.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
