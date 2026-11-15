## Implementation brief — bitbucket-and-jira-read-in-process (wave 3: in-process Jira issue reads)

- **Plan (canonical):** docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md on `sprint/triggers-and-connectors`
- **Approved:** 2026-11-11, jwloka, plan-PR #3389 merged
- **Branch:** `feature/bitbucket-and-jira-read-in-process-jira-issues` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to the sprint branch
- **Review of the code:** PR review per the repo's `Review: pr` convention

Wave 3 holds this slice and `bitbucket-prs`; the two share no source file. Wave 4's `jira-cutover` waits on this slice. Waves 1 and 2 are merged on the sprint branch (#3397 transport, #3398 Bitbucket seam, #3401 Jira client, #3402 Bitbucket client), so `jiraApi` (`adapters/tracker/jira-api.ts`), `connectorHttps`, `rules/env-file.ts` and `rules/jira-budget-account.ts` exist there and not on `main`. Cut from the sprint branch.

### What to build

The four Jira reads of the issue gate answered in-process. Today `refreshIssueIndex` (`packages/fleet/src/shared/issue-refresh.ts:448`, `:525`, `:529`, `:538`) reads changed, open, closed and inbox issues through `trackerJira` → `trackerReads.walk` (`tracker-shell.ts:285`) → `plot-host.sh issue-list` → `curl`. One call starts `bash`, `plot-config.sh`, one `curl` and several `jq`. Measured on the census, an idle Bitbucket pass with a Jira tracker starts 2 `node plot-issue-source.mjs` and 1 `curl`, plus the `plot-host.sh` tree around them. The gate's own two questions, `spender()` and the project scope (`projectsRead`, `tracker-jira.ts:137`), also start `plot-host.sh` (`spend-rate --connector jira`, `ticket-projects`).

This slice adds the reads and the rules they need. It does not switch the transport: `trackerFor` (`tracker-resolve.ts:44`) keeps building the shell-backed `trackerJira`, and the cutover slice flips it. Build in `packages/domain/src/`:

- `trackerJira`'s `issueListOpen`, `issueListClosed`, `issueListChanged` and `issueListInbox` gain an in-process path over `jiraApi`: `GET /rest/api/2/search/jql` with `jql`, `fields`, `maxResults` and `nextPageToken`, the query the `issue-list` Jira arm sends (`plot-host.sh:5268-5550`). `issueView`, `versionRead` and every write (`issue-status`, `issue-open`) stay on `plot-host.sh`: operator commands start them, not an idle pass.
- `rules/jira-jql.ts`: the JQL builder. The project scope `AND project IN (…)` from `Ticket prefixes` (`tracker_projects`, `plot-host.sh:2991`); the person clause that drops once a scope exists (`:5287-5290`); the open query (`:5324`); the closed query with `resolved >=`; the inbox query; the changed query with its relative `-Nm` time plus 5 minutes (`:5359`); `PLOT_JIRA_JQL` winning over the open and inbox queries; the refusal of an unscoped closed or changed read.
- `rules/jira-issue-row.ts`: the row projection. Key as `number`, `/browse/<key>` as `url`, `status` and `statusCategory`, `closedAt` from `resolutiondate`.
- `projectsRead` reads `Ticket prefixes` from the config reading with the split rule of `tracker_projects` (commas, trimmed, empties dropped), and `spender()` answers the account from `rules/jira-budget-account.ts` (already merged). Neither starts a process.
- `packages/domain/corpus/jira-issue-reads.corpus.test.ts` (model: `github-issue-reads.corpus.test.ts` and its `record-github-issues-runs.mjs` recorder): runs the shell arm against a recording `curl` stub and the in-process read against a stub server over the same recorded answers, and compares the JQL, every issue field, the page token and the completeness of each read.

### Settled decisions — do not re-derive them

- **The client is `jiraApi`, not a new one.** It already resolves base URL (`PLOT_JIRA_BASE_URL`, else the `Tracker` value), credentials (environment, then `.env`), the one-retry refresh on `401`, the ledger entry per request and the `429` → `throttled` mapping. Add no credential, budget or HTTPS logic here. `jira-api.ts` imports no `node:https`; keep it that way, since `scripts/check-host-https-callers.sh` allows HTTPS only under `adapters/host/` (Open Question 6, option A).
- **No credentials means `failed`, never an empty list**, with the sentence of `jira_require_config` (`plot-host.sh:3088-3094`); `jiraApi` already carries it as `JIRA_NO_CREDENTIALS`. An empty issue list that means "not read" is the silent failure this plan exists to prevent.
- **The three outcomes stay apart:** an empty list, a failed request and `unaskable` (no `Ticket prefixes` for a scoped read). Collapsing any two reads a refusal as "no issues".
- **Completeness claims carry over unchanged.** An unpaged open or inbox read above one page is refused (`ISSUE_PAGE_ROWS=100`, `plot-host.sh:667`), and an unscoped closed, changed or version read exits 4 before any request. Absent is not false: a missing issue in a refused or partial read never means "closed". Read the status and the refusal, not the emptiness.
- **One rollback switch.** `PLOT_HOST_TRANSPORT=shell` covers Jira too; the cutover slice wires it, not this one (Open Question 7). Wire no `CI` or transport branch here.
- **The ledger key carries no address.** The account is `jira:` plus 12 hex digits of the SHA-256 of `JIRA_EMAIL`; the email never reaches the ledger. Use the existing rule.
- **Declared duplicates cost a corpus row.** Every rule copied out of `plot-host.sh` joins `packages/domain/corpus/`. On a disagreement the branch stops; adjusting either side to make the comparison pass is the one forbidden move (`CLAUDE.md`, *A Shell Script Asks The Domain*). The corpus tier reads recordings only and runs with no host token (`corpus/no-host-token.ts`).

### Done when

The plan's `## Done when` rows for slice *Jira issues* are the specification:

| Claim | Check |
|---|---|
| Both Jira transports send the same JQL and read the same rows | `jira-issue-reads.corpus.test.ts`: the JQL, every issue field, the page token and the completeness agree for open, closed, changed and inbox |
| The issue gate asks no process for its own questions | a tracker row: `spender()` and the project scope answer with no `runProcess` call |
| The three Jira outcomes stay apart | tracker rows: an empty list, a failed request and `unaskable` stay three answers |

Assertions a naive implementation passes without, and what each catches:

- A recording with a second page (`nextPageToken`) and one with a refused page. Without them the paging and truncation claims go untested.
- A scoped and an unscoped closed and changed read. Without the unscoped row the refusal before any request is unproven.
- `PLOT_JIRA_JQL` set and unset. Without both, the override's precedence over the open and inbox queries is unproven.
- A corpus run that compares rows but not the JQL string passes while the two transports query different issues.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base; this slice should touch no `.sh` file, and if it does, pay the growth in the same change. No changeset is expected, as no transport switches. Do not commit a rebuilt board bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the in-process read path in `adapters/tracker/tracker-jira.ts` (and a neighbour module if it needs one), `rules/jira-jql.ts`, `rules/jira-issue-row.ts`, `corpus/jira-issue-reads.corpus.test.ts` with its recorder and fixtures, and the tracker rows. It must not edit `tracker-resolve.ts` composition (`trackerFor`, `trackerOfSource`; cutover), `adapters/host/` or any Bitbucket file (`bitbucket-prs`, same wave), `jira-api.ts` beyond a defect fix reported first, or `packages/fleet/test/census/` (cutover). Wave 4's `jira-cutover` builds on this slice's reads, so keep the in-process path selectable by an injected `jiraApi` rather than by environment.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
