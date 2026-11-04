## Implementation brief — jenkins-sha-runs-build-status-fails

- **Plan (canonical):** `docs/plans/2026-11-03-jenkins-sha-runs-build-status-fails.md` on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3062 merged
- **Branch:** `feature/jenkins-sha-runs-through-jen` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review, `Review required since` applies)

One slice, no waves: the transport, the helper removal, the wrapper bound and the test migration cannot land separately without a red window.

### What to build

Issue #3061, measured on Plot 2.30.0: on a Jenkins behind an OAuth2 proxy, `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:2047`) sends `curl -u "$cred"` and the proxy answers HTTP 302 to the login page, so every PR reads `checksLookup: broken`. Every other Jenkins call in `plot-host.sh` goes through `jen`, which sends the Keycloak bearer for the proxy and `X-Jenkins-Authorization` for Jenkins. Change `jenkins_sha_runs` to send `jen -I "$slug" api "$path/api/json?$tree"` for each path it asks (branch path, then root path), with `$tree` unchanged and the JSON checks after the call unchanged. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **`jen api` is the only transport; no `curl` fallback.** The earlier comment "`jen` is not the transport because `build list --json` carries no sha" holds for `build list` only. `jen api` (jen 0.4.0, `cmd_api` at `jen:1578`) returns the sha through `tree=`; against the proxied instance it returned `{"number":1,"result":"FAILURE","sha":"f9a88cf…"}`. The loss is accepted: a Jenkins with no oauth2 edge, or a machine with no Keycloak sign-in, now reads `broken`. Do not keep the basic-auth sources (env, `.env`, main-checkout `.env`, keychain).
- **Remove, do not keep:** `jenkins_rest_credential` (`:1910-1930`), `jenkins_resolve_host` (`:1946-1957`), the `host`/`cred` locals, the slug-resolution refusals (`:2055-2057`), the "no Jenkins API credential" refusal (`:2058-2062`), `cred=""` (`:2086`). `plot_env_file` and `read_env_var` stay: `jira_load_env_file` calls them.
- **Budget: remove the outer `host_slot_take`/`host_slot_give`/`budget_record_call` bracket (`:2066-2068`) and add none.** The `jen()` wrapper (`:3905-3915`) already takes the slot and records one `jenkins` row. A nested bracket writes two rows per request and, with a slot bound of 1, stalls the inner take for `PLOT_SLOT_WAIT_MAX_S`=30 s. Each path asked writes exactly one ledger row.
- **Timeout lives in the `jen()` wrapper, not in `jenkins_sha_runs`.** `jen api` has no timeout. When `PLOT_JEN_BOUND_S` is set, the wrapper runs `command jen` in the background under `set -m`, starts a watcher `( sleep "$PLOT_JEN_BOUND_S"; kill -TERM "-$pid" ) >/dev/null 2>&1 &` (output redirected so it does not hold a `$(…)` capture pipe open), waits, kills the watcher, restores `set +m` if it was off. Slot release and the ledger row happen after `wait`, so a killed request still releases and records. Copy the bash 3.2 pattern of `bb_fetch_base_bounded` (`:2139-2157`). `jenkins_sha_runs` calls `PLOT_JEN_BOUND_S="${PLOT_JENKINS_SHA_BOUND_S:-30}" jen -I "$slug" api …`; every other `jen` call leaves it unset. A killed request reads as a failure with the line `jen api gave no answer within <n> s`.
- **Every failure ends `checksLookup: broken`, exit 4 (`unaskable`), never an answer.** A 404 on the branch path exits 1 with empty stdout and the function goes on to the root path, `branch_answered` unset. A 3xx inside the instance exits 0 with a non-JSON body and fails `has("builds")`.
- **Refusal text:** send `jen api` stderr to a `plot_tmpfile`, not `/dev/null`. Line 1: `plot-host: <op> — Jenkins did not answer for Jenkins instance '<slug>'`. Line 2: `  jen: error: <jen's first error: line>` (forward that one line only). Line 3: ``  Plot reaches Jenkins only through `jen`; run `jen auth login`.`` For `unknown command: api`: ``plot-host: <op> — the sha read needs jen 0.4.0 or later with `api` ``. For `jen` not on `PATH`: say `jen` is not installed and name the same version. The "Jenkins has no branch '<branch>' indexed" refusal does not change.
- **Minimum `jen` is 0.4.0** (`JEN_VERSION` at `jen:5`, arm `api)` at `jen:1808`). `plot-host.sh:1776` names 0.2.0 only for `auth status` wording.
- **Carried rules:** absent is not false — a `jen` that cannot authenticate is *cannot be asked*, never *no run*; an unreachable instance is not an empty history. Read the exit code, not the emptiness. `plot-host.sh` stays the one place that talks to the host CLI (`scripts/check-host-cli-callers.sh`); `curl` stays there for Jira (`:3113`) only. No bash 4 constructs.

### Comment and documentation sites to rewrite

`plot-host.sh` `:1971-1974`, `:1986-1989`, `:2034-2035`, `:2044-2045`, `:5110-5123` (`run-for-sha` arm); `packages/domain/src/adapters/build/build-jenkins.ts:78-89`; `packages/domain/src/rules/pr-status.ts:60-66` (remove the Jenkins alternative from the notice filter, keep Jira and Bitbucket) with `packages/domain/test/pr-status.test.ts:110-126` switched to the `JIRA_EMAIL and JIRA_API_TOKEN read from the environment` notice. Leave `plot-config.sh:250`, `docs/sprints/2026-W39-…:158` and `.plot/briefs/*.md` untouched (dated records). The plan's table gives the new wording of each.

### Done when

The plan's `## Slices` line and `### Tests` section are the specification. Assertions that exist because a naive implementation would pass without them:

- **Zero `curl` calls** across `run-for-sha`, `runs-for-sha`, `runs` and Bitbucket `pr-list --rich` (a `curl` stub that records argv and exits 1 is on `PATH` in every Jenkins sha test) — catches a kept fallback.
- **Ledger rows:** one `run-for-sha` answered on the branch path writes exactly one `jenkins` row; a 404 then root answer writes exactly two, in a private `PLOT_BUDGET_HOME` — catches the nested bracket.
- **Bound:** `apiSleep: 5` with `PLOT_JENKINS_SHA_BOUND_S=1` returns within 3 s, exits 4, names `no answer within 1 s`, leaves no `jenkins` slot claimed — catches a bound that kills the child but leaks the slot.
- **Proxied regression:** `curl` stub answers a 302 page, `jen` stub's `api` arm answers builds JSON; `pr-list --rich` binds with no `checksLookup`. Fails today.
- **SSO expired / old `jen` / HTML 200 / 401** each exit 4 and read `broken`, with the refusal text above.
- Migrate the existing tests exactly as the plan's table lists (`makeJenStub` gains an `api` arm with `{body, exit, stderr}` per path, `apiMissing`, `apiSleep`; delete the `jenkins_rest_credential` and `jenkins_resolve_host` blocks; replace the five REST stubs).

Plus: changeset for `plot` (patch or minor, description first, `bumps:` block last, `plan:` line inside it) and a `plot-host`-affecting skill bump only if a SKILL.md changes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this change removes shell net, so it passes — joining statements is not a payment. Run the whole `test/reconcile/host.test.mjs` file's affected names, not guesses.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh`, `test/reconcile/host.test.mjs` (and a fixture helper if needed), `packages/domain/src/adapters/build/build-jenkins.ts`, `packages/domain/src/rules/pr-status.ts`, `packages/domain/test/pr-status.test.ts`, and a changeset. No other branch for this plan; no open PR or remote branch matching `jenkins` or `plot-host` at dispatch (checked 2026-11-04). If you find something the plan did not anticipate, report it rather than improvising outside scope. Follow-ups named in the plan Notes (GitHub `pr-list` stale branch colour; bounding the other `jen` calls) are not this slice.
