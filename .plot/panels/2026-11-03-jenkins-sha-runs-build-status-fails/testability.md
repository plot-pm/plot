# Juror: testability

Position: amend

The proxied case is testable with a stubbed `jen`, and I built that test outside the repository: it fails on the current code and passes on a one-line patch. The plan gives a Sonnet agent no test plan beyond one sentence, though about 70 existing tests stub `curl` and the keychain. Its claim about unproxied instances also rests on an assumption that a stub cannot check, and `jen`'s own source contradicts that assumption.

## Findings

### 1. A stubbed `jen api` models the proxied case, and the new test fails before the change (ran)

I sourced `plot-host.sh` the way `sourcedJenkinsShaRuns` does (`test/reconcile/host.test.mjs:4899`). The PATH stubs were a `curl` that answers a 302 login page as HTML and a `jen` whose `api` arm answers `{"builds":[…SHA1 f9a88cf000…]}`.

- Current code: `curl` is called twice (branch path, then root path), and the output is `Jenkins did not answer for 'ci.test'`, which is exit 4 and gives `checksLookup: broken`.
- Patched copy (the `curl` line at `plot-host.sh:2067` replaced by `jen -I "$slug" api "$path/api/json?$tree"`): one `jen` call, and the output is `[{"conclusion":"FAILURE",…,"sha":"f9a88cf000"}]`.
- Patched, with `jen api` exiting 1 and stdout empty (401): `Jenkins did not answer`, exit 4.
- Patched, with `jen api` exiting 0 and HTML on stdout: `Jenkins did not answer`, exit 4.

The `$tree` string passes through the stub unchanged (`…%7B0,60%7D`). So the proxied test is "`curl` answers 302 HTML, `jen api` answers builds, and the row binds". It is red before the change and green after.

### 2. The healthy case can be stubbed, but only to prove the transport, not that the instance accepts it (read)

On an instance that answers both transports, the outcome is the same either way. A test can only tell the transports apart by recording argv: `jen -I <slug> api /job/…/api/json?tree=…` must appear, and a `curl` stub that records its calls must receive none. A stub cannot show that a real instance without a proxy accepts what `jen` sends. `jen`'s source says it does not:

- `/Users/jwloka/bin/jen:159-180` (`jen_token`): with no `JEN_TOKEN` and no stored Keycloak token, `jen` prints `error: not logged in` and returns 1. `jen_auth_args` (`:307-318`) calls it first, so `jen api` exits 1 on every machine that has no Keycloak sign-in. That includes a Linux or CI agent with only `JENKINS_USER`/`JENKINS_API_TOKEN`. Today that agent works through `jenkins_rest_credential` (`plot-host.sh:1922-1929`, comment `:1986-1987`: "a Linux agent legitimately has none").
- `jen:12-18`: `jen` sends the Jenkins credential as `X-Jenkins-Authorization: Basic …`, "which the edge promotes to Authorization for the backend". Jenkins with no such edge receives `Authorization: Bearer <keycloak>` and no Basic header.

The plan's table row "`jen api` on an instance without proxy: HTTP 200" therefore has no measurement behind it. The plan's own sentence ("The path passed testing on an instance without a proxy, where plain basic auth works") is about the `curl` path. A stubbed "healthy" test encodes this assumption and cannot refute it.

### 3. The `jen` wrapper already brackets the call, so "the bracket stays as it is" double-counts (ran)

`plot-host.sh:3905-3915` defines a `jen()` function that runs `host_slot_take jenkins ''` and `budget_record_call jenkins ''` around `command jen`. The plan keeps the outer `host_slot_take`/`budget_record_call` at `:2066-2068`. I ran the patched copy with a private `PLOT_BUDGET_HOME`. It made one transport call and wrote two `jenkins` rows to `budget.tsv`. The current code writes one row per call. When `budget_rate` has an `actual` or `predicted` basis, the inner take also waits for a second slot while the outer slot is held: up to `PLOT_SLOT_WAIT_MAX_S=30` (`:3846`) per path when the bound is 1. No test in the plan catches this. The existing budget tests do not count Jenkins rows per sha read.

### 4. The existing tests: what breaks, what turns vacuous, what inverts (read, plus one run)

A grep for the transport fixtures (`makeJenkinsPrRestStub`, `makeCurlAnswering`, `makeJenkinsRestBin`, `makeJenkinsRestStub`, inline `curl` stubs, `security` stubs, `jenkins_rest_credential`) touches about 70 `test(` blocks between `host.test.mjs:1461` and `:5263`. The plan covers all of them with one sentence: "needs matching changes".

- `makeJenStub` (`:2654-2706`) has no `api` arm. Its default branch prints nothing and exits 0. After the change, every test that expects a build answer gets `Jenkins did not answer`. So they go red, which is correct, but each test then needs a new fixture.
- These tests become vacuous and keep passing for the wrong reason. `:3038` asserts that with no credential, `curlCalls` is `[]`. After the change it is always `[]`. `:3308` and `:3376/:3382` keep their meaning only through the paired `callsOf(jen.callsFile)` assertion.
- These tests invert. `:5016-5020` asserts that `run-for-sha` makes no `jen` call at all ("the sha route does not go through `jen`"). `:4516` asserts that a slug resolves through `jen auth status` before the credential lookup. `:3605` fixes the `pr-list` refresh at exactly 3 `jen` calls. The sha read now adds `api` calls to that count only when it runs, so the slice must state which count applies.
- These tests are deleted together with the helpers. `:4534`, `:4565`, `:4578` (`jenkins_resolve_host`), `:4495`, `:4998`, `:3029` (the "no Jenkins API credential" refusal), and `:5129-5280` (env and `.env` pair, half pair, precedence, no secret leak). The `.env` source has no replacement: `jen` reads `JENKINS_USER`/`JENKINS_API_TOKEN` from the environment only (`jen:269-270`), not from `.env`. So the plan removes a shipped feature (`jenkins-credential-from-env`) without naming it.
- `sourcedJenkinsShaRuns` (`:4899-4909`) stubs `curl()` as a shell function and puts no stub `jen` on PATH. After the change, the `jen` wrapper runs `command jen`, which is the real `jen` on a developer's PATH (`~/.local/bin/jen` here), against `ci.test`. The test then reaches the network instead of failing cleanly.
- `packages/domain/src/rules/pr-status.ts:60` filters the `JENKINS_USER and JENKINS_API_TOKEN read from …` notice, and `packages/domain/test/pr-status.test.ts:112-125` pins that. Nothing prints the notice after the change. The filter stays harmless, but the plan should say whether it stays.

### 5. The plan's open questions, answered from `jen`'s source (read)

- 302 and 401: `cmd_api` (`jen:1578-1670`) does not follow redirects (no `-L`). A 3xx to `/oauth2/` or to the realm host exits 1 with `error: HTTP 302 — … the SSO session expired` on stderr and nothing on stdout. Any other 3xx outside the instance also exits 1. 401 and 403 exit 1, and so does every status ≥ 400. A 3xx inside the instance exits 0 and prints the body. On success the body goes to stdout with a trailing newline. The `|| true` and `jq -e 'has("builds")'` then read every failure as "did not answer", and `checksLookup` stays `broken`. That is honest. The stub must model the failure as "exit 1, empty stdout", which is what `jen` does. "Exit 0 with an HTML body" is not what `jen` does.
- Minimum `jen` version: this machine has `jen 0.4.0`, and it ships `api`. Help output does not say which version first shipped it, and I did not find out. An older `jen` without `api` falls through `jen`'s dispatch. The slice has to decide whether that reads as "did not answer" or as a named refusal, and a stub arm for "unknown command, exit 1" has to pin that decision.

## Required amendments

1. Measure `jen -I <slug> api …/api/json?tree=…` against an instance with no oauth2-proxy, on a machine with no Keycloak sign-in and only `JENKINS_USER`/`JENKINS_API_TOKEN` set. Record the result in the table, or remove the "Instance without proxy: HTTP 200" cell. If it fails, as `jen:159-180` and `jen:12-18` predict, the Approach must keep `curl -u` for that case and state how the function chooses (for example: `jen api` first, and `curl -u` with the env, `.env` or keychain pair when `jen` exits 1). Without that decision, the slice regresses every Linux or CI agent that works today.
2. Remove the outer `host_slot_take`/`host_slot_give`/`budget_record_call` around the call at `plot-host.sh:2066-2068`, because the `jen()` wrapper at `:3905-3915` already does both. Add a test that counts exactly one `jenkins` ledger row per path asked.
3. Name the new tests, each with the reason it fails before the change:
   - (a) Proxied: a `curl` stub answers 302 login HTML, the `jen` stub's `api` answers builds, and `pr-list --rich` binds the row and has no `checksLookup`. It is red today, because the result is `broken`.
   - (b) Transport: `run-for-sha` records `jen -I ci.test api /job/…/api/json?tree=builds%5B…` and zero `curl` calls. It is red today.
   - (c) `jen api` exits 1 with empty stdout. The result is exit 4 `Jenkins did not answer`, `checksLookup: broken`, and the pass stops asking (two `api` calls, then none for the next row). This replaces `:3041`.
   - (d) The budget count from amendment 2.
4. Give the migration recipe for the existing tests. Add an `api` arm to `makeJenStub` that takes a per-path body, a per-path exit code and an argv record, and replace the four `curl` fixtures with it. List the tests the slice deletes (`:3029`, `:4495`, `:4534`, `:4565-4605`, `:4998`, `:5129-5280`), the tests it inverts (`:5016`, `:4516`), and the call count it restates (`:3605`). Replace the `curl()` function in `sourcedJenkinsShaRuns` with a `jen()` function, so that no test can reach the real `jen`.
5. State what happens to the `.env` credential source, `JENKINS_USER`/`JENKINS_API_TOKEN` read from `.env`. Either the slice exports the pair to `jen`'s environment and keeps the tests at `:5144-5245`, or the plan names the removal of a shipped feature in its Changelog.
6. Answer the open questions in the plan from finding 5, and pin the old-`jen` behaviour with one stubbed test.

## What I ran and what I only read

Ran:
- `jen --version` (0.4.0), `jen --help`, `jen api --help`.
- A sourced harness in `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-testability/`, with PATH stubs for `curl` and `jen`. It ran current `jenkins_sha_runs` against a patched copy for four modes: proxied ok, 401, followed-HTML, and budget count.

No Jenkins instance was called, no repository file was changed except this verdict, and I did not run `host.test.mjs`.

Read:
- The plan.
- `skills/plot/scripts/plot-host.sh` at `:1770-1960`, `:1960-2105` and `:3824-3915`.
- `skills/plot/scripts/plot-config.sh:245-255`.
- `test/reconcile/host.test.mjs` at `:2645-2710`, `:2855-3070`, `:3285-3312`, `:3595-3700`, `:3995-4030`, `:4495-4600`, `:4880-4912` and `:5010-5280`.
- The source of `/Users/jwloka/bin/jen`: `jen_token`, `jen_auth_args`, `jen_check_http`, `cmd_api` and the header.
- `git grep` for the credential notice in `packages/`.
