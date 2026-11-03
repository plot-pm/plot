# Juror verdict: seams

Position: amend

The direction is right. `jen api` exists in the installed `jen` 0.4.0, it sends both headers the proxy and Jenkins need, and moving the last `curl` transport behind `jen` matches every other Jenkins call in `plot-host.sh`. The plan leaves five seams undecided, and two of them break things an unattended agent following the plan literally would ship: a doubled slot and budget bracket, and an unverified claim about unproxied instances.

## Findings

### 1. Keeping the `host_slot_take` / `budget_record_call` bracket double-counts every request (HIGH)

The plan says the bracket around each request "stays as it is" (Design › Approach). `jen` in `plot-host.sh` is not the binary: `skills/plot/scripts/plot-host.sh:3904-3914` defines a `jen()` function that already calls `host_slot_take jenkins ''`, `command jen "$@"`, `host_slot_give` and `budget_record_call jenkins ''`. The loop at `plot-host.sh:2066-2068` wraps the request in the same bracket. With `curl` that was correct; with `jen` each request then records two calls against the Jenkins budget and takes two slots.

The second slot is not free. `ci-limit` gives Jenkins a predicted limit of 60/h (`plot-host.sh:5966`), and `host_concurrency_bound` computes `60 * PLOT_SLOT_SECONDS(4) / 3600 = 0`, floored to 1 (`plot-host.sh:3820-3836`). The inner `jen()` runs in the `$(…)` subshell while the outer bracket holds the only slot, so `host_slot_take` polls for `PLOT_SLOT_WAIT_MAX_S=30` seconds before it proceeds (`plot-host.sh:3843-3878`). Wherever the Jenkins account resolves a bound, each path costs about 30 s extra, two paths per row, per row bound in `pr-list`. I did not run this; it follows from the source.

### 2. The "instance without proxy" row of the transport table is unverified and contradicts `jen`'s own design (HIGH)

The table claims `jen -I <slug> api …` answers HTTP 200 on an instance without a proxy. The plan's evidence for that column is the `curl` run ("The path passed testing on an instance without a proxy, where plain basic auth works"), not a `jen api` run. `jen` sends `Authorization: Bearer <keycloak>` and puts the Basic credential only in `X-Jenkins-Authorization`, "which the edge promotes to Authorization for the backend" (`/Users/jwloka/bin/jen:9-18`, `jen_auth_args` at `:307-317`). A Jenkins with no edge in front never sees the Basic header and sees a bearer, which `plot-host.sh:1915-1917` records Jenkins answering with a login redirect (measured 2026-09-10). `jen api` also refuses before any request when no Keycloak token exists (`jen_token`, `jen:159-180`, "not logged in", exit 1).

So for a Jenkins that requires authentication and has no oauth2-proxy, this change turns a working `curl -u` read into `Jenkins did not answer`. Rubric question 1 ("for proxied and unproxied instances") is answered only for the proxied case. In practice every Quatico instance follows `JEN_URL_PATTERN=https://jenkins-ci-{slug}.internal.quatico.dev` (`jen:6`), and `jenkins_build_map` already needs `jen` to work, so the regression may have no live victim. The plan must say so with a measurement, not assert 200.

### 3. The `.env` credential source disappears, and the changelog does not say so (MEDIUM)

`jenkins_rest_credential` reads `JENKINS_USER` / `JENKINS_API_TOKEN` from the environment, then the repository `.env` and the main checkout's `.env` (`plot_env_file`), then the keychain (`plot-host.sh:1922-1929`). Two shipped changes added the `.env` source for Linux agents and CI (`CHANGELOG.md:1838`, #1936; `CHANGELOG.md:1909`, #2263). `jen` honours the two environment variables (`jen:269-270`) but never reads Plot's `.env`, and it additionally needs a Keycloak bearer (`JEN_TOKEN` on a machine with no keychain). The plan's Changelog line names only the gain. A reader of the release notes cannot learn that `.env` no longer supplies the Jenkins credential.

### 4. Two comments outside the function keep the old claim (MEDIUM)

The plan rewrites "the comment above `jenkins_sha_runs`". The same claim stands at `plot-host.sh:5110-5123`, in the `run-for-sha` / `runs-for-sha` arm: "`jen` has no changesets subcommand and no raw-API passthrough", and "The fetch, credential and match rule live in `jenkins_sha_runs`". Both become false. `plot-host.sh:1946-1953` (the `jenkins_resolve_host` comment) goes with the function. `docs/sprints/2026-W39-the-jenkins-team-sees-its-builds.md:158` says the same about `jen 0.4.0`; it is a dated sprint record, so it can stay.

### 5. The refusal text names `$host`, which the change removes (MEDIUM)

`plot-host.sh:2101` prints `Jenkins did not answer for '$host'`. `$host` is assigned only by the `jenkins_resolve_host` branch the plan deletes. `plot-host.sh:642` sets `set -uo pipefail`, so a `host` left out of the `local` list aborts with "unbound variable", and one left in prints an empty name. The plan does not say what the refusal names afterwards. Name `$slug`.

### 6. `jen api` has no timeout; the `curl` call had 30 s (MEDIUM)

`plot-host.sh:2067` passes `--max-time 30`. `cmd_api` runs `curl -sS -g -w … "${url}${path}"` with no timeout (`jen:1651-1655`). A Jenkins that accepts the connection and never answers now holds `pr-list` and the fleet scan indefinitely. Other `jen` calls in `plot-host.sh` (`:1781`, `:1795`, `:1841`) are equally unbounded, so the change only extends an existing gap, but it removes the one bound the Jenkins path had. The plan does not mention it.

### 7. How `jen api` fails (rubric 4, open question 1, answered from source)

Read from `cmd_api` (`jen:1600-1665`) and `jen_check_http` (`jen:335-399`):

| Answer | `jen api` exit | stdout | stderr |
|---|---|---|---|
| 200 | 0 | body | — |
| 3xx to `/oauth2/` or the realm host (the proxy challenge) | 1 | empty | `HTTP 302 — redirected to the identity provider; the SSO session expired` |
| 3xx inside the Jenkins host | 0 | the redirect body, usually empty | — |
| other 3xx | 1 | empty | `unexpected redirect` |
| 401 / 403 | 1 | empty | which token was sent and why it was rejected |
| 404 and other ≥ 400 | 1 | empty | status and the first five lines of the body |
| no Keycloak token, refresh failed | 1 | empty | `not logged in` / `session expired and refresh failed` |
| transport failure | 1 | empty | curl's message |

With `|| true` and the `has("builds")` test, every non-200 row gives an empty or non-JSON `try`, so `checksLookup` stays `broken` and never becomes an answer. One behaviour changes: a 404 branch path used to hand the 404 body to `jq`; now stdout is empty. Jenkins' 404 for `/api/json` is HTML, so `branch_answered` stays unset either way, and the branch-not-indexed refusal is unaffected. The cost of `2>/dev/null` is that the actionable line (`SSO session expired — Run: jen auth login`, the 401 hint) is discarded and the person sees only `Jenkins did not answer`. Keeping `jen`'s first stderr line in the refusal is cheap and is what the `jenkins_build_map` arm already does with `auth status`.

### 8. Minimum `jen` version (open question 2)

The installed `jen` is 0.4.0 (`jen --version`) and has `api` (`jen:1808`). Every cached copy of the `working-with-jenkins-api` plugin on this machine (quatico-internal 2.27.0 to 2.30.0) carries `JEN_VERSION="0.4.0"` with `api`. The marketplace clone has a one-commit shallow history, so I could not find the first version with `api`. `plot-host.sh:1776` names 0.2.0 only as the version whose `auth status` wording was measured, not as a minimum. A `jen` without `api` answers `unknown command: api`, exit 1 (`jen:1812-1816`), which the plan's handling turns into `Jenkins did not answer`, a refusal that sends a person to look at Jenkins rather than at `jen`. The slice should name 0.4.0 as the minimum it was tested on, and match `unknown command: api` on stderr into a refusal that names the version.

### 9. `Default branch job` comment (open question 3)

`skills/plot/scripts/plot-config.sh:248-256` says the key is "Read by `jenkins_sha_runs` only". The change keeps the read at `plot-host.sh:2051`, so the comment stays true unchanged.

### 10. Claims checked against the source (rubric 2)

- `jenkins_sha_runs` at `plot-host.sh:2047`: true.
- "the only call sites are lines 2055 and 2058": true inside `plot-host.sh`. Outside it, `test/reconcile/host.test.mjs:4560` sources and calls `jenkins_resolve_host`, `:4902-4903` stubs both helpers, and `:5079-5140` tests the credential sources. No bundle under `skills/plot/scripts/board/` and no TypeScript under `packages/` calls either helper.
- "Every other Jenkins call goes through `jen`": true (`:1781`, `:1795`, `:1841`, `:1955`).
- The `packages/domain/src/rules/pr-status.ts:66` regex filters the stderr line `JENKINS_USER and JENKINS_API_TOKEN read from …` that `jenkins_rest_credential` prints (`plot-host.sh:1925`). After the change that alternative never matches. It is harmless; removing it touches the domain package and its tests (`packages/domain/test/pr-status.test.ts:112-125`), so it belongs in a follow-up, and the plan should say which.

### 11. Tests: the scope is larger than "matching changes" (rubric 5 and 6)

`test/reconcile/host.test.mjs` refers to the `curl` stubs and `curlCalls` 129 times across the Jenkins tests from about line 2860 to 5140, including the Bitbucket `pr-list` / `pr-state` tests at `:3296-3573`. `makeJenStub` (`:2660-2705`) answers `auth`, `job view` and `job list` and exits 0 with no output for anything else, so every converted test needs an `api` arm keyed on the requested path (branch segment versus root, as the `curl` stubs at `:4010` and `:4400-4457` key on it today).

One test's invariant meets this change head-on: `a Jenkins refresh costs a fixed number of calls` (`:3585-3612`) counts every `jen` invocation and asserts exactly 3. Today a sha read goes to `curl` and is invisible to that count; afterwards it is a `jen` call. The plan must say whether a per-row sha read counts in that budget. Tests that assert "with no credential, nothing reaches Jenkins" (`:3038`) lose their subject and must be deleted, not adapted.

A stubbed `jen` cannot tell a proxied instance from an unproxied one, because the proxy lives behind `jen`. The test that fails before the change and passes after is: a `curl` stub on `PATH` that answers the oauth2 302 / login HTML, and a `jen` stub whose `api` arm answers the builds JSON. The old code reaches `curl` and refuses; the new code reaches `jen` and answers. The plan should name that test.

### 12. Gates and the rest of the estate (rubric 3)

- `scripts/check-host-cli-callers.sh`: unaffected; the call stays in `plot-host.sh`.
- Shell-lines ratchet (`scripts/check-shell-lines.sh`): the change removes about 30 lines net, so it passes.
- Bash 3.2: the replacement uses no new construct.
- Bitbucket arm: `pr-list` (`plot-host.sh:4939`) and `pr-state` reach the same `jenkins_sha_runs` through `jenkins_bind_rows`, so they gain the fix with no change of their own. Only their tests need converting.
- One branch is the right size: the transport, the helper removal and the test conversion cannot land separately without a red window.

## Amendments required

1. Drop the explicit `host_slot_take jenkins ''` / `host_slot_give; budget_record_call jenkins ''` lines around the request, because the `jen()` wrapper (`plot-host.sh:3904`) already takes the slot and records the call. Add a test that one sha read records exactly one Jenkins call in the budget ledger.
2. Replace the "Instance without proxy / `jen api`" table cell with a measurement (instance, command, status), or mark it unmeasured and state that a Jenkins with no oauth2-proxy and no anonymous read loses the sha read. Name the instances Plot supports through `jen` in the Changelog.
3. Add to the Changelog that Plot no longer reads `JENKINS_USER` / `JENKINS_API_TOKEN` from `.env` or the keychain for the sha read; `jen` reads the environment variables and its own store, and needs a Keycloak bearer (`JEN_TOKEN` where no keychain exists).
4. Name every comment the slice rewrites: above `jenkins_sha_runs` (`plot-host.sh:1971-1974`, `:2044`), the `run-for-sha` arm (`:5110-5123`), and the `jenkins_rest_credential` / `jenkins_resolve_host` blocks that go with the functions.
5. State the refusal wording after the change: it names `$slug`, not `$host`, and it carries `jen`'s first stderr line instead of discarding it with `2>/dev/null`. Name 0.4.0 as the minimum `jen` and turn `unknown command: api` into a refusal that says so.
6. State a decision on the missing timeout: either bound the `jen api` call (the repo's existing timeout helper if one exists, otherwise a background-and-kill bound) or record that it is unbounded like the other `jen` calls, as a follow-up.
7. In the test plan, name the proxy discriminator test (finding 11), the decision for the 3-call budget test at `host.test.mjs:3585`, and the list of credential tests to delete (`:3038`, `:4546-4565`, `:5079-5140`).

## What I ran and what I only read

Ran: `jen --version` (0.4.0), `jen --help`, `jen api --help`; a search of every cached `working-with-jenkins-api/bin/jen` for its version and an `api)` arm; `git log` on the plugin marketplace clone (one commit, shallow); `grep` across `skills/`, `packages/`, `docs/`, `test/` and `CHANGELOG.md` for the two helpers, `JENKINS_API_TOKEN` and `curl`. I called no Jenkins instance and ran no test.

Read: the plan; `plot-host.sh:280-296, 1905-2105, 3815-3915, 5100-5135, 5950-5975`; `plot-budget.sh:700-800`; `/Users/jwloka/bin/jen` (header, `jen_token`, `jen_auth_args`, `jen_check_http`, `cmd_api`, dispatch); `test/reconcile/host.test.mjs:2660-2705, 2860-3015, 3296-3312, 3585-3612`; `scripts/check-host-cli-callers.sh:1-60`; `plot-config.sh:244-256`; `packages/domain/src/rules/pr-status.ts:37,66`.

Not verified: whether `budget_rate` resolves a Jenkins bound on a live machine (finding 1's 30 s wait depends on it; the doubled ledger record does not), and which `jen` version first shipped `api`.
