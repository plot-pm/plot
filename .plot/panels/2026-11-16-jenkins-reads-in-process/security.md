# Security and credentials juror

Position: amend

The plan's facts hold and its transport choice is sound. The credential design has gaps that would make Slice 1 ship a client that either never runs on the operator's fleetd or races `jen` over one refresh token. Each gap is fixable in the plan text, so the plan is approvable after the edits below.

## 1. Existing deliverables

No slice's deliverable exists. `ls packages/domain/src/rules/ | grep -i jenk` shows only `jenkins-pr-checks.ts`, which the plan reuses. `grep -rln 'keycloak\|refresh_token\|JEN_SECRET_BACKEND' packages/ skills/plot/scripts/*.sh` finds no hits, so the estate has no Keycloak refresh and no reader for `jen`'s store. `adapters/build/` holds no `jenkins-api.ts`.

## 2. Factual claims checked

- `jen` 0.4.0 at `/opt/homebrew/bin/jen` has 1,819 lines (`wc -l`). The two headers, `jen_auth_args` at `jen:309-317`, are true. The cited text also shows that the Basic header goes out only where a user and a token both exist, so "sends both headers" is conditional in `jen`.
- The blob format, `expires_at = now + expires_in − 30` (`jen:150-155`), the refresh POST (`jen:185-200`) and the message *session expired and refresh failed* (`jen:204`) are true.
- The backend rule (`jen:115-130`) is true. Two details are missing. `JEN_CONFIG_DIR` defaults to `${XDG_CONFIG_HOME:-$HOME/.config}/jen` (`jen:31`), not plain `~/.config/jen`. The file backend writes `( umask 077; printf '%s' "$2" > file )` (`jen:141`), which truncates and then writes in place: it is not atomic and takes no lock. `grep -n 'flock\|lockf\|\.lock\|mv ' jen` finds no lock anywhere.
- The per-instance secrets are keyed by the RESOLVED lowercased host[:port] (`jen_key_for`, `jen:79-81`), honour `JEN_URL` first (`jen:86`), and map to `<key with ':' and '/' → '_'>.secret` (`jen_secret_file`, `jen:120`). The plan's URL rule does not name `JEN_URL`, and the corpus row does not cover the key or the filename.
- `jen_check_http` (`jen:343-366`) treats 401 and 403 alike. It refuses a 3xx to a third host as *unexpected redirect*, and it accepts a 3xx within the instance. The plan names only `401` and the `/oauth2/` or realm `3xx`.
- `~/.config/jen` does not exist (`ls -ld`). That matches the plan.
- `plot-host.sh` has 6,033 lines. `:1758` `jenkins_build_map`, `:2024` `jenkins_sha_runs`, `:2101` `jenkins_bind_rows`, `:3828` `host_concurrency_bound`, `:3909` `jen()` and `:5927` the `ci-limit` line are all true. `budget_account` (`:3523-3542`) reads `PLOT_BUDGET_ACCOUNT`, else `unknown`, for the Jenkins connector. That is true.
- `connectorHttps` at `connector-https.ts:152` and `throttledOf` near `:119` are true. The transport does not follow redirects, because it uses bare `http.request` and `https.request` (`:184-212`). It logs no header (`:53`). Its error text is `error.message` only.
- `SHELL_CI` (`host-reads.ts:24`) and `SHELL_RICH_CI` (`:31`) are true. `buildJenkins` (`build-jenkins.ts:96`) is true.
- **Not in the plan, and load-bearing:** the shell reads NO Jenkins credential from `.env`. The only `read_env_var` callers in `plot-host.sh` are Jira and Bitbucket (`:3071`, `:3097`). So Open Question 1A's ".env through `rules/env-file.ts`" is a new credential source with no shell twin, not a duplicate.
- **Not in the plan, and load-bearing:** the installed fleetd unit (`plutil -p ~/Library/LaunchAgents/com.plot-pm.fleetd.plist`, key names only) carries `PATH` and `PLOT_REPO_ROOT` and nothing else. So does the template, `skills/plot/units/com.plot-pm.fleetd.plist`. fleetd therefore never sees `JEN_SECRET_BACKEND`, `JEN_CONFIG_DIR`, `XDG_CONFIG_HOME`, `JENKINS_USER`, `JENKINS_API_TOKEN`, `JEN_URL_PATTERN`, `JEN_REALM_URL` or `PLOT_BUDGET_ACCOUNT` from the operator's shell.

## 3. Done-when rows

- The client rows (refresh, dead session, ledger) are real fail-before, pass-after checks against the stub server.
- **"A machine with no readable credentials keeps the shell" passes trivially on the operator's machine.** Under launchd, fleetd's environment has no `JEN_SECRET_BACKEND=file`. Applied as `jen_secret_backend` applies it, the rule then picks `keychain`, so the client finds no source and keeps the shell. Census P12 sets its own environment and turns green while the production fleetd never takes the in-process path. The Changelog line "fleetd asks Jenkins … from inside its own process" would then be false on a default install.
- The rotation measurement that Open Question 2 puts in Slice 1 has no row. The write-back of decision 2A has no row either: no check covers the mode, atomicity, or a concurrent `jen`.
- No row checks that a credential never reaches a log, a ledger line, a refusal's `said` or the status line.

## 4. What is missing or wrong

- **Where fleetd finds the file backend (blocks the whole saving).** Decision 1A tells the operator to set `JEN_SECRET_BACKEND=file`. That variable lives in the operator's shell, and the launchd unit does not carry it (§2). The plan must say how fleetd decides. One option probes `${XDG_CONFIG_HOME:-$HOME/.config}/jen/keycloak-token.secret` with no variable. The other has `plot-fleetctl.sh` write `JEN_SECRET_BACKEND` and `JEN_CONFIG_DIR` into the unit at `--start` from the starting shell. The choice matters for security. A probe with no variable can read a stale file that the operator's `jen` (still on the Keychain) no longer uses, and it can write rotated tokens there.
- **The two-writer race (decision 2A).** The design holds the blob in memory and refreshes it when `expires_at` has passed. It never re-reads the store first. `jen` takes no lock and writes non-atomically. One fleetd runs per repository, and the bearer is realm-wide, so every fleetd on the machine and the operator's `jen` share one refresh token. With rotation, two refreshes from the same token mean one gets `invalid_grant`. With reuse detection, the realm can also revoke the session for both. The plan names the risk under *Credentials* and decides 2A, but it designs nothing against the race.
- **A torn read.** `jen`'s `printf > file` leaves a window in which the file is empty or partial. A Plot reader that parses in that window must re-read, not answer `auth` with *not logged in*.
- **Write-back mechanics.** "Mode 0600" alone is not enough. A chmod after the write leaves a window in which the file has the umask mode. A write in place has the torn-read problem itself. The plan must also say what happens where the store is the environment, `.env` or `JEN_TOKEN`: the client must never write there.
- **Redirects and status codes.** The plan maps only `401` and the oauth2/realm `3xx`. A `3xx` to a third host must be a refusal, as in `jen:361-365`. The client must never follow it, because following it sends both credentials to the `Location` host. A `403` needs the same treatment as a `401`. Today Node's transport does not follow, but nothing in the plan pins that.
- **The ledger and the token endpoint.** The refresh POST goes to Keycloak, not Jenkins. The plan does not say whether it goes through `exchange` under connector `jenkins`. If it does, it breaks "one request appends one entry" and the "request count does not grow" row about every 270 s. If it does not, it is an unmetered request.
- **Refusal text.** `bitbucket-api.ts:248` puts the reply's `message` into `said`. A token-endpoint reply on success carries `access_token` and `refresh_token`. The plan must say that `said` takes only `error` and `error_description` from the token endpoint and never the raw body, and that a Jenkins HTML body is cut short.
- **`.env` as a new source.** Reading `JENKINS_API_TOKEN` from a worktree's `.env` gives in-process and shell different identities, because `jen` never reads `.env`. Then `PLOT_HOST_TRANSPORT=shell` changes who is authenticated, not only the route. Either drop `.env` for Jenkins or state it as a new source with no twin.
- **The rotation probe needs a person.** "Two refreshes from one refresh token against a throwaway session" needs a device-flow login, which an unattended Slice 1 worker cannot do (`PLOT_UNATTENDED=1`). It must also measure whether reusing a rotated token revokes the session, not only whether rotation is on.
- **One positive.** The in-process refresh removes a leak that exists today. `jen:187-190` passes `refresh_token=…` as a `curl -d` argument, so any process on the machine can read it from `ps`. The plan can state this as a benefit.

## 5. The five decisions against the design

- **1A** fits the stated design. It conflicts with the launchd environment (§4, first item), and its `.env` arm is not a duplicate of the shell (§2).
- **2A** fits the story's 2026-11-05 decision. The design does not implement it safely yet: it has no re-read before refresh, no atomic write, no handling of the torn read, and no rule for which stores are written.
- **3A** fits. Under launchd, `PLOT_BUDGET_ACCOUNT` is absent, so in-process and shell lines from fleetd both read `unknown`, and the shared key still meets. The plan cites 968 lines keyed `jwloka`, which come from processes outside the unit. Add one line saying that fleetd's lines will read `unknown` unless the unit carries the variable.
- **4A** fits. It carries no credential issue beyond the overlay.
- **5A** fits. With the `.env` arm, switching to the shell can also switch the identity (§4). That is a reason to drop the arm, not to add a second switch.

## Required edits

1. In Open Question 1's design text and Slice 1, state how fleetd under launchd finds `jen`'s file backend. Either `plot-fleetctl.sh` writes `JEN_SECRET_BACKEND` and `JEN_CONFIG_DIR` into the unit, or the client probes `${XDG_CONFIG_HOME:-$HOME/.config}/jen` with no variable. Add a Done-when row that runs the composition with the unit's environment only (`PATH`, `PLOT_REPO_ROOT`, `HOME`) and a file-backend store present, and asserts which transport it picks.
2. Correct the `JEN_CONFIG_DIR` default to `${XDG_CONFIG_HOME:-$HOME/.config}/jen`. Add `JEN_URL`, the canonical lowercased host[:port] key (`jen_key_for`) and the `':'/'/' → '_'` `.secret` filename (`jen_secret_file`) to the declared duplicate, with corpus rows next to `jenkins-url.corpus.test.ts`.
3. Design the refresh against the second writer. Re-read the store before every refresh, and adopt a blob whose `expires_at` lies ahead instead of refreshing. On `invalid_grant`, re-read once before refusing. Serialise refreshes between Plot processes with one lock, and say that `jen` does not honour it. Treat an empty or unparseable blob as a torn read and re-read once. Add client rows for each: a newer blob on disk means no grant posted, and `invalid_grant` followed by a newer blob on disk means success.
4. Specify the write-back. Create a temp file in the same directory with mode `0600` at open (`O_EXCL`), write it, then `rename` it over the target. Write only to the file backend the client read. Never write the environment, `.env` or `JEN_TOKEN`. Add a row that asserts the mode is `0600` and that a concurrent reader never sees a partial file.
5. Make the rotation measurement in Open Question 2 a named step for a person, not for the unattended Slice 1 worker. Have it also measure whether reusing a rotated refresh token revokes the session. Record the result in a Done-when row in the story's *Measures*.
6. State the redirect and status rules. The client never follows a redirect. A `3xx` to a host that is neither the instance, `/oauth2/` nor the realm is a refusal. A `3xx` within the instance is an answer. A `403` takes the `401` path. Add client rows for the third-host `3xx` and for `403`.
7. State whether the token-endpoint POST charges the ledger, and under which connector. Correct "one request appends one entry" and the request-count row to match.
8. Add a credential-leak row. Seed the stub with recognisable bearer, refresh and API-token values, run every client row and P12, and assert that no value appears in fleetd's log, the status line, any ledger line or any refusal's `said`. State that `said` takes only `error` and `error_description` from the token endpoint.
9. Drop `.env` as a Jenkins credential source, because `jen` and `plot-host.sh` never read it for Jenkins. Otherwise state it as a new source with no shell twin, and log that `PLOT_HOST_TRANSPORT=shell` then changes the identity.
10. Note under Open Question 3 that fleetd's lines read the account `unknown` under launchd, because the unit carries no `PLOT_BUDGET_ACCOUNT`.
