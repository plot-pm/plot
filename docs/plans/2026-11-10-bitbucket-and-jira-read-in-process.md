# Bitbucket and Jira read in-process

> fleetd reads Bitbucket and a Jira tracker over Node's HTTPS client inside their connector adapters, not through one `plot-host.sh` process tree per question: the Bitbucket listing pair, its branch-sweep retry, the PR index refresh and the merged set, and the four Jira reads of the issue gate. Each connector keeps its own credentials, account, budget and rate-limit bookkeeping, every rule copied out of `plot-host.sh` is a declared duplicate with a corpus test, and `PLOT_HOST_TRANSPORT=shell` is the way back. Jenkins stays on the shell; a later plan moves it.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** triggers-and-connectors
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-11, jwloka, plan-PR #3389 merged
- **Started:** 2026-11-11, Jan Wloka, `feature/bitbucket-and-jira-read-in-process-bitbucket-prs`
- **Started:** 2026-11-12, Jan Wloka, `feature/bitbucket-and-jira-read-in-process-jira-issues`
- **Started:** 2026-11-12, Jan Wloka, `feature/bitbucket-and-jira-read-in-process-bitbucket-cutover`

## Changelog

- On a Bitbucket repository, fleetd asks Bitbucket for pull requests from inside its own process. An idle fleetd pass starts no `bash`, `bb`, `jq` or `node` process for these reads, and the answers, the completeness claims and the rate-limit record stay the same.
- With a Jira tracker, fleetd reads the open, closed, changed and inbox issues from inside its own process. An idle fleetd pass starts no `curl` and no `plot-host.sh` process for these reads.

Board impact: none on the plan format, the template, the helper scripts or the `docs/plans` layout. The board reads the same `prs` and `issues` readings over the channel; `plot-host.sh` keeps every Bitbucket and Jira op for the shell consumers, the writes and the merge path.

## Motivation

Phase 7 of the story *Nothing changed, nothing runs* says: Plot reads Bitbucket (`bb`), Jenkins (`jen`) and a separately configured issue tracker such as Jira (`issue-refresh.ts`); each read starts a CLI process today, and `readBitbucketListing`'s refused-delta retry starts one `pr-list --branch` per tracked branch. One plan per connector moves its reads into the connector adapter over Node's HTTPS client. The story orders the connectors by use in the operator's repositories, Bitbucket and Jira first for ewz-kus-portal. This plan covers Bitbucket and Jira. Jenkins stays for a later plan (`jenkins-reads-in-process` in the story's *Candidate Plans*).

Line numbers below are on `origin/sprint/desk-probes-and-liveness` at `38411b761`.

fleetd asks Bitbucket and Jira through `plot-host.sh` today:

| Read | Caller | Route today |
|---|---|---|
| The scan's listing: a full sweep `pr-list --state open --rich --branch <b>…` and `--state all --branch <b>…`, or a delta `--state open --rich --limit 49` and `--state all --since` | `readBitbucketListing`, `packages/fleet/src/shared/fleet-scan.ts:635-672`; sweep at `:643-648`, delta at `:649-653`, retry at `:655-659` | `askPrList` (`:497`) → `Scripts.hostSaid(['pr-list', …])` |
| The PR index refresh and its re-ask of open rows | `packages/fleet/src/shared/pr-refresh.ts:1477`, `:1603` | `Host.prListing` → `host-shell.ts` → `plot-host.sh pr-list` |
| The merged set and its `--since` delta, `--limit 50` on Bitbucket | `mergedBranches`, `packages/fleet/src/server/entry/registryd-main.ts:893`, `:910`, `:916`, `:958` | `Host.prListing` → `host-shell.ts` → `plot-host.sh pr-list` |
| The issue gate's Jira reads: changed, open, closed, inbox | `refreshIssueIndex`, `packages/fleet/src/shared/issue-refresh.ts:448`, `:525`, `:529`, `:538` | `trackerJira` (`packages/domain/src/adapters/tracker/tracker-jira.ts:120`) → `trackerReads.walk` (`tracker-shell.ts:285`) → `plot-host.sh issue-list` → `curl` |
| The issue gate's account and project scope | `tracker.spender()` (`issue-refresh.ts:422`), `projectsRead` (`tracker-jira.ts:137`) | `plot-host.sh spend-rate --connector jira` (`tracker-shell.ts:436-438`), `plot-host.sh ticket-projects` (`plot-host.sh:5763`) |

Inside `plot-host.sh`, one Bitbucket `pr-list` call starts `bash`, a `bb --version` and a `bb pr list --help --json` capability probe (`bb_require_json`, `plot-host.sh:2819`, `bb_identify`, `:2731`), one `bb api` per page through `_bb_paged_walk` (`:1173`), `bb_branch_query` per branch and state (`:1201`, `bb_branch_sweep` at `:1273`) or `bb_window_listing` (`:1360`), `jq` per page, `node plot-listing-walk.mjs` for a row-limit walk, and for each open row `bb_fold_mergeable` (`:2167`): one `git fetch` per base under a 10 s watcher (`bb_fetch_base_bounded`, `:2121`), `git cat-file -e`, `git merge-tree` and `node plot-bitbucket-mergeable.mjs`. `bb_states_for` (`:2587`) maps `--state all` to three walks: `open`, `merged` and `declined`. One Jira `issue-list` call starts `bash`, `plot-config.sh` for the base URL and the projects, one `curl` (`jira_curl`, `:3097`) and several `jq`.

**The census.** Every figure is `execve` per idle fleetd pass, from the Linux census in CI:

| Fixture | `main` `be7537152` (run 42868842876) | Sprint head `38411b761`, PR #3380 (run 42874101153) |
|---|---|---|
| S4, GitHub, 0 desks, 5 open PRs | 1126.5 (merge base 1126.5) | 516 (merge base 1103.5) |
| S4, GitHub, 3 desks, 5 open PRs | 2587.5 (merge base 2587.5) | 839 (merge base 2552.5) |
| S4, Bitbucket, 3 desks, 5 open PRs | 2684 (merge base 2674) | 1879 (merge base 2519) |

The two merge-base readings of the Bitbucket row differ by 6 % (2674 and 2519); the gate's tolerance is 10 % + 2. On the sprint head, the Bitbucket fixture starts 1040 more images per idle pass than the GitHub fixture with the same 3 desks and 5 open PRs. The GitHub fixture reads PRs and issues in-process since `github-reads-in-process`; the Bitbucket fixture reads PRs through `bb` and issues through Jira's `curl` (`packages/fleet/test/census/sandbox.ts:81`, `:251`). So 1040 is the upper bound that both cutovers of this plan move together.

The census command map (`census-report-head`, run 42874101153) names, per idle pass on the Bitbucket fixture: 22 `bb api`, 10 `bb pr` and 10 `bb` (the two capability probes), 16.5 `bash plot-host.sh` (8 on the GitHub fixture), 22 `mktemp plot-host-paged-walk`, 4 `node plot-listing-walk.mjs`, 2.5 `git merge-tree`, 2.5 `node plot-bitbucket-mergeable.mjs`, 0.5 `git fetch`, 0.5 `sleep 10`, 2 `node plot-issue-source.mjs` and 1 `curl`. The text tools that `plot-host.sh` and its budget appender start are most of the rest: against the GitHub fixture, `rm` +164.5, `tr` +147.5, `tr \t\r\n` +111, `sed g` +84, `awk` +79.5, `mkdir` +79.5, `jq` +77, `ln` +38.5 and `dirname budget.tsv` +37 per pass. The map is flat, so it does not split the 1040 between Bitbucket and Jira; each cutover's PR states its measured share.

**Rate limits, measured 2026-11-10.** An unauthenticated `GET https://api.bitbucket.org/2.0/repositories/atlassian/aui/pullrequests?pagelen=1` answered `200` with `x-request-count` and no `X-RateLimit-*` header. An unauthenticated `GET /rest/api/2/serverInfo` on a Jira Cloud instance answered `200` with no rate-limit header. The shell records Bitbucket as `predicted` with limit 1000 (`budget_reading`, `plot-host.sh:3613`) and Jira as `unknown` (`budget_record_jira`, `:3157`). An authenticated answer may carry headers that these probes did not see; the Client slices measure it.

**Credentials, measured on the operator's machine 2026-11-10.** `bb 1.13.0 (quatico-bb)` reports `credentials: keychain (com.quatico.bitbucket-cli)` in `bb whoami`; `bb auth login --help` names `BB_TOKEN` and `BB_EMAIL` as the override variables, and `bb` has no command that prints a token (`bb auth token` answers `unknown auth command`). Jira reads `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment, and otherwise from the worktree's or the main checkout's `.env` (`jira_load_env_file`, `plot-host.sh:3079`; `plot_env_file`, `:3044`; `read_env_var`, `:3017`). `plot-bitbucket-commit-status.mjs` already reaches Bitbucket over HTTPS with Basic auth, a `.env` reader (`readEnvVar`, `:108`) and `BITBUCKET_API_BASE` (`:44`), for a separate review identity.

The risk is high and silent, as for GitHub. Three Bitbucket completeness claims decide whether a missing row means "no PR" or "not read": the row-limit walk's `next`-based claim (`pr_list_report_truncation`, `plot-host.sh:3266` and after; `walkToLimit`, `packages/domain/src/adapters/host/listing-paging.ts:55`), the per-branch sweep's claim (`pr_sweep_report`, `plot-host.sh:1557`), and the window's refusal of a short read (`bb_window_listing` refuses when it read fewer rows than `size`). Jira has its own: an unpaged open or inbox read above one page is refused (`ISSUE_PAGE_ROWS=100`, `plot-host.sh:667`), and an unscoped closed, changed or version read exits 4 before any request. A second transport that drops one of these reads a truncated answer as whole, and nothing fails.

## Design

**This plan depends on `github-reads-in-process`** (delivered on `sprint/desk-probes-and-liveness`, PR #3380 open). `origin/sprint/triggers-and-connectors` at `f6f26feab` is cut from `main` and holds no `packages/domain/src/adapters/host/github-api.ts`, `host-reads.ts` or `rules/host-transport.ts`. No slice starts before #3380 merges into `main` and `main` merges into the sprint branch. `triggers-replace-the-tick` (Phase 8) is written beside this plan; this plan arms no watch and changes no cadence. Both plans change census counts and may touch `packages/fleet/test/census/` (`census-rows.ts`, `stub-host.ts`, `sandbox.ts`, `fleetd.census.test.ts`), so the second to merge rebases its fixture change and states its own measured delta.

### Approach

**The model is `github-reads-in-process`.** Its slices give the order here: a typed read first, then a client per connector, then the reads, then a cutover that a census row holds. The Bitbucket and Jira chains are independent after the shared transport, so each wave holds one Bitbucket slice and one Jira slice where both exist.

**Slice 1: the shared transport (no transport change for any read).**

- `adapters/host/connector-https.ts` holds what `githubApi` (`github-api.ts:218`) does for every request and what is not GitHub's: the proxy agents built from `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (`github-api.ts:158`, `:230-238`), the 30 s request bound (`REQUEST_BOUND_MS`, `:19`), the host slot through the `Slots` port, one `BudgetEntry` per request through `BudgetRecord` with the ledger rotation of `rules/budget-rotation.ts`, and the mapping of `429` with `Retry-After` to the `throttled` observation. The caller passes the connector word, the account, the bucket and the reading basis; the module chooses none of them.
- `githubApi` moves onto it. Every existing client row and the GitHub corpus pass unchanged.
- `rules/env-file.ts` reads one variable from a `.env`-shaped text with the strip order of `read_env_var` (`plot-host.sh:3017-3023`), and picks the worktree's `.env`, then the main checkout's, where the file holds both named variables (`plot_env_file`, `:3044`). The main checkout comes from the memoised `PLOT_GIT_COMMON_DIR` (`adapters/git-dirs`, `FIXED_ENV_KEYS`), so the read starts no `git`. It is a declared duplicate: `packages/domain/corpus/env-file.corpus.test.ts` runs `read_env_var` and the rule over the same lines (`export `, quotes, trailing whitespace, a duplicated name) and names both answers on a disagreement.
- This slice moves no census row: S4 on both GitHub fixtures stays within the gate's tolerance, and P5 stays green.

**Slice 2: the Bitbucket seam (no transport change).**

- `PrListingQuery` (`ports/host.ts`) gains `branches`, the tracked branches a sweep asks. `host-shell.ts` answers a query with `branches` from `plot-host.sh pr-list --branch <b>…`, and a query with `since` on Bitbucket from the windowed listing, and reads the sweep's and the window's notices into the completeness words.
- `readBitbucketListing` calls `Host.prListing` through `askPrListing` (`fleet-scan.ts:531`), as `readGithubListing` does. `askPrList` (`:497`) and its `Scripts.hostSaid(['pr-list', …])` call end, so no fleet caller reads `pr-list` stdout.
- `host-shell.ts` answers the refusal kind `auth` where `bb` exits on a `401`, as the GitHub seam does for `gh`.
- This slice moves no census row: S4 on the Bitbucket fixture stays within the gate's tolerance.

**Slice 3: the Bitbucket client.**

- `adapters/host/bitbucket-api.ts` is the one module that builds requests to the Bitbucket API, over `connector-https.ts`. It takes the base URL from `BITBUCKET_API_BASE` (default `https://api.bitbucket.org/2.0`), as `plot-bitbucket-commit-status.mjs:44` does, and the workspace and repository from the `origin` remote through `rules/remote-slug.ts:20`. It refuses a `next` link outside the base URL, as `_bb_paged_walk` does (`plot-host.sh:1173`).
- **Credentials.** The client reads as the identity `bb` reads as. It takes `BB_EMAIL` and `BB_TOKEN` from the environment (the override pair `bb auth login --help` names), then from `.env` through `rules/env-file.ts`, and from nowhere else: it runs no `security` call and no other process to find a credential (Open Question 2). With no credentials in either place, the Bitbucket reads stay on the shell transport, and fleetd logs that once, with the reason. On a machine whose `bb` keeps its token only in the macOS Keychain (`com.quatico.bitbucket-cli`, as on the operator's machine), the operator puts `BB_EMAIL` and `BB_TOKEN` in the main checkout's `.env` to get the saving. It sends Basic auth in a header only, never in argv, a file or a log line. On a `401` it reads the environment and `.env` once more and retries once, so a new token takes effect with no fleetd restart; a second `401` is a refusal of kind `auth` whose `said` names the source and the fix.
- **Account, bucket and basis.** Every entry carries the connector `bitbucket`, the bucket `api` (`budget_bucket`, `plot-host.sh:3580`) and the account of Open Question 3. An answer with `X-RateLimit-Limit` and `-Remaining` records basis `actual`; an answer with none records `predicted` with limit 1000, as `budget_reading` does (`:3613`). The slot bound follows `host_concurrency_bound` (`:3815`) over the same reading. The PR states which headers an authenticated answer carried on one real repository, read-only.
- **The census sees the new transport.** `packages/fleet/test/census/stub-host.ts` gains a Bitbucket route on the stub server (`startStubApi`, `:283`) that serves the same recorded pages as the stub `bb`, and the sandbox sets `BITBUCKET_API_BASE`, `BB_EMAIL` and `BB_TOKEN` to fixture values on the Bitbucket fixture.
- The gate `scripts/check-host-https-callers.sh` adds `api\.bitbucket\.org` and `BITBUCKET_API_BASE` to its pattern (`:41`). The allowed paths stay `adapters/host/` and the named files (`:43-48`).

**Slice 4: the Jira client.**

- `adapters/tracker/jira-api.ts` builds requests to the Jira REST API over `connector-https.ts`, so it imports no `node:https` and the gate's allowed paths do not change (Open Question 6). It takes the base URL from `PLOT_JIRA_BASE_URL`, else the second token of the `Tracker` config value with trailing `/` removed (`tracker_base_url`, `plot-host.sh:2940`).
- **Credentials.** `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment, then from `.env` through `rules/env-file.ts` where both are unset, as `jira_load_env_file` does (`:3079`). With neither, the read answers `failed` with the sentence of `jira_require_config` (`:3088-3094`), never an empty list. A `401` re-reads the source once and retries once; a second `401` is a refusal of kind `auth`. The read starts no process: the environment and `.env` are file reads.
- **Account and basis.** The account is `jira:` and the first 12 hex digits of the SHA-256 of `JIRA_EMAIL`, or `unknown` (`jira_budget_account`, `:3144-3155`), as `rules/jira-budget-account.ts`, a declared duplicate with a corpus row. The email never reaches the ledger. Each request appends one entry with connector `jira`, bucket `api` and basis `unknown`, as `budget_record_jira` does (`:3157-3160`), unless the answer carries rate-limit headers. A `429` maps to `throttled` with the `Retry-After` wait.
- **The census sees the new transport.** The stub server gains a Jira route that serves the recorded `search/jql` answers the `curl` stub serves (`jiraCurlStub`, `stub-host.ts:97`), and the sandbox sets `PLOT_JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` to fixture values.

**Slice 5: the Bitbucket PR reads.**

- `adapters/host/bitbucket-pr-listing.ts` answers `prListing` for a Bitbucket backend. It sends the requests `plot-host.sh` sends: `pullrequests?state=<S>&pagelen=50` walked to the limit by `walkToLimit` (`listing-paging.ts:55`, `envelopeNextFor` at `:79`); per branch and state, `q=state="<S>" AND source.branch.name="<b>"`, with `AND updated_on>="<since>"` where a window is asked (`bb_branch_query`, `plot-host.sh:1201`); and the window `q=state="<S>" AND updated_on>="<since>"`, read to the end and refused where it holds fewer rows than `size` (`bb_window_listing`, `:1360`). It maps `all` to `open`, `merged` and `declined` (`bb_states_for`, `:2587`). The request count per read stays the shell's.
- **The declared duplicates.** The row projection of the Bitbucket `pr-list` arm (`plot-host.sh:4846-4975`: `DECLINED` to `CLOSED`, `mergedAt` from `updated_on` on a `MERGED` row, `checks` `unknown`, `review` empty) becomes `rules/bitbucket-pr-row.ts`. The sweep's completeness claim becomes a rule beside `pagePossiblyTruncated` (`rules/listing-page.ts`). `packages/domain/corpus/bitbucket-pr-listing.corpus.test.ts` feeds one set of recorded `bb api` pages to both transports and compares every row field and every per-state completeness word; a recorder script captures the pages, and the corpus tier reads recordings only (`packages/domain/corpus/no-host-token.ts`). The recordings hold a draft, a declined row, a merged row, a walk of more than one page, a `next` outside the base URL, a sweep of three branches and a short window.
- **Mergeability.** The in-process read folds `mergeable` with `foldBitbucketMergeable` (`rules/bitbucket-mergeable.ts:91`) over git inputs read through the `Refs` port. It reads `origin/<base>` as the scan's `git fetch --prune` left it, and keeps the last answer per pair of head SHA and base SHA in memory, so a pass over unchanged PRs starts no `git merge-tree` (Open Question 5).
- **"Differs" covers every field a rule reads.** One row per `PrIndexRowSchema` field that the Bitbucket projection sets: that field alone changed in one recorded answer yields `changed: ['prs']` from `recordReading`.

**Slice 6: the Jira issue reads.**

- `trackerJira`'s four reads that the issue gate makes (`issueListOpen`, `issueListClosed`, `issueListChanged`, `issueListInbox`) call `jira-api.ts`. The query is the one the `issue-list` Jira arm sends (`plot-host.sh:5268-5550`): `GET /rest/api/2/search/jql` with `jql`, `fields`, `maxResults` and `nextPageToken`. `issueView`, `versionRead` and every write (`issue-status`, `issue-open`) stay on `plot-host.sh`: operator commands start them, not an idle pass.
- **The declared duplicates.** The JQL builder becomes `rules/jira-jql.ts`: the project scope `AND project IN (…)` from `Ticket prefixes` (`tracker_projects`, `:2991`), the person clause that drops once a scope exists (`:5287-5290`), the open query (`:5324`), the closed query with `resolved >=`, the inbox query, the changed query with its relative `-Nm` time plus 5 minutes (`:5359`), `PLOT_JIRA_JQL` winning over the open and inbox queries, and the refusal of an unscoped closed or changed read. The row projection (key as `number`, `/browse/<key>` as `url`, `status` and `statusCategory`, `closedAt` from `resolutiondate`) becomes `rules/jira-issue-row.ts`. `packages/domain/corpus/jira-issue-reads.corpus.test.ts` runs the shell arm against a recording `curl` stub and the in-process read against the stub server over the same recorded answers, and compares the JQL, every issue field, the page token and the completeness of each read.
- **No process for the gate's own questions.** `projectsRead` reads `Ticket prefixes` from the config reading with the split rule of `tracker_projects` (commas, trimmed, empties dropped), and `spender()` answers the account from `rules/jira-budget-account.ts`. Neither starts `plot-host.sh`.
- The three outcomes stay apart: an empty list, a failed request and `unaskable` (no `Ticket prefixes` for a scoped read).

**Slice 7: the Bitbucket cutover.**

- `IN_PROCESS_BACKENDS` (`adapters/host/host-reads.ts:12`) gains `bitbucket`, and `hostReadsFor` (`:116`) builds the Bitbucket client and listing where the backend answers `bitbucket` and the client resolves credentials; the shell reads otherwise. `PLOT_HOST_TRANSPORT=shell` (`rules/host-transport.ts:2`) forces the shell for both hosts.
- **Jenkins colours.** Where `CI` is `jenkins`, the rich open read stays on the shell, because the Bitbucket `pr-list` arm overlays Jenkins colours on it (`_bb_jen_bind`, `plot-host.sh:4931`), and the plain reads (`--state all`, the merged set, the sweep's `all` half) go in-process (Open Question 4, decided). A Jenkins plan moves the rich open read later.
- fleetd logs the transport, its reason and the credential source once at start, publishes it with its heartbeat, and `/plot-fleet --status` prints it, as for GitHub. The board's own reads (`plot-pr-reader.mjs` with no fleetd) take the same composition.
- A green per-source census row `P10: an idle fleetd pass on Bitbucket starts no plot-host.sh pr-list and no bb` (`census-rows.ts`, `green: true` from this slice) reads the strace tree by argv, and a stub-server count holds that the in-process requests per idle pass do not exceed the shell's `bb api` calls on the same fixture, measured with `PLOT_HOST_TRANSPORT=shell` as the P5 baseline is (`fleetd.census.test.ts:133-156`).
- S4 on the Bitbucket fixture runs against the merge base, and the slice records the number in the story's *Measures*. The expected delta is several hundred `execve` per idle pass, inside the 1040 upper bound above; the PR states the measured figure and how many images each read removed.

**Slice 8: the Jira cutover.**

- The tracker composition (`trackerFor`, `adapters/tracker/tracker-resolve.ts:44`; `trackerOfSource`, `:169`) builds `trackerJira` over `jira-api.ts` where the declared tracker is `jira` and the client resolves credentials, and over the shell otherwise. `PLOT_HOST_TRANSPORT=shell` forces the shell for the tracker too (Open Question 7).
- fleetd's start log and `/plot-fleet --status` name the tracker transport and the credential source.
- A green per-source census row `P11: an idle fleetd pass with a Jira tracker starts no curl and no plot-host.sh issue-list, ticket-projects or spend-rate --connector jira` (`census-rows.ts`, `green: true` from this slice), and a stub-server count that holds the Jira requests per issue pass to the shell's `curl` calls.
- S4 on the Bitbucket fixture runs against the merge base, and the slice records the number in the story's *Measures*.

**What stays.** `spend-rate` through `plot-host.sh` at three sites (`registryd-main.ts:494`, `pr-refresh.ts:715`, `fleet-scan.ts:327`) stays named residue, as in `github-reads-in-process`. The AgentMonitor's per-desk `pr-state` call belongs to `liveness-token`. `bb` and `curl` stay for every op that is not a fleetd read. S4 reaches 0 only with Phase 8.

### Open Questions

- [x] **Jira in this plan or in its own.** The story names `bitbucket-reads-in-process` and `tracker-reads-in-process` as two candidate plans. Both share Slice 1, the census fixture and one review; the two chains share no other source file, and each cutover merges alone. Recommendation: one plan with two slice chains, so the shared transport and the `.env` rule land once. **Decided 2026-11-10, jwloka: one plan with two slice chains.**
- [x] **Where the Bitbucket client finds credentials on a machine that keeps them in the Keychain.** The operator's `bb` keeps its token in the macOS Keychain item `com.quatico.bitbucket-cli`, and Node cannot read the Keychain without a process. Option A: `BB_EMAIL` and `BB_TOKEN` from the environment or `.env` only; a machine with neither keeps the shell route, and the start log and `/plot-fleet --status` name the reason. Option B: A, then one `security find-generic-password -s com.quatico.bitbucket-cli -w` at start and on a `401`, which *Target Shape* allows as a process in answer to a trigger; the slice first measures the item's format, which is `bb`'s private contract. Recommendation: B, because the operator's machine holds only the Keychain item, and A would move nothing there. A person decides. **Decided 2026-11-10, jwloka: option A. The client reads `BB_EMAIL` and `BB_TOKEN` from the environment or `.env` and runs no `security` call and no other process. With no credentials there, the Bitbucket reads stay on the shell transport, and fleetd logs that once with the reason. An operator whose `bb` keeps its token only in the Keychain puts the token in `.env` to get the saving.**
- [x] **The Bitbucket budget account.** The shell keys Bitbucket lines on the `origin` remote's owner, the workspace (`budget_account`, `plot-host.sh:3521-3527`). `github-reads-in-process` chose the token's login for GitHub. Option A: the workspace, as `rules/bitbucket-budget-account.ts`, a declared duplicate with a corpus row, so shell and in-process lines meet in one key and the issue gate's `holdsFor` (`issue-refresh.ts:320-328`) compares one account. Option B: the login of `GET /2.0/user` once per credential. Recommendation: A in this plan; a change of the key belongs to both transports in one later change. **Decided 2026-11-10, jwloka: Option A: the workspace, as `rules/bitbucket-budget-account.ts` with a corpus row.**
- [x] **Bitbucket with `CI: jenkins`.** ewz-kus-portal reads its CI from Jenkins. The rich open read overlays Jenkins colours (`plot-host.sh:4931-4961`), so moving it before Jenkins moves would read `checks: none` on every row. Option A: a Bitbucket repository with `CI: jenkins` keeps the shell for every read, as a GitHub repository with `CI: jenkins` does (`SHELL_CI`, `host-reads.ts:15`). Option B: the plain reads go in-process and the rich open read stays on the shell until `jenkins-reads-in-process`. Recommendation: B, because A moves no Bitbucket read in the repository the story names first. A person decides. **Decided 2026-11-10, jwloka: option B. The plain reads move in-process; the rich open read stays on the shell until a Jenkins plan moves it.**
- [x] **Mergeability without a fetch per read.** The shell fetches each base under a 10 s watcher and runs `git merge-tree` per open row on every rich read (`plot-host.sh:2121-2185`). Option A: the in-process read does the same through the `Refs` port, so an idle pass keeps about 3.5 `git` images. Option B: it reads `origin/<base>` as the scan's `git fetch --prune` left it, keeps the answer per pair of head SHA and base SHA in memory, and answers `unknown` with a reason where the ref is absent. Recommendation: B; the answer is a function of the two SHAs, and Phase 8 removes the per-pass fetch anyway. **Decided 2026-11-10, jwloka: Option B: the read uses `origin/<base>` as the last fetch left it and keeps the answer per pair of head SHA and base SHA in memory.**
- [x] **Where the Jira client lives.** The gate allows HTTPS only under `adapters/host/` (`check-host-https-callers.sh:43`), and Jira is a tracker connector, not a git host (`CLAUDE.md`, *The Layering Rule*). Option A: `adapters/tracker/jira-api.ts` over `adapters/host/connector-https.ts`, so only the shared transport imports `node:https` and the gate does not change. Option B: the gate allows `adapters/tracker/` too, and the Jira client opens its own connections. Recommendation: A; one module opens connections, and each connector keeps its own credentials, account and budget above it. **Decided 2026-11-10, jwloka: Option A: `adapters/tracker/jira-api.ts` over `adapters/host/connector-https.ts`; the gate does not change.**
- [x] **One rollback switch or two.** `PLOT_HOST_TRANSPORT=shell` exists, and `triggers-replace-the-tick` removes it. Option A: the one switch covers Bitbucket and the Jira tracker. Option B: a second switch for the tracker, so a person can roll back one connector. Recommendation: A, so Phase 8 removes one switch; a person who needs one connector back sets the switch and loses only process count. **Decided 2026-11-10, jwloka: Option A: `PLOT_HOST_TRANSPORT=shell` covers Bitbucket and the Jira tracker.**
- [x] **The sweep's request count.** A full sweep asks one request per tracked branch and state (`bb_branch_sweep`, `plot-host.sh:1273`); in-process the count stays, and only the processes go. One query with `source.branch.name="a" OR source.branch.name="b"` would cut requests. Recommendation: out of scope here; it changes requests and completeness, not processes, and needs its own corpus. **Decided 2026-11-10, jwloka: out of scope for this plan.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| The GitHub client runs over the shared transport unchanged | every existing `github-api` client row, the GitHub corpus tests and census P5 pass; S4 on both GitHub fixtures stays within 10 % + 2 of the merge base | Transport |
| `.env` is read as the shell reads it | `env-file.corpus.test.ts`: `read_env_var` and `rules/env-file.ts` agree on every recorded line | Transport |
| The scan's Bitbucket listing reads a typed answer | `grep "hostSaid(\['pr-list'" packages/fleet/src` finds nothing; `readBitbucketListing` calls `Host.prListing` | Bitbucket seam |
| The seam changes no answer | every existing fleet and contract test passes; census S4 on the Bitbucket fixture stays within 10 % + 2 of the merge base | Bitbucket seam |
| A sweep and a window keep their claims | `host-shell.ts` rows: a sweep with no complete notice and a short window each answer `possibly-truncated` | Bitbucket seam |
| A refused Bitbucket credential is refreshed once | a client row against the stub server: a first `401` re-reads the environment and `.env` and retries once; a second answers kind `auth` with the source and the fix in `said` | Bitbucket client |
| A repository with no Bitbucket credentials keeps the shell | a client and composition row: with no `BB_TOKEN` in the environment or `.env`, the client resolves no credential, the composition picks the shell route with the reason, fleetd logs it once, and no `security` process starts (a `PATH` stub `security` counts zero calls) | Bitbucket client |
| Every Bitbucket request charges the ledger | a client row: one request appends one entry with connector `bitbucket`, bucket `api` and the account of Open Question 3; basis `predicted` 1000 with no headers, `actual` with them | Bitbucket client |
| The census sees in-process Bitbucket requests | a sandbox row: the stub server counts one request per in-process Bitbucket page on the Bitbucket fixture | Bitbucket client |
| The gate knows Bitbucket's address | the gate's contract test holds one violation for `api.bitbucket.org` and one for `BITBUCKET_API_BASE` outside the allowed paths; the gate passes on this tree | Bitbucket client |
| A Jira read with no credentials fails, never reads empty | a client row: with no `JIRA_EMAIL`, `JIRA_API_TOKEN` or `.env`, the read answers `failed` with the shell's sentence | Jira client |
| The Jira ledger key carries no address | `jira-budget-account` corpus row: the rule and `jira_budget_account` agree on recorded emails and on an empty one | Jira client |
| A Jira `429` reads as throttled | a client row: a `429` with `Retry-After: 30` reports `throttled` with a 30 s wait | Jira client |
| Both Bitbucket transports return the same rows | `bitbucket-pr-listing.corpus.test.ts`: every row field and every per-state completeness word agree on every recording | Bitbucket PR reads |
| A walk refused mid-way is never whole | a stub-server row: page 2 of 3 fails; the answer holds page 1's rows, reads `possibly-truncated` and carries the refusal | Bitbucket PR reads |
| An idle pass starts no merge-tree for unchanged PRs | a listing row: a second read over the same head and base SHAs asks the `Refs` port nothing | Bitbucket PR reads |
| A change in any rule-read field is a change | one row per field the Bitbucket projection sets: that field alone changed yields `changed: ['prs']` | Bitbucket PR reads |
| Both Jira transports send the same JQL and read the same rows | `jira-issue-reads.corpus.test.ts`: the JQL, every issue field, the page token and the completeness agree for open, closed, changed and inbox | Jira issues |
| The issue gate asks no process for its own questions | a tracker row: `spender()` and the project scope answer with no `runProcess` call | Jira issues |
| The three Jira outcomes stay apart | tracker rows: an empty list, a failed request and `unaskable` stay three answers | Jira issues |
| An idle Bitbucket pass starts no process for a PR read | census P10, `green: true`: no `bb`, and no `bash` whose argv names `plot-host.sh` and `pr-list`; the stub server counts no more requests than the shell's `bb api` calls | Bitbucket cutover |
| Jenkins colours stay right | a composition row and a stub-server row on a `bitbucket` repository with `CI: jenkins`: the rich open read runs `plot-host.sh pr-list --state open --rich` and the stub server counts no open-rich request; `--state all`, the merged set and the sweep's `all` half reach the stub server and start no `plot-host.sh pr-list` | Bitbucket cutover |
| The Bitbucket transport is visible | a fleetd row: the start log names the transport, its reason and the credential source; `/plot-fleet --status` prints it | Bitbucket cutover |
| An idle Jira pass starts no process for an issue read | census P11, `green: true`: no `curl`, and no `bash` whose argv names `plot-host.sh` with `issue-list`, `ticket-projects` or `spend-rate --connector jira` | Jira cutover |
| The removed processes are counted | each cutover's PR states S4 on the Bitbucket fixture against the merge base, and the story's *Measures* holds both numbers | Bitbucket cutover, Jira cutover |
| GitHub is unchanged | census S4 on both GitHub fixtures stays within 10 % + 2 of the merge base, and P5 stays green | Bitbucket cutover, Jira cutover |

## Slices

### Wave 1

- `feature/bitbucket-and-jira-read-in-process-transport` — `adapters/host/connector-https.ts` with proxy agents, the 30 s bound, slots, the ledger entry and `429` mapping; `githubApi` moved onto it; `rules/env-file.ts` with `env-file.corpus.test.ts` <!-- builds: connectorHttps, the one HTTPS request module every connector client builds on -->
- `feature/bitbucket-and-jira-read-in-process-bitbucket-seam` — `PrListingQuery.branches`, the shell answer for the sweep and the window in `host-shell.ts`, `readBitbucketListing` on `Host.prListing`, the refusal kind `auth` for `bb` <!-- builds: the typed Bitbucket scan listing through Host.prListing -->

### Wave 2

- `feature/bitbucket-and-jira-read-in-process-bitbucket-client` — `adapters/host/bitbucket-api.ts` with base URL, slug, credentials from the environment and `.env` and their refresh, account, bucket and basis, the stub server's Bitbucket route and the gate pattern <!-- builds: bitbucketApi, the in-process Bitbucket HTTPS client -->
- `feature/bitbucket-and-jira-read-in-process-jira-client` — `adapters/tracker/jira-api.ts` with base URL, credentials and their refresh, `rules/jira-budget-account.ts` with its corpus row, the `429` mapping and the stub server's Jira route <!-- builds: jiraApi, the in-process Jira HTTPS client -->

### Wave 3

- `feature/bitbucket-and-jira-read-in-process-bitbucket-prs` — `adapters/host/bitbucket-pr-listing.ts`, `rules/bitbucket-pr-row.ts`, the sweep completeness rule, the recorder, `bitbucket-pr-listing.corpus.test.ts`, the mergeability memo and the per-field change rows <!-- builds: the in-process Bitbucket PR listing, with the corpus against plot-host.sh pr-list -->
- `feature/bitbucket-and-jira-read-in-process-jira-issues` — the four issue-gate reads of `trackerJira` over `jira-api.ts`, `rules/jira-jql.ts`, `rules/jira-issue-row.ts`, `jira-issue-reads.corpus.test.ts`, and `projectsRead` and `spender()` with no process <!-- builds: in-process Jira issue reads for the issue gate -->

### Wave 4

- `feature/bitbucket-and-jira-read-in-process-bitbucket-cutover` — `bitbucket` in `IN_PROCESS_BACKENDS`, the `CI: jenkins` split (plain reads in-process, rich open read on the shell), the start log and status line, census row P10, the S4 measurement and the story's *Measures*; a changeset for `plot` <!-- builds: the Bitbucket transport switch in fleetd's composition root -->
- `feature/bitbucket-and-jira-read-in-process-jira-cutover` — the in-process Jira tracker in `trackerFor`, the start log and status line, census row P11, the S4 measurement and the story's *Measures*; a changeset for `plot` <!-- builds: the Jira tracker transport switch in fleetd's composition root -->

## Notes

- Phase 7 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (on `origin/sprint/desk-probes-and-liveness`), candidate plans `bitbucket-reads-in-process` and `tracker-reads-in-process`. `jenkins-reads-in-process` stays a later plan.
- Line numbers read on `origin/sprint/desk-probes-and-liveness` at `38411b761` on 2026-11-10. `plot-host.sh` holds 6,064 lines there.
- Census figures: `main` `be7537152`, CI run 42868842876, jobs `census-head` and `census-compare`; PR #3380 head `38411b761`, CI run 42874101153, jobs `census-head` (artifact `census-report-head`) and `census-compare`.
- The two Wave 4 slices both edit `census-rows.ts`, `fleetd.census.test.ts` and the story's *Measures*; the second to merge rebases.
- Deliverable search (`plot-deliverable-search.sh`) for "bitbucketApi", "Bitbucket HTTPS client", "jiraApi", "Jira HTTPS client", "bitbucketPrListing", "bitbucket-pr-row", "jiraBudgetAccount", "env file credentials" and "connector transport" found no existing deliverable. "readEnvVar" found `skills/plot/scripts/plot-bitbucket-commit-status.mjs:108`, a third copy of `read_env_var` for the review identity; `rules/env-file.ts` can replace it in a later change. The estate already holds `walkToLimit` and `envelopeNextFor` (`listing-paging.ts`), `foldBitbucketMergeable` (`rules/bitbucket-mergeable.ts`) and `remoteSlug` (`rules/remote-slug.ts`), which this plan reuses.
- Census rows P10 and P11: decided 2026-11-10, jwloka; P7–P9 belong to `triggers-replace-the-tick`.
- Definition of Done: docs/definition-of-done.md.
