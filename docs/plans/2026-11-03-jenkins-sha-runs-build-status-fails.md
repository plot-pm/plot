# jenkins_sha_runs: build status fails behind an auth proxy because it bypasses jen

> `jenkins_sha_runs` reads a commit's Jenkins builds with `curl -u`, so a Jenkins behind an OAuth2 proxy answers HTTP 302 and every PR reports `checksLookup: broken`; the read goes through `jen api` instead, and Plot reaches Jenkins only through `jen`.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3061
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3062 merged
- **Started:** 2026-11-04, Jan Wloka, `feature/jenkins-sha-runs-through-jen`
- **Delivered:** 2026-11-05

## Changelog

- `pr-state --with-checks`, `pr-list`, `runs`, `run-for-sha` and `runs-for-sha` report the Jenkins result for a branch or a PR's head sha on Jenkins instances behind an auth proxy. The read goes through `jen api`, the same transport as every other Jenkins call in Plot.
- Behaviour change: the Jenkins sha read no longer uses basic auth with `JENKINS_USER`/`JENKINS_API_TOKEN` from the environment, the repository `.env`, the main checkout's `.env` or the keychain. It needs `jen` 0.4.0 or later with a Keycloak sign-in (`jen auth login`). A Jenkins with no oauth2 proxy in front, or a machine with no Keycloak sign-in, now reads `checksLookup: broken` for the sha read, and the refusal names the reason.
- A failed Jenkins sha read names the Jenkins instance slug and the first `error:` line `jen` printed, for example `HTTP 302 — redirected to the identity provider; the SSO session expired`.

Board impact: none. The plan format, the template and the `docs/plans` layout do not change, and the board reads the same `checks` and `checksLookup` fields.

## Motivation

Issue #3061, measured on Plot 2.30.0 with `CI: jenkins` and a multibranch instance behind oauth2-proxy (Keycloak): `plot-host.sh pr-state <open PR> --with-checks` prints `Jenkins did not answer` and `"checksLookup":"broken"`, and the board shows no build status.

`jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:2047`) sends `curl -sg --max-time 30 -u "$cred"` to `https://$host$path/api/json?$tree` (`:2067`). The proxy answers that request with a 302 to the login page. Every other Jenkins call in `plot-host.sh` (`:1781`, `:1795`, `:1841`, `:1955`) goes through `jen`, which sends `Authorization: Bearer <keycloak token>` for the proxy and `X-Jenkins-Authorization: Basic <user:api-token>` for Jenkins (`~/bin/jen` `jen_auth_args`, `:305-316`). So on a proxied instance `jenkins_build_map` answers and `jenkins_sha_runs` does not.

| Transport | Proxied instance | Instance with no auth edge |
|---|---|---|
| `curl -u "$cred"` (what `jenkins_sha_runs` sends today) | HTTP 302 to the login page | HTTP 200 (measured with `curl`) |
| `jen -I <slug> api "<path>/api/json?<tree>"` | HTTP 200, builds with `lastBuiltRevision.SHA1` | not measured; `jen` source predicts a failure |

The right-hand `jen` cell has no measurement. `jen` puts the Basic credential only in `X-Jenkins-Authorization`, which the edge promotes to `Authorization` (`jen:12-18`). A Jenkins with no such edge receives the Keycloak bearer, which it answers with a login redirect (`plot-host.sh:1915-1917`, measured 2026-09-10). `jen api` also exits 1 with `error: not logged in` on a machine with no Keycloak token (`jen_token`, `jen:159-180`). The plan accepts that loss: see Notes.

The comment above the function says `jen` is not the transport because a `jen build list --json` entry carries no sha. That holds for `build list`. `jen api <path>` (jen 0.4.0, `cmd_api` at `jen:1578`) sends one request with the instance's auth headers and prints the body, and the `tree=` query returns the sha through it.

## Design

### Approach

**Transport.** For each path it asks (the branch path, then the root path), `jenkins_sha_runs` sends `jen -I "$slug" api "$path/api/json?$tree"` and nothing else. The `$tree` string passes through unchanged: against the proxied instance, the exact value the function builds returned `{"number":1,"result":"FAILURE","sha":"f9a88cf…"}`. The JSON checks after the call (`has("builds")`, the branch-answered test, the multibranch container test) stay as they are. Plot reaches Jenkins only through `jen`.

**Removed.** `jenkins_rest_credential` (`plot-host.sh:1910-1930`), `jenkins_resolve_host` (`:1946-1957`), the `host` and `cred` locals, the slug-resolution refusals at `:2055-2057`, the "no Jenkins API credential" refusal at `:2058-2062`, and the `cred=""` line at `:2086`. Their only callers in `plot-host.sh` are `:2055` and `:2058`; no bundle under `skills/plot/scripts/board/` and no TypeScript under `packages/` calls either. `test/reconcile/host.test.mjs` calls them at `:4560` and stubs them at `:4902-4903`; the Tests section lists those changes. `.plot/briefs/*.md` name them in dated briefs, which stay. `plot_env_file` and `read_env_var` stay, because `jira_load_env_file` (`:3083-3095`) calls them.

**Every failure ends `checksLookup: broken`, never an answer.** `jen api` exits 1 with empty stdout on a 3xx to the identity provider, any other 3xx outside the instance, 401, 403, every other status of 400 or more, no Keycloak token, a curl transport error, and an unknown command (`cmd_api`, `jen:1645-1665`; `jen_check_http`, `jen:335-399`; dispatcher, `jen:1814-1817`). A 3xx inside the instance exits 0 with the redirect body, which is not JSON. An absent `jen` exits 127. Each of these fails `jq -e 'has("builds")'`, so the function exits 4 (`unaskable`): Bitbucket `pr-list` and `pr-state` read `checksLookup: broken`, and GitHub `pr-list` applies its existing named-row rule. A 404 on the branch path exits 1 with empty stdout; the function goes on to the root path, as it does today when `curl` gets the 404 HTML, and `branch_answered` stays unset either way.

**Budget.** The `jen()` wrapper (`plot-host.sh:3905-3915`) takes the `jenkins` slot, runs `command jen`, gives the slot back and records one `budget_record_call jenkins ''`. The slice removes the `host_slot_take` / `host_slot_give` / `budget_record_call` bracket at `:2066-2068` and adds none. A nested bracket would record two ledger rows per request and, with a slot bound of 1, make the inner `host_slot_take` wait `PLOT_SLOT_WAIT_MAX_S`=30 s (`:3846`) while the outer slot is held. Each path asked writes exactly one `jenkins` ledger row.

**Timeout.** `plot-host.sh` has no generic bounded-run helper. Its one bounded child is `bb_fetch_base_bounded` (`:2139-2157`), and `jen api` has no timeout of its own (`cmd_api` runs `curl -sS -g` with no `--max-time`). The slice bounds `command jen` inside the `jen()` wrapper with the same bash 3.2 pattern: when `PLOT_JEN_BOUND_S` is set, the wrapper runs `command jen` in the background under `set -m`, starts a watcher `( sleep "$PLOT_JEN_BOUND_S"; kill -TERM "-$pid" ) >/dev/null 2>&1 &`, waits for the child, kills the watcher and restores `set +m` if it was off. The watcher redirects its own output so it does not hold the caller's `$(…)` capture pipe open. The wrapper gives the slot back and records the call after `wait` returns, so a request the bound kills still releases its slot and still writes its one ledger row. `jenkins_sha_runs` calls `PLOT_JEN_BOUND_S="${PLOT_JENKINS_SHA_BOUND_S:-30}" jen -I "$slug" api …`; every other `jen` call leaves `PLOT_JEN_BOUND_S` unset and keeps today's behaviour. `PLOT_JENKINS_SHA_BOUND_S` exists so a test can lower the bound. A request the bound kills reads as a failure, with the synthetic error line `jen api gave no answer within <n> s`.

**Refusal text.** `jen api`'s stderr goes to a temporary file (`plot_tmpfile`), not to `/dev/null`. The generic refusal names the slug: `plot-host: <op> — Jenkins did not answer for Jenkins instance '<slug>'`. A second line carries `jen`'s first `error:` line, for example `  jen: error: HTTP 302 — redirected to the identity provider; the SSO session expired`, and a third line says `  Plot reaches Jenkins only through \`jen\`; run \`jen auth login\`.` Only the one `error:` line is forwarded; the body lines `jen` prints after an HTTP error stay out. When `jen` answers `unknown command: api`, the refusal says `plot-host: <op> — the sha read needs jen 0.4.0 or later with \`api\``. When `jen` is not on `PATH`, the refusal says `jen` is not installed and names the same version. The "Jenkins has no branch '<branch>' indexed" refusal does not change.

**Minimum `jen`.** `jen` 0.4.0 ships `api` (`JEN_VERSION="0.4.0"` at `jen:5`, dispatcher arm `api)` at `jen:1808`), and every cached copy of the `working-with-jenkins-api` plugin on the measuring machine (quatico-internal 2.27.0 to 2.30.0) carries 0.4.0 with `api`. No earlier version is verified, so 0.4.0 is the named minimum. `plot-host.sh:1776` names 0.2.0 only for the `auth status` wording, not as a minimum.

**Layering.** `plot-host.sh` stays the one place that talks to the host CLI (`scripts/check-host-cli-callers.sh`); the change adds no caller elsewhere. `curl` stays in `plot-host.sh` for Jira (`:3113`) only. Manifesto Principle 3 holds: the script collects and reports, the skills interpret. The Bitbucket arms (`pr-list` at `:4939`, `pr-state`) reach `jenkins_sha_runs` through `jenkins_bind_rows` and need no change of their own. The change uses no bash 4 construct and removes shell lines net, so `scripts/check-shell-lines.sh` passes.

### Comment and documentation sites

| Site | Today | After the slice |
|---|---|---|
| `plot-host.sh:1910-1930` (`jenkins_rest_credential` and its comment) | the REST credential and its three sources | removed with the function |
| `plot-host.sh:1946-1957` (`jenkins_resolve_host` and its comment) | resolves a slug to the host its credential is keyed by | removed with the function |
| `plot-host.sh:1971-1974` | "THE SHA IS IN JENKINS AND `jen` IS NOT THE TRANSPORT" | Plot reaches Jenkins only through `jen`; `jen api` carries the sha through `tree=` in one round trip |
| `plot-host.sh:1986-1989` | "NO CREDENTIAL IS *CANNOT BE ASKED*" | a `jen` that cannot authenticate is *cannot be asked*, never *no run*; an unreachable instance is not an empty history |
| `plot-host.sh:2034-2035` | "`host_slot_take`/`budget_record_call` below run once per path" | the `jen()` wrapper records one ledger row per path |
| `plot-host.sh:2044-2045` | "curl failure, HTML, empty body" | "a failed `jen api` request, HTML, empty body" |
| `plot-host.sh:5110-5123` (`run-for-sha` arm) | "`jen` IS NOT THE TRANSPORT", "`jen` has no changesets subcommand and no raw-API passthrough", "The fetch, credential and match rule live in `jenkins_sha_runs`" | `jen api` is the raw passthrough and the only transport; the fetch and match rule live in `jenkins_sha_runs` |
| `packages/domain/src/adapters/build/build-jenkins.ts:78-89` | "`runForSha` ASKS JENKINS' REST API"; "THE CREDENTIAL IS NOT THE KEYCLOAK BEARER … A machine with no keychain entry answers `unaskable`" | `runForSha` asks Jenkins' REST API through `jen api`; a machine where `jen` cannot authenticate answers `unaskable` |
| `packages/domain/src/rules/pr-status.ts:60-66` | the notice filter names `JENKINS_USER and JENKINS_API_TOKEN` | the slice removes the Jenkins alternative, which nothing prints any more; the Jira and Bitbucket alternatives stay; `packages/domain/test/pr-status.test.ts:110-126` switches its two cases to the `JIRA_EMAIL and JIRA_API_TOKEN read from the environment` notice |
| `skills/plot/scripts/plot-config.sh:250` | `Default branch job` is "Read by `jenkins_sha_runs` only" | stays true: the read at `plot-host.sh:2051` does not change |
| `docs/sprints/2026-W39-the-jenkins-team-sees-its-builds.md:158`, `.plot/briefs/*.md` | describe the earlier transport | stay: dated records |

### Tests

All tests are in `test/reconcile/host.test.mjs` unless named otherwise. No test may reach a network or a real `jen`.

**Fixture.** `makeJenStub` (`:2654-2706`) gains an `api` arm. It takes a map from requested path to `{ body, exit, stderr }`, writes the argv to `jen.calls` like every other arm, and prints the body to stdout and the stderr text to stderr. A path not in the map answers `exit 1` with `error: HTTP 404` on stderr, which is what `jen` 0.4.0 does. An option `apiMissing: true` answers every `api` call with `unknown command: api` and exit 1, and an option `apiSleep` sleeps that many seconds before answering. Every Jenkins sha test puts a `curl` stub on `PATH` that records its argv and exits 1, so a stray `curl` fails the test rather than reaching a network.

**New tests**, each with the reason it fails before the slice:

1. Proxied regression: a `curl` stub answers a 302 login HTML page, the `jen` stub's `api` arm answers the builds JSON, and `pr-list --rich` on Bitbucket binds the row with no `checksLookup`, and `run-for-sha` answers the matching build. Today `curl` is called and the result is `broken`.
2. No `curl`: across `run-for-sha`, `runs-for-sha`, `runs` and Bitbucket `pr-list --rich`, the `curl` stub records zero calls and `jen.calls` holds `api /job/…/api/json?tree=builds%5B…`. Today `curl` records one call per path.
3. SSO expired: `jen api` exits 1 with `error: HTTP 302 — redirected to the identity provider; the SSO session expired`. The result is exit 4, `checksLookup: broken` on Bitbucket `pr-list`, and stderr carries the slug, that `error:` line and `jen auth login`. Today stderr names `$host` and no `jen` line.
4. Old `jen`: `apiMissing` gives exit 4 and stderr names `jen 0.4.0 or later with \`api\``. Today no `api` call happens.
5. HTML 200 (`jen api` exit 0, HTML body) and 401 (`jen api` exit 1, empty stdout): both exit 4 and read `broken`.
6. Bound: `apiSleep: 5` with `PLOT_JENKINS_SHA_BOUND_S=1` returns within 3 s, exits 4, names `no answer within 1 s`, and leaves no `jenkins` slot claimed in the private `PLOT_BUDGET_HOME`.
7. Ledger: with a private `PLOT_BUDGET_HOME`, one `run-for-sha` that the branch path answers writes exactly one `jenkins` row; one that 404s on the branch path and answers on the root path writes exactly two. Today the read writes its rows through the outer bracket, and a nested bracket would write two per path.

**Existing tests to change:**

| Test | Change |
|---|---|
| `:3586` "a Jenkins refresh costs a fixed number of calls" | restate: 3 calls for `auth status`, `job view` and `job list`, plus one `api` call per path asked for each row `rowsToBind` names; assert the `api` count separately, so a per-branch storm of other verbs still fails |
| `:4899` `sourcedJenkinsShaRuns` | drop the `jenkins_resolve_host`, `jenkins_rest_credential` and `curl()` stubs; add a `jen()` shell function that answers `api` with the builds JSON; no test reaches the real `jen` on a developer's `PATH` |
| `:5000-5021` "the sha route does not go through `jen` at all" | invert: `run-for-sha` asks `jen` by `api` only, never by `job view` |
| `:3029` "a sha lookup with no Jenkins API credential keeps the branch colour" | rewrite: a failing `jen api` keeps the branch colour of green and failing rows on GitHub `pr-list`; `:3038` asserts zero `curl` calls and one `api` call per path |
| `:4495` "runs on Jenkins without a credential exits 4", `:4998` "run-for-sha on Jenkins without a credential exits 4" | rewrite: a failing `jen api` exits 4, never empty, with the new refusal text |
| `:4516`, `:4534`, `:4546-4565`, `:4572` (`jenkins_resolve_host` and slug resolution) | delete: the function and its refusals are removed; one rewritten test asserts that a bare slug reaches `jen -I <slug> api` unchanged |
| `:5079-5342` (the `jenkins_rest_credential` block: `:5129`, `:5144`, `:5190`, `:5245`, `:5263`, `:5283`, `:5297`, `:5319`) | delete with the function |
| `:5362`, `:5383`, `:5409` (worktree and main-checkout `.env` for `run-for-sha`) | delete with the function |
| `makeJenkinsPrRestStub` (`:2864`), `makeCurlAnswering` (`:2992`), `makeJenkinsRestBin` (`:4005`), `makeJenkinsRestBinKeyedOnJob` (`:4397`), `makeJenkinsRestStub` (`:5100`) | replace each with the `api` arm of `makeJenStub`, keyed on the same paths (branch segment versus root); the `security` stub at `:3998` goes |
| `:1479` | keep; drop `no Jenkins API credential` from the refusal pattern |

`:8471` and `:8589` test Jira's `.env` credential, not Jenkins'; they stay unchanged.

### Open Questions

None.

## Slices

### Jenkins sha read through jen

- `feature/jenkins-sha-runs-through-jen` — in `jenkins_sha_runs`, read through `jen -I "$slug" api` only, bounded to 30 s in the `jen()` wrapper; remove the outer slot bracket, `jenkins_resolve_host`, `jenkins_rest_credential` and the credential refusals; name the slug and `jen`'s `error:` line in the refusal; rewrite the comment sites in the table above, including the Jenkins notice alternative in `pr-status.ts`; migrate the host tests as listed <!-- builds: jenkins_sha_runs reads through jen api --> → #3148

## Notes

- Known consequence, decided: the Jenkins sha read drops the basic-auth credential sources (environment, repository `.env`, main checkout `.env`, keychain) that #1936 and #2263 added for Linux agents and CI. A Jenkins with no oauth2 proxy in front, and a machine with no Keycloak sign-in, now read `checksLookup: broken` for the sha read. `jenkins_build_map` already needs `jen` on those machines, so the branch colour has the same requirement today.
- Follow-up, not a slice: GitHub `pr-list` keeps a named row's branch colour when its sha lookup breaks (`plot-host.sh:4755-4763`), and that colour may belong to an older head. The slice removes the systematic trigger for proxied instances; the residual case is pre-existing and gets its own issue.
- Follow-up, not a slice: the other `jen` calls in `plot-host.sh` (`:1781`, `:1795`, `:1841`) stay unbounded; `PLOT_JEN_BOUND_S` lets each opt in later.
- Related, shipped: [jenkins-sha-lookups-in-plot-host](2026-10-24-jenkins-sha-lookups-in-plot-host.md) (#2478) introduced the sha read and its `curl` transport.
- Deliverable search: `plot-deliverable-search.sh "jenkins_sha_runs"` found only the function itself and its callers; no existing `jen api` use in `plot-host.sh`.
- Ceremony answers chosen unattended: `Plan PRs: required` fixes `Review: pr`; `Impl: own branches` because the plan PR merges before the implementation branch starts.
- One slice: the transport, the helper removal, the wrapper bound and the test migration cannot land separately without a red window.
- Source: issue https://github.com/plot-pm/plot/issues/3061. Nothing is written to the tracker.
