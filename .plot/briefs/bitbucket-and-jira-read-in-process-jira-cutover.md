## Implementation brief — bitbucket-and-jira-read-in-process (wave 4: the Jira cutover)

- **Plan (canonical):** docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md, Slice 8
- **Approved:** 2026-11-11, jwloka, plan-PR #3389 merged
- **Branch:** `feature/bitbucket-and-jira-read-in-process-jira-cutover` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to the sprint branch
- **Review of the code:** per repo convention

Wave 4 holds this slice and `…-bitbucket-cutover` (PR #3422, open). Both edit `census-rows.ts`, `fleetd.census.test.ts` and the story's *Measures*; the second to merge rebases. This slice waits on waves 1–3, all merged.

### What to build

Waves 2 and 3 built the in-process Jira reader (`jiraApi` in `adapters/tracker/jira-api.ts`, `rules/jira-jql.ts`, `rules/jira-issue-row.ts`, `rules/jira-budget-account.ts`, and the `JiraInProcess` option of `trackerJira`) and switched nothing: `trackerFor` (`adapters/tracker/tracker-resolve.ts`) still builds `trackerJira(context, baseUrl)` with no `inProcess`, so every idle issue pass starts `curl` and `plot-host.sh issue-list`. This slice switches the transport:

- Build `trackerJira` over `jiraApi` in `trackerFor` and `trackerOfSource` where the declared tracker is `jira` and the client resolves credentials; the shell otherwise. `PLOT_HOST_TRANSPORT=shell` (`rules/host-transport.ts`) forces the shell for the tracker too, so one switch covers Bitbucket and Jira.
- fleetd logs the tracker transport and the credential source once at start, publishes it with its heartbeat, and `/plot-fleet --status` prints it, as for the git host.
- Add census row P11 (`census-rows.ts`, `green: true`): an idle fleetd pass with a Jira tracker starts no `curl` and no `bash` whose argv names `plot-host.sh` with `issue-list`, `ticket-projects` or `spend-rate --connector jira`. Add a stub-server count that holds the Jira requests per issue pass to the shell's `curl` calls.
- Measure S4 on the Bitbucket fixture against the merge base and record the number in the story's *Measures*. State the figure and the images removed per read in the PR.
- Add a changeset for `plot`.

### Settled decisions — do not re-derive them

- **One rollback switch, not two.** A second tracker-only switch was rejected: `triggers-replace-the-tick` removes `PLOT_HOST_TRANSPORT`, and two switches mean two removals. A person who needs one connector back sets the switch and loses only process count. Decided 2026-11-10, jwloka.
- **`issueView`, `versionRead` and every write stay on `plot-host.sh`.** Operator commands start them, not an idle pass; moving them adds a write path with no census row.
- **The client lives under `adapters/tracker/` over `connector-https.ts`.** `node:https` stays importable only under `adapters/host/` (`check-host-https-callers.sh`); do not widen the gate.
- **No credentials means the shell, with the reason.** `JIRA_EMAIL` and `JIRA_API_TOKEN` come from the environment or `.env` only. With none, composition picks the shell, fleetd logs the reason once, and no other process starts.
- **The three outcomes stay apart:** an empty list, a failed request and `unaskable` (no `Ticket prefixes` for a scoped read). An empty answer never replaces a failed one; measured 2026-08-27, an empty result read as *no PRs* refused four fully-merged plans.
- **The ledger key carries no address.** `rules/jira-budget-account.ts` is the account; do not change it. `spender()` and the project scope answer with no process.
- **Named residue stays.** `spend-rate` through `plot-host.sh` at `registryd-main.ts`, `pr-refresh.ts` and `fleet-scan.ts` is not this slice's to move.

### Done when

The plan's `## Done when` rows for *Jira cutover* are the specification:

- P11 `green: true`: no `curl`, and no `bash` whose argv names `plot-host.sh` with `issue-list`, `ticket-projects` or `spend-rate --connector jira`; the stub server counts no more Jira requests per issue pass than the shell's `curl` calls, measured with `PLOT_HOST_TRANSPORT=shell` as the P5 baseline is (`fleetd.census.test.ts`).
- A composition row: a repository with a `jira` tracker and credentials gets the in-process tracker; one with none, or with `PLOT_HOST_TRANSPORT=shell`, gets the shell. Without the second half, a naive cutover passes P11 and breaks every machine with no Jira credentials in `.env`.
- A fleetd row: the start log names the tracker transport and the credential source; `/plot-fleet --status` prints it.
- S4 on the Bitbucket fixture against the merge base, stated in the PR and in *Measures*. S4 on both GitHub fixtures stays within 10 % + 2 of the merge base, and P5 stays green.

Plus the repo gates: no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`), and the changeset. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI. `scripts/check-shell-lines.sh` refuses shell growth: touch no `.sh` file unless you remove as much shell elsewhere.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns: `adapters/tracker/tracker-resolve.ts`, the fleetd composition root and status line for the tracker, `census-rows.ts`, `fleetd.census.test.ts`, the story's *Measures*, one changeset. Out of scope: `bitbucket-cutover` (Bitbucket in `IN_PROCESS_BACKENDS`, census P10), Jenkins reads, `plot-host.sh`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
