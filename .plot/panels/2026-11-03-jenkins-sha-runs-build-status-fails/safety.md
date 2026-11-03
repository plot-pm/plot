# Safety juror

Position: amend

The transport change is right and reduces a false-colour risk: today `jenkins_build_map` reads through `jen` and succeeds behind the proxy while `jenkins_sha_runs` fails, and on GitHub `pr-list` a broken sha ask leaves a named row standing on its branch colour (`plot-host.sh:4755-4763`). One auth path for both reads removes that split. Under the plan as written, no `jen api` failure mode I found reads as a green or red build: every failure gives empty or non-JSON stdout, fails `jq -e 'has("builds")'`, and exits 4. The plan still carries one concrete defect (a doubled slot bracket), drops the 30 s request bound, prints a refusal with an empty host, and leaves the old-`jen` and credential-source cases undecided.

## Findings

### F1. Keeping the slot bracket around `jen` leaks a slot and double-counts the budget (HIGH)

The plan says the `host_slot_take` / `budget_record_call` bracket "stay as they are" (`plot-host.sh:2066-2068`). `jen` in `plot-host.sh` is a shell function (`plot-host.sh:3905-3915`) that takes and gives its own slot and records its own call. A nested `host_slot_take` first clears `PLOT_SLOT_INDEX` (`plot-host.sh:3856`). Then the inner `host_slot_give` releases the inner slot and clears the index, so the outer `host_slot_give` finds nothing and the outer slot stays claimed. `budget_slot_held` keeps a claim while its pid lives (`plot-budget.sh:907`), and `$$` in the `$(jenkins_sha_runs …)` subshell is the parent pid, so the leak lasts for the whole `plot-host.sh` run. With a bound of 1 (`host_concurrency_bound`, `plot-host.sh:3835`), each later request waits `PLOT_SLOT_WAIT_MAX_S=30` (`plot-host.sh:3846`) before it proceeds. `jenkins_bind_rows` asks up to `SHA_LOOKUPS_PER_PASS` rows, two paths each. Every call also records two budget lines. The failure is slow, not false, but it can push a pass past a caller's bound, and the pass then reads `broken`.

### F2. The 30 s request bound disappears (MEDIUM)

The current call carries `curl --max-time 30` (`plot-host.sh:2067`). `jen api` builds its own `curl -sS -g` with no `--max-time` or `--connect-timeout` (`~/bin/jen` `cmd_api`, grep for `max-time` in `jen` finds nothing). A proxy that accepts the connection and does not answer now holds `pr-state`, `pr-list` and `runs` with no bound. The plan does not mention this.

### F3. The refusal names an empty host (MEDIUM)

`Jenkins did not answer for '$host'` (`plot-host.sh:2096`) reads `$host`, which the plan stops setting when it removes `jenkins_resolve_host`. `local` declares it, so `set -u` (`plot-host.sh:642`) does not catch it, and the message prints `for ''`. The plan also sends `jen`'s stderr to `/dev/null`, which discards the one line that tells an operator what to do: `error: HTTP 302 — redirected to the identity provider; the SSO session expired / Run: jen auth login`, or the 401/403 "No Jenkins API token was sent" hint.

### F4. Open question 1 answered: how `jen api` fails (read from `jen` 0.4.0 source)

| What the instance does | `jen api` exit | stdout | Result in `jenkins_sha_runs` |
|---|---|---|---|
| 3xx to `/oauth2/` or the Keycloak realm | 1 | empty | "did not answer", exit 4 |
| 3xx to another host | 1 | empty | "did not answer", exit 4 |
| 3xx inside the Jenkins host | 0 | the redirect body (empty or HTML) | fails `has("builds")`; on the branch path it is not JSON, so not `branch_answered`; exit 4 |
| 401 or 403 | 1 | empty | exit 4 |
| other ≥ 400 (404 on a branch segment) | 1 | empty; status and five body lines to stderr | falls through to the root path, as today |
| 200 with an HTML login page | 0 | HTML | fails every `jq` test; exit 4 |
| no Keycloak token (`jen_token`: "not logged in") | 1 | empty | exit 4 |
| `jen` not on PATH | 127 | empty | exit 4 |
| curl transport error | 1 (`|| exit 1`) | empty | exit 4 |

So `checksLookup` reads `broken` (Bitbucket) or the row keeps its existing colour-stand rule (GitHub, F8) in every case, never a fresh answer. One behaviour changes: a 404 on the branch path used to return Jenkins' HTML body to stdout and now returns nothing; neither is JSON, so `branch_answered` is unaffected.

### F5. Open question 2: an old `jen` fails safe but says the wrong thing (MEDIUM)

`jen` 0.4.0 is installed here and ships `api`. The marketplace clone is shallow (one commit, `e4cefe8`, 2026-10-31), so I could not find the first version that ships it. A `jen` without `api` reaches the dispatcher's `*)` arm: `unknown command: api`, usage to stderr, exit 1. The function then prints "Jenkins did not answer", which sends the operator to the network or the login rather than to an upgrade. The plan must decide this, not leave it open: `jen` 0.4.0 is the only verified version.

### F6. The credential sources narrow, and an instance without the auth edge regresses (MEDIUM)

`jenkins_rest_credential` reads `JENKINS_USER`/`JENKINS_API_TOKEN` from the environment, then `plot_env_file` (`.env`), then the keychain (`plot-host.sh:1922-1928`). `jen` reads the environment and its own secret store, not Plot's `.env`. `jen` also always needs a Keycloak bearer: `jen_auth_args` returns 1 when `jen_token` finds none, and it sends the Jenkins Basic credential only in `X-Jenkins-Authorization`, which the Quatico edge promotes to `Authorization` (`jen` header comment, `jen_auth_args`). A plain Jenkins with no such edge reads `Authorization: Bearer <keycloak>`, so a request that needs auth answers 401 or 403. Today a Linux agent with only `JENKINS_USER`/`JENKINS_API_TOKEN`, or an unproxied instance, reads build status with `curl -u`; after the change it reads `broken`. That is an honest failure, not a false colour, but the plan's table says "instance without proxy: HTTP 200" for `jen api` without naming the instance, and its Motivation says "plain basic auth works" — true for `curl -u`, not for `jen`. The removed stderr line is still matched by `packages/domain/src/rules/pr-status.ts:66`, which becomes dead.

### F7. Credentials in arguments and logs (LOW, no regression)

Today `curl -u user:token` puts the Jenkins token in `plot-host.sh`'s child argv, visible to `ps`, and in any `set -x`/PS4 trace of `plot-host.sh` (`cred` is a local there). After the change, `plot-host.sh` holds no credential; `jen` puts both the bearer and the Basic header in its own curl argv (`-H "Authorization: Bearer …"`, `-H "X-Jenkins-Authorization: Basic …"`). The argv exposure moves, it does not grow, and the trace exposure in `plot-host.sh` goes away. `jen api` prints at most five response-body lines to stderr on an error; Jenkins error bodies do not echo request headers. If the slice forwards `jen` stderr into the refusal (amendment A3), forward only the `error:` line.

### F8. A broken ask on GitHub `pr-list` still keeps the branch colour (pre-existing, not required here)

`plot-host.sh:4755-4763`: a row `$named` lists and `$shamap` misses "stands on its colour", and that colour may belong to an older head. This is the path #3061 produced on GitHub repos, and it still runs on every failure in F4. The fix removes the systematic trigger. The residual case deserves its own issue; it is outside this plan's scope.

### F9. Claims checked against the source

- `jenkins_sha_runs` at `plot-host.sh:2047`: true.
- "the only call sites are lines 2055 and 2058": true for `plot-host.sh`. `test/reconcile/host.test.mjs` names `jenkins_rest_credential` in comments (`:2863`, `:3998`), and the bundles do not call either helper.
- `plot-host.sh:1776` names `jen` 0.2.0: true, but it describes `auth status` wording, not `api`.
- `plot-config.sh:250` "Read by `jenkins_sha_runs` only": stays true; the key is still read at `plot-host.sh:2051` (open question 3: yes).
- The comment at `plot-host.sh:5110-5114` says "`jen` has no changesets subcommand and no raw-API passthrough" and the one at `:1971` says "`jen` IS NOT THE TRANSPORT". The plan names only the comment above the function; both become false.
- The changelog names `pr-state` and `pr-list`; `runs`, `run-for-sha` and `runs-for-sha` (`plot-host.sh:5045`, `:5126`) change too.

### F10. Tests

`host.test.mjs` holds 14 `curl` stub writers. `makeJenStub` (`host.test.mjs:~2660-2704`) answers `exit 0` with empty stdout to any group it does not know, so after the change every curl-fed Jenkins test reads "did not answer" until its stub moves to `jen api`. That fails loudly, which is safe. The plan does not name a test that fails before the change: no proxied fixture exists.

## Required amendments

- **A1.** Call `command jen -I "$slug" api …` inside the existing bracket, or drop the bracket and call the `jen` wrapper. State which, and add a test that one sha read records exactly one `jenkins` budget line.
- **A2.** Keep a per-request bound of 30 s around `jen api`, with the bash 3.2 bounded-child pattern `bb_fetch_base_bounded` uses, and test that a stub `jen` that sleeps past the bound gives exit 4, not a hang.
- **A3.** Rewrite the refusal to name the slug (`for Jenkins instance '$slug'`), capture `jen` stderr, and append its first `error:` line. Test the SSO-expired case: stub `jen api` exits 1 with `error: HTTP 302 — redirected to the identity provider`, and assert exit 4, `checksLookup: broken` on Bitbucket `pr-list`, and `jen auth login` in stderr.
- **A4.** Decide the old-`jen` case: on `unknown command: api` in `jen` stderr, refuse with "`jen` has no `api` command; Plot needs jen 0.4.0 or later" and exit 4. Test it with a stub.
- **A5.** State the credential change in the plan and the changelog: build status by sha needs `jen auth login` (Keycloak bearer plus Jenkins token); `.env` and env-only `curl -u` no longer work, and a Jenkins without the header-promoting edge reads `broken`. Name the instance behind "instance without proxy: HTTP 200", or remove that row. Remove the dead `JENKINS_USER and JENKINS_API_TOKEN` alternative from `pr-status.ts:66` or say why it stays.
- **A6.** Add the proxied regression test: a `curl` stub that answers a 302 HTML page and a `jen` stub whose `api` answers the builds JSON; assert a bound green row. It fails on `main` and passes after the slice. Add one assertion that no Jenkins request reaches `curl` from `plot-host.sh`, and HTML-200 and 401 `jen api` stubs that both give `broken`.
- **A7.** Name every comment to rewrite: `plot-host.sh:1971-1974`, `:1951-1954` (removed with the helper), and `:5110-5114`; and list `runs`, `run-for-sha` and `runs-for-sha` as changed ops.

## What I ran and what I only read

Ran: `jen --version` (0.4.0), `jen --help`, `jen api --help`; `grep`/`sed` over `plot-host.sh`, `plot-budget.sh`, `plot-config.sh`, `host.test.mjs`, `packages/domain/src/rules/pr-status.ts` and the `jen` script; `git log` in the marketplace clone (shallow, one commit). I called no Jenkins instance and ran no test.

Read only: the `jen` 0.4.0 source (`cmd_api`, `jen_check_http`, `jen_auth_args`, `jen_token`, the dispatcher), from which every row of the F4 table is derived, not observed. The slot leak in F1 is derived from `host_slot_take`, `host_slot_give` and `budget_slot_held`, not reproduced.
