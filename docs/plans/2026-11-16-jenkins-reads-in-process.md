# Jenkins reads in-process

> fleetd reads Jenkins over Node's HTTPS client inside the build connector, not through one `plot-host.sh` and one `jen` process tree per question: the branch-colour map and the sha lookups that the rich PR read overlays on its checks, and the build port's three reads. The connector keeps its own credentials, its own bearer refresh, its own account and its own budget. Every rule copied out of `plot-host.sh` is a declared duplicate with a corpus test, and `PLOT_HOST_TRANSPORT=shell` is the way back.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- On a repository with `CI: jenkins`, fleetd asks Jenkins for build colours and builds by commit from inside its own process. An idle fleetd pass starts no `bash`, `jen`, `security`, `curl` or `jq` process for these reads, and the `checks` words, the refusals and the rate-limit record stay the same.
- On a Bitbucket repository with `CI: jenkins`, the rich open PR read moves in-process too, so every fleetd read of that repository runs in-process.

Board impact: none on the plan format, the template, the helper scripts or the `docs/plans` layout. The board reads the same `prs` and `defaultBranch` readings over the channel; `plot-host.sh` keeps every Jenkins op for the shell consumers, the worker loop and the merge path.

## Motivation

Phase 7 of the story *Nothing changed, nothing runs* says: one plan per connector moves its reads into the connector adapter over Node's HTTPS client. `bitbucket-and-jira-read-in-process` moved Bitbucket and Jira (delivered 2026-11-13). Jenkins (`jen`) has no plan. This plan covers Jenkins.

Line numbers below are on `origin/main` at `fa158c452` (2026-11-16). `plot-host.sh` holds 6,033 lines there.

### Jenkins reads today

| Read | Caller | Route today | `jen` calls per read |
|---|---|---|---|
| The branch-colour map for a rich `pr-list` | `jenkins_build_map`, `plot-host.sh:1758`; called at `:4595` | `jen auth status` (`:1792`), `jen job view --json` (`:1806`), `jen job list --json` for a multibranch job (`:1852`) | 3 (2 for a plain job) |
| The sha lookups that bind a colour to a head | `jenkins_bind_rows`, `:2101`; GitHub arm `:4767`, Bitbucket arm `_bb_jen_bind`, `:4941` | `jenkins_sha_runs`, `:2024`: `jen api <path>/api/json?tree=builds[…]` on the branch path, then on the job root (`:2032-2034`) | up to 2 per row, at most `SHA_LOOKUPS_PER_PASS = 5` rows (`rules/jenkins-pr-checks.ts:38`) |
| `pr-state --with-checks` on Bitbucket | `:2212-2217` | `jenkins_build_map` and `jenkins_bind_rows` for one row | up to 5 |
| `runs` | `:5047` | `jenkins_sha_runs` with no sha | up to 2 |
| `run-for-sha` and `runs-for-sha` | `:5125` | `jenkins_sha_runs` with the sha | up to 2 |
| `ci-limit` | `:5914-5946` | none: a fixed line, `limit` 60, basis `predicted` (`:5927`) | 0 |
| `rerun-failed`, `rerun-all` | `:5203` | none: exit 4 where CI is not `github-actions` | 0 |

Every `jen` call goes through the `jen()` wrapper (`plot-host.sh:3909`), which takes a host slot and appends one ledger line under the connector `jenkins`. `jen` 0.4.0 is itself a 1,819-line bash script: on the Keychain backend each call runs `security find-generic-password` for each secret it reads (`jen:125`), and `jq` and `curl` for the request.

### Callers in packages

- `buildJenkins` (`packages/domain/src/adapters/build/build-jenkins.ts:96`) answers the `BuildPort` through `buildReads` (`build-shell.ts:150`), which runs `bash plot-host.sh runs | run-for-sha | runs-for-sha | ci-limit` per call. `buildFor` picks it for `CI: jenkins` (`build-resolve.ts:43-44`) and passes the GitHub client to `buildActions` only.
- fleetd builds the port once at `registryd-main.ts:3371`. Its `runsForSha` callers are the default-branch read (`default-branch-refresh.ts:143`, `:304`), the release world (`release-world.ts:71`), revert and repair (`revert-start.ts:204`, `:345`; `repair-start.ts:106`) and the merge workflow (`workflows/merge.ts:465`).
- The worker loop (`worker-loop.ts:240`, `:1072`), the board (`board.ts:696`), the merge ports (`merge-ports.ts:61`) and auto-merge (`auto-merge.ts:322`) each build their own port through `buildShell` with no client.
- Two lists keep reads on the shell because only the shell overlays Jenkins colours: `SHELL_CI = ['jenkins']` keeps every read of a GitHub repository with `CI: jenkins` on the shell (`host-reads.ts:24`, `:39`), and `SHELL_RICH_CI = ['jenkins']` keeps the rich reads of a Bitbucket repository with `CI: jenkins` on the shell (`host-reads.ts:31`, `:209`; the split in `hostWithListing`, `:126-130`).

### Idle-pass count

- **By the code, per Bitbucket repository with `CI: jenkins`:** the PR beat runs every `PR_READ_BEAT_MS = 60_000` (`rules/pr-status.ts:116`; `fleetPrs`, `fleet-clock.ts:284`). Its query is always rich: `richOpen` on a full read and `rich` on a delta (`pr-refresh.ts:1467-1469`). With `SHELL_RICH_CI`, each beat runs `plot-host.sh pr-list --rich`, which makes 3 `jen` calls for the colour map and up to 10 `jen api` calls for 5 rows. So an idle fleetd makes 1 `plot-host.sh` tree and 3 to 13 `jen` trees per minute. The default-branch read asks `runs-for-sha` only where the tip or the newest `mergedAt` changed, or where the held reading is due (`refreshOnChange`; `reaskDue`, `default-branch-refresh.ts:56`, `:299`), so an idle pass asks it 0 times.
- **The census does not measure it.** No census row names Jenkins (`packages/fleet/test/census/census-rows.ts`: P2–P11). The only `CI: jenkins` fixture is `bitbucket-jenkins.census.test.ts:36`, which runs fleetd untraced and counts the stub `bb` open reads, not `execve`. The sandbox writes stub `gh`, `bb` and `curl` and no stub `jen` (`sandbox.ts:265-267`), so on that fixture every `jen` call fails as *not installed* and `jenkins_build_map` answers `unknown`. S4 is 0 on the three traced fixtures, none of which declares `CI`.
- **On the operator's machine, measured 2026-11-16:** 0 per idle pass. The one fleetd running (pid 74449) serves this repository, which declares `CI: github-actions`. The ledger `~/.plot/state/budget.tsv.1` (2026-11-15 11:12 to 2026-11-16 11:12 CET) holds 968 `jenkins` lines against 75,904 `github`, 6,944 `bitbucket` and 984 `jira` lines. The 968 lines fall in 57 bursts within 5 hours, and no two bursts are 60 s apart, so none comes from a fleetd PR beat.

So the saving is per Bitbucket or GitHub repository with `CI: jenkins` under fleetd, and this machine runs none today. The plan is sized to that: three slices, no seam slice, and a census row that measures the baseline before any read moves.

### Credentials, measured 2026-11-16

- `jen` 0.4.0 sends two headers (`jen:305-316`): `Authorization: Bearer <keycloak access token>` for the oauth2-proxy, and `X-Jenkins-Authorization: Basic <user:api-token>` for Jenkins' own realm.
- The bearer comes from `JEN_TOKEN`, or from the secret `keycloak-token`: a JSON blob with `access_token`, `refresh_token` and `expires_at` (`jen_save_token`, `jen:150-155`). Where `expires_at` has passed, `jen` posts `grant_type=refresh_token` with `client_id=cli` to `${JEN_REALM_URL}/protocol/openid-connect/token` and stores the answer (`jen:185-200`). `JEN_REALM_URL` defaults to `https://id.quatico.dev/realms/quatico` (`jen:28`).
- The bearer on this machine lives 300 s (`exp − iat` of the access token's claims; `azp: cli`). `jen` stores `expires_at` 30 s early (`jen:155`), so a long-lived reader refreshes about every 270 s.
- The Jenkins user and API token come from `JENKINS_USER` and `JENKINS_API_TOKEN`, or from the per-instance secrets `jenkins-user:<host>` and `jenkins-token:<host>` (`jen:133-134`). The bearer is realm-wide; the API token is per instance.
- The secret store is the macOS Keychain service `jen` by default where `security` exists, a `0600` file per key under `$JEN_CONFIG_DIR` (default `~/.config/jen`) with `JEN_SECRET_BACKEND=file`, and nothing on the `env` backend (`jen:115-130`). This machine uses the Keychain (`jen -I apps auth status`: `Secret store: keychain`, `Jenkins auth: OK`), and `~/.config/jen` does not exist.
- The instance URL: a slug expands through `JEN_URL_PATTERN`, default `https://jenkins-ci-{slug}.internal.quatico.dev`; a value with a dot is a host; a value with a scheme passes through (`jen_url_for`, `jen:47-60`). Plot reads the slug as the part of `Jenkins instance` before the first `/`, and the job path as the rest (`plot-host.sh:1895-1899`, `:2027`).
- A `3xx` whose `Location` names `/oauth2/` or the realm host is a dead session, not a Jenkins answer (`jen:347-356`).

The risk is medium, as the story says: bearer expiry. A reader that holds a 300 s bearer and refreshes it in memory can invalidate the refresh token `jen` holds, where the realm rotates refresh tokens. Then the operator's next `jen` call reads *session expired and refresh failed* (`jen:204`).

## Design

### Approach

**The model is `bitbucket-and-jira-read-in-process`.** Its Jira chain gives the shape: a client over the shared transport, then the reads with a corpus test, then a cutover that a census row holds. The shared transport exists: `connectorHttps` (`packages/domain/src/adapters/host/connector-https.ts:152`) takes the connector word, the account, the slot key and the spend reading from its caller and chooses none of them. `jira-api.ts` (`adapters/tracker/`) already builds on it outside `adapters/host/`. This plan builds no second transport, and `scripts/check-host-https-callers.sh` does not change: the Jenkins client imports no `node:https`.

**Slice 1: the Jenkins client.**

- `adapters/build/jenkins-api.ts` is the one module that builds requests to a Jenkins instance, over `connector-https.ts`. It resolves the instance URL with the rule of `jen_url_for` as `rules/jenkins-url.ts`, a declared duplicate: `packages/domain/corpus/jenkins-url.corpus.test.ts` runs `jen_url_for` and the rule over the same slugs, hosts and URLs, with and without `JEN_URL_PATTERN`. The slug and job path come from `Jenkins instance` or `JENKINS_INSTANCE`, split at the first `/`, and `PLOT_JENKINS_JOB` overrides the job, as `plot-host.sh:1771-1779` does.
- **Credentials.** The client reads the identity `jen` reads, from the sources of Open Question 1. It sends both headers, never in argv, a file or a log line.
- **Bearer refresh.** The client holds the Keycloak blob in memory. Before a request whose bearer is past `expires_at`, it posts the refresh grant to the token endpoint and keeps the new blob. It writes the new blob back as Open Question 2 decides. A `401`, or a `3xx` to `/oauth2/` or the realm host, re-reads the source once and retries once; a second one is a refusal of kind `auth` whose `said` names the source and the fix, `jen auth login`.
- **Account, bucket and basis.** Every entry carries the connector `jenkins`, the bucket `''` and the account of Open Question 3. With no rate-limit header, an entry records basis `predicted` with limit 60, as `ci-limit` does (`plot-host.sh:5927`). The slot bound follows `host_concurrency_bound` (`:3828`) over the same reading. A `429` maps to `throttled` through `throttledOf` (`connector-https.ts:119`).
- **The census sees Jenkins.** `stub-host.ts` gains a Jenkins route on the stub server that serves recorded `job view`, `job list` and `api/json?tree=builds[…]` answers, and the sandbox writes a stub `jen` that serves the same recordings from the same directory. A traced census row P12, `an idle fleetd pass on a repository with CI: jenkins starts no jen and no plot-host.sh pr-list` (`census-rows.ts`, `green: false`), runs fleetd on the Bitbucket fixture with `CI: jenkins`, 3 desks and 5 open PRs, and records the baseline in the story's *Measures*. This slice moves no read.

**Slice 2: the Jenkins reads.**

- `jenkins-api.ts` answers the three questions the shell asks, with the requests the shell sends:
  - **The colour map.** `GET <job>/api/json` answers the job's own `_class` and, for a plain `WorkflowJob`, its `color` and `lastBuild`; a `WorkflowMultiBranchProject` then asks its children once. Any other `_class` answers `unknown`, never `failed` (`plot-host.sh:1754-1757`). The session check that `jen auth status` makes (`:1792-1794`) becomes the status of the first request: a refusal of kind `auth` reads `failed`, as an unreachable Jenkins does today.
  - **Builds by sha.** `GET <branch path>/api/json?tree=builds[…]{0,3×limit}`, then the job root, with the multibranch `_class` read as an empty history and a JSON body without `builds` on the branch path read as *no such branch* (`jenkins_sha_runs`, `:2024-2070`).
  - **Builds by branch.** The same request with no sha, as `runs` asks it (`:5047`).
- **The declared duplicates.** The colour-to-`checks` mapping (`JEN_COLOUR_JQ`, `:1762-1768`) and the two job shapes become `rules/jenkins-build-map.ts`. The sha filter becomes `rules/jenkins-sha-runs.ts`: the branch-record match (`:1993-2003`), the `NOT_BUILT` and `ABORTED` filter after the fetch (`:2005`, `:2076`), the `3 × limit` window and the plain job's branch filter. `packages/domain/corpus/jenkins-reads.corpus.test.ts` feeds one set of recorded Jenkins answers to the shell, through the stub `jen` of Slice 1, and to the client, through the stub server, and compares every map entry, every run field and every refusal. The recordings hold a multibranch job, a plain job, a branch the job never indexed, a build still running, a `NOT_BUILT` build, a rebuild of one commit, an HTML answer and a `3xx` to `/oauth2/`. The corpus tier reads recordings only (`packages/domain/corpus/no-host-token.ts`).
- **The build port.** `buildJenkins` takes the client: `runs`, `runForSha` and `runsForSha` call it and keep `jenkinsConclusion` and `newestPerSha` (`build-jenkins.ts:22`, `:50`). `rerunFailed`, `rerunAll` and `limit` stay on the shell. `buildFor` passes the client only where its caller has one, so the worker loop, the board and the merge path keep the shell.
- This slice moves no census row.

**Slice 3: the cutover.**

- `bitbucketPrListing` overlays Jenkins colours on a rich read in-process: the colour map from Slice 2, the rows from `rowsToBind`, the sha lookups for those rows, and `bindChecks` (`rules/jenkins-pr-checks.ts:72`, `:109`), the rules that `plot-jenkins-pr-checks.mjs` already runs for the shell. The per-row projection that the Bitbucket arm writes in `jq` (`$jmap`, `$shamap`, `$named`; `plot-host.sh:4941-4961`) becomes a rule beside them, with a corpus row against the shell arm.
- `SHELL_RICH_CI` (`host-reads.ts:31`) becomes empty, so every read of a Bitbucket repository with `CI: jenkins` runs in-process. `SHELL_CI` follows Open Question 4.
- fleetd's composition root builds the Jenkins client where `CI` is `jenkins` and the client resolves credentials (`registryd-main.ts:3371`), and the shell otherwise. `PLOT_HOST_TRANSPORT=shell` (`rules/host-transport.ts`) forces the shell for Jenkins too (Open Question 5). fleetd logs the Jenkins transport, its reason and the credential source once at start, and `/plot-fleet --status` prints it; `bitbucket-jenkins.census.test.ts:64-67` holds the new start line.
- Census P12 turns `green: true`. A stub-server count holds that the in-process Jenkins requests per PR beat do not exceed the shell's `jen api`, `job view` and `job list` calls on the same fixture, measured with `PLOT_HOST_TRANSPORT=shell`. S4 on the Jenkins fixture runs against the merge base, and the slice records the number in the story's *Measures*.

**What stays.** `rerun-failed` and `rerun-all` exit 4 for Jenkins and stay so. `pr-state --with-checks` (`plot-host.sh:2212`) stays on the shell: the AgentMonitor's per-desk `pr-state` belongs to `liveness-token`. The worker loop's `runForSha` after a push (`worker-loop.ts:1072`) and the board's and merge path's ports keep `buildShell` with no client, because an operator command or a push starts them, not an idle pass. `jen` stays for every Jenkins op that is not a fleetd read.

### Open Questions

- [x] **1. Where the client finds Jenkins credentials on a machine that keeps them in the Keychain.** This machine keeps the Keycloak blob and the API token in the Keychain service `jen`, and Node cannot read the Keychain without a process. Option A: the environment (`JEN_TOKEN` is a bare bearer with no refresh, so it serves a short run only; `JENKINS_USER`, `JENKINS_API_TOKEN`), then `.env` through `rules/env-file.ts`, then `jen`'s file backend under `$JEN_CONFIG_DIR` where `JEN_SECRET_BACKEND=file`; no `security` call. A machine with none of these keeps the shell, and fleetd logs the reason once. Option B: A, then one `security find-generic-password -s jen -a <key> -w` per secret at start and on a refusal of kind `auth`, which *Target Shape* allows as a process in answer to a trigger. Recommendation: A, as `bitbucket-and-jira-read-in-process` decided for `bb` on 2026-11-10; the operator who wants the saving sets `JEN_SECRET_BACKEND=file` and runs `jen auth login` once. A person decides. Decided 2026-11-16, Jan Wloka: option A.
- [x] **2. The refresh token after an in-process refresh.** Where the realm rotates refresh tokens, the client's refresh invalidates the token `jen` holds, and the operator's next `jen` call fails. Option A: the client writes the new blob back to the store it read, with `jen`'s format (`expires_at` 30 s early) and mode `0600`, so `jen` and the client share one session. Option B: the client never writes; it refreshes in memory and accepts that `jen` signs in again where rotation is on. Slice 1 first measures whether `https://id.quatico.dev/realms/quatico` rotates refresh tokens for `client_id=cli`, by two refreshes from one refresh token against a throwaway session. Recommendation: A, because the story's 2026-11-05 decision says a long-lived fleetd refreshes credentials on expiry, and B breaks the operator's `jen`. A person decides. Decided 2026-11-16, Jan Wloka: option A.
- [x] **3. The Jenkins budget account.** The shell keys Jenkins lines on `budget_account ''` (`plot-host.sh:3523-3542`): `PLOT_BUDGET_ACCOUNT`, else `unknown`. The 968 measured lines carry the account `jwloka` and an empty bucket. Option A: the same key, as a declared duplicate with a corpus row, so shell and in-process lines meet in one key. Option B: the Jenkins user per instance host, so two instances get two budgets. Recommendation: A in this plan, as for Bitbucket; a change of the key belongs to both transports in one later change. Decided 2026-11-16, Jan Wloka: option A.
- [x] **4. GitHub with `CI: jenkins`.** `SHELL_CI` keeps every read of such a repository on the shell (`host-reads.ts:24`, `:39`), because the GitHub `pr-list` arm overlays Jenkins colours (`plot-host.sh:4767`). No repository on this machine is GitHub with `CI: jenkins`. Option A: Slice 3 empties `SHELL_CI` too and the GitHub listing takes the same overlay. Option B: `SHELL_CI` stays until a GitHub repository with Jenkins asks for it. Recommendation: A, because the overlay rules are host-free and the cost is one composition row and one corpus row on the GitHub arm. Decided 2026-11-16, Jan Wloka: option A.
- [x] **5. One rollback switch.** `PLOT_HOST_TRANSPORT=shell` covers GitHub, Bitbucket and the Jira tracker. Option A: it covers Jenkins too. Option B: a second switch for Jenkins. Recommendation: A, as decided for Jira on 2026-11-10. Decided 2026-11-16, Jan Wloka: option A.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The instance URL resolves as `jen` resolves it | `jenkins-url.corpus.test.ts`: `jen_url_for` and `rules/jenkins-url.ts` agree on every slug, host and URL, with and without `JEN_URL_PATTERN` | Client |
| An expired bearer is refreshed in-process | a client row against the stub server: a blob past `expires_at` posts one refresh grant, and the request carries the new bearer; no process starts (a `PATH` stub `security` and `jen` count zero calls) | Client |
| A dead session is a refusal, never an empty answer | client rows: a `401`, and a `3xx` to `/oauth2/`, re-read the source once and retry once; a second one answers kind `auth` with `jen auth login` in `said` | Client |
| A machine with no readable credentials keeps the shell | a composition row: with no source of Open Question 1, the composition picks the shell with the reason, and fleetd logs it once | Client |
| Every Jenkins request charges the ledger | a client row: one request appends one entry with connector `jenkins`, bucket `''`, basis `predicted` 60 and the account of Open Question 3 | Client |
| The census measures Jenkins | census P12 runs traced on the Bitbucket fixture with `CI: jenkins` and records a baseline in the story's *Measures*; the stub `jen` and the stub server serve one recording directory | Client |
| Both transports read the same Jenkins answers | `jenkins-reads.corpus.test.ts`: every map entry, run field and refusal agrees on every recording | Reads |
| Both job shapes keep their reading | corpus rows: a multibranch job answers one map entry per child; a plain job answers its own colour; a `FreeStyleProject` answers `unknown` | Reads |
| The build port reads Jenkins in-process where given the client | a `buildJenkins` row: `runsForSha` with the client starts no `plot-host.sh`; without it, it runs `plot-host.sh runs-for-sha` | Reads |
| An idle pass starts no process for a Jenkins read | census P12, `green: true`: no `jen`, and no `bash` whose argv names `plot-host.sh` and `pr-list` | Cutover |
| The in-process overlay binds the same checks | a corpus row: the Bitbucket arm's `checks`, `checksSha` and skipped words and the in-process overlay agree on every recording | Cutover |
| The request count does not grow | a stub-server count: in-process Jenkins requests per PR beat ≤ the shell's `jen` calls with `PLOT_HOST_TRANSPORT=shell` | Cutover |
| The Jenkins transport is visible | a fleetd row: the start log names the Jenkins transport, its reason and the credential source; `/plot-fleet --status` prints it | Cutover |
| The removed processes are counted | the cutover PR states S4 on the Jenkins fixture against the merge base, and the story's *Measures* holds the number | Cutover |
| GitHub and Bitbucket without Jenkins are unchanged | census S4 on the three existing fixtures stays at 0, and P5, P10 and P11 stay green | Client, Reads, Cutover |

## Slices

### Client

- `feature/jenkins-reads-in-process-client` — `adapters/build/jenkins-api.ts` over `connector-https.ts` with the instance URL, both headers, credentials, the in-process bearer refresh, account, bucket and basis; `rules/jenkins-url.ts` with its corpus row; the stub server's Jenkins route, the stub `jen`, and census row P12 with its baseline <!-- builds: jenkinsApi, the in-process Jenkins HTTPS client with Keycloak bearer refresh -->

### Reads

- `feature/jenkins-reads-in-process-reads` — the colour map, builds by sha and builds by branch over `jenkins-api.ts`; `rules/jenkins-build-map.ts`, `rules/jenkins-sha-runs.ts` and `jenkins-reads.corpus.test.ts`; `buildJenkins` on the client for `runs`, `runForSha` and `runsForSha` <!-- builds: in-process Jenkins colour map and sha reads, with the corpus against plot-host.sh -->

### Cutover

- `feature/jenkins-reads-in-process-cutover` — the in-process Jenkins overlay in `bitbucketPrListing`, `SHELL_RICH_CI` emptied and `SHELL_CI` as decided, the client in fleetd's composition root, the start log and status line, census P12 green, the S4 measurement and the story's *Measures*; a changeset for `plot` <!-- builds: the Jenkins transport switch in fleetd's composition root -->

## Notes

- Phase 7 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), candidate plan `jenkins-reads-in-process` (2 slices, size M, risk *bearer expiry*). This plan has 3 slices because the census has no Jenkins fixture: Slice 1 measures the baseline before a read moves.
- Depends on `github-reads-in-process` (Released 2026-11-11, v2.32.0) and reuses `connector-https.ts` and `rules/env-file.ts` from `bitbucket-and-jira-read-in-process` (Delivered 2026-11-13).
- Line numbers read on `origin/main` at `fa158c452` on 2026-11-16. `jen` line numbers are on `jen` 0.4.0 at `/opt/homebrew/bin/jen`, 1,819 lines.
- Ledger figures: `~/.plot/state/budget.tsv.1`, 2026-11-15 11:12 to 2026-11-16 11:12 CET, counted by connector column. The bearer lifetime comes from the access token's `exp` and `iat` claims; no token was printed or copied.
- No open GitHub issue asks for this plan (`gh issue list --repo plot-pm/plot --search jenkins`, 2026-11-16).
- Deliverable search (`plot-deliverable-search.sh`) for "jenkinsClient", "jenkinsApi", "Jenkins HTTPS client", "jenkins build map", "jenkinsBuildMap", "jenkins sha runs", "bearer refresh", "keycloak", "device flow" and "jen api" found no existing Jenkins client and no bearer refresh. The hits are comments in `pr-refresh.ts:1091-1475`, `build-jenkins.ts:69-85` and `plot-board-probe.sh:366`, and the GitHub and App bearer headers in `github-api.ts:224` and `plot-github-app.mjs:105`. The estate already holds `rowsToBind`, `bindChecks` and `SHA_LOOKUPS_PER_PASS` (`rules/jenkins-pr-checks.ts`), `jenkinsConclusion` and `newestPerSha` (`build-jenkins.ts`), `connectorHttps` and `throttledOf` (`connector-https.ts`) and `rules/env-file.ts`, which this plan reuses.
- Census row P12: the next free id after P11 (`census-rows.ts`).
- Definition of Done: docs/definition-of-done.md.
