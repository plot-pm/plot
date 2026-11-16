# Estate juror: jenkins-reads-in-process

Position: amend

The plan reuses the right pieces (`connectorHttps`, `throttledOf`, `rowsToBind`, `bindChecks`, `jenkinsConclusion`, `newestPerSha`, `rules/env-file.ts`, `rules/host-transport.ts`), and its `plot-host.sh` references hold. Four estate facts break slices as written: `hostReadsFor` has four callers besides fleetd, `connectorHttps` can only send a JSON body, the rules the client copies come from `jen` and not from `plot-host.sh`, and `jen` 0.4.0 ignores `JEN_URL_PATTERN` in the environment. Each one has a named edit below. None of them makes the plan unsound.

## 1. Existing deliverables

No slice deliverable exists. Commands: `ls packages/domain/src/adapters/{build,host,tracker}`, `ls packages/domain/corpus`, `grep -n jenkins packages/fleet/test/census/stub-host.ts` (0 hits), and a grep over `docs/plans/*.md` for a Draft, Design or Approved plan that names Jenkins (only this plan). No Jenkins client, no stub Jenkins route and no stub `jen` exist. The `sandbox.ts:265-267` stubs are `gh`, `bb` and `curl`.

The estate does hold parts the plan does not name:

- `rules/bitbucket-budget-account.ts:22`: `bitbucketBudgetAccount(null, override)` already answers `PLOT_BUDGET_ACCOUNT`, else `unknown`. That is the whole of `budget_account ''` (`plot-host.sh:3523-3542`). `corpus/bitbucket-budget-account.corpus.test.ts:52-54` already lifts `budget_account` out of `plot-host.sh` with awk. For Open Question 3, add a row with an empty connector to that corpus, or extract the shared fallback. A third account rule is not needed.
- `skills/plot/scripts/board/plot-jenkins-pr-checks.mjs` exists, as the plan says.
- `packages/fleet/test/census/bitbucket-jenkins.census.test.ts` already holds a `CI: jenkins` fixture with a `host reads:` start line (`:64-67`).

## 2. Factual claims checked

- `plot-host.sh` is 6,033 lines (`wc -l`). These lines name what the plan says (checked with `sed -n`): `:1754`, `:1758`, `:1762-1768`, `:1771-1779`, `:1792`, `:1806`, `:1852`, `:1895-1899`, `:2024`, `:2027`, `:2032-2034`, `:2076`, `:2101`, `:2212-2217`, `:3523`, `:3828`, `:3909`, `:4595`, `:4767`, `:4941`, `:5047`, `:5125`, `:5203`, `:5927`. `jen()` takes `host_slot_take jenkins ''` and writes `budget_record_call jenkins ''`, so the account claim of Open Question 3 is true.
- Domain and fleet references (checked with `sed -n`): `build-jenkins.ts:22,50,96`, `build-shell.ts:150`, `build-resolve.ts:43-44`, `host-reads.ts:24,31,39,126-130,209`, `jenkins-pr-checks.ts:38,72,109`, `connector-https.ts:119,152`, `pr-status.ts:116`, `fleet-clock.ts:284`, `pr-refresh.ts:1467-1469`, `default-branch-refresh.ts:56,143,299,304`, `release-world.ts:71`, `revert-start.ts:204,345`, `workflows/merge.ts:465`, `worker-loop.ts:240,1072`, `board.ts:696`, `merge-ports.ts:61`, `auto-merge.ts:322`, `registryd-main.ts:3371`. All are correct. `repair-start.ts:106` is correct for `packages/fleet/src/shared/repair-start.ts`; `packages/domain/src/rules/repair-start.ts:106` is a blank line, so the path needs its package.
- **`JEN_URL_PATTERN` is wrong.** `jen:6` reads `JEN_URL_PATTERN="https://jenkins-ci-{slug}.internal.quatico.dev"`, a plain assignment and not `${JEN_URL_PATTERN:-…}`, so `jen` 0.4.0 ignores the variable in the environment. The override that `jen` honours is `JEN_URL` (`jen:86-88`, `jen_instance_url`), and the plan does not mention it. `jen_url_for` is at `jen:50-60`, not `:47-60` (`:47` is its comment).
- **`JEN_CONFIG_DIR` is incomplete.** Its default is `${XDG_CONFIG_HOME:-$HOME/.config}/jen` (`jen:31`), not `~/.config/jen`.
- **Secret keys.** The per-instance keys are `jenkins-user:<host>` and `jenkins-token:<host>`, where `<host>` is `jen_key_for` (`jen:81`): the resolved URL's lowercased host and port (`jen_url_host`, `jen:66`). The file backend stores them as `jenkins-user_<host>.secret`, with `:` and `/` mapped to `_` (`jen_secret_file`, `jen:121`). A legacy key under the raw slug is migrated on read (`jen_migrate_instance_keys`, `jen:230-260`). The plan says only "per-instance secrets `jenkins-user:<host>`".
- **The job path rule is not named.** `jen job view` and `jen job list` turn `a/b` into `/job/a/job/b`, with the branch percent-encoded through `jq @uri` (`jen_job_path`, `jen:481-498`). `job list --json` prints `.jobs` of `api/json?tree=jobs[name,_class,color]` (`jen:1033-1044`), and `job view` asks `tree=name,fullName,url,_class,color,…,lastBuild[…]` (`jen:1086`).
- **The transport accepts JSON bodies only.** `connector-https.ts:174` runs `JSON.stringify(call.body)`, and `:190` sets `Content-Type: application/json`. The Keycloak token endpoint takes `application/x-www-form-urlencoded`.

## 3. Done when rows

Most rows name a check that fails before the change and passes after it. These rows do not:

- *The instance URL resolves as `jen` resolves it*: the "with `JEN_URL_PATTERN`" half compares against a `jen` that ignores the variable. If the rule honours the variable, the row fails for the wrong reason. If the rule ignores it too, the row passes before the change. The row also needs `jen` installed, and no file under `.github/workflows/` names `jen`, so the row cannot run in CI.
- *Both transports read the same Jenkins answers*: the shell side reads through a stub `jen` that serves "the same recordings". `jen`'s own handling of a `3xx` to `/oauth2/`, an HTML body and a `4xx` (`jen_check_http`, `jen:348`; the `.jobs` projection) would then come from the stub and not from `jen`. The row can pass while the client disagrees with the real `jen`.
- *An idle pass starts no process* (P12 green) is sound. The existing assertion `reads the rich open pull requests through the shell` (`bitbucket-jenkins.census.test.ts:51-55`, `bbOpenReads(box) > 0`) fails after the cutover, and the plan does not say that the cutover inverts it.
- Open Question 4 has no row. No row asserts that the GitHub listing overlays Jenkins colours after `SHELL_CI` is emptied.

## 4. Missing or wrong, slice by slice

- **Cutover: `SHELL_RICH_CI` and `SHELL_CI` are module constants that every `hostReadsFor` caller reads.** The callers are `registryd-main.ts:3138` (fleetd), `pr-reader.ts:134,137` (the board's PR reader, which writes the PR index when no fleetd runs), `board/.../state-branch.ts:69` and `board/.../merge-ports.ts:39`. If the constants are emptied and only fleetd builds a Jenkins client, those callers read rich PRs in-process with no overlay. On a Bitbucket or GitHub repository with `CI: jenkins` and no fleetd, the board's reader then writes rows that carry no Jenkins checks into `.plot/state/index/`. The merge-path host loses the overlay too, which contradicts *What stays*. The plan's *Callers in packages* lists the `buildShell` callers and none of the `hostReadsFor` callers.
- **Client: the refresh grant cannot go through `connectorHttps` as it is.** A form body or a raw body with its own content type is a change to `connector-https.ts`. The plan says the client imports no `node:https`, so that change belongs in Slice 1. The plan also does not say which ledger key, if any, the Keycloak POST charges: the realm is not the Jenkins instance.
- **Client: the copied `jen` rules are undeclared duplicates.** The plan declares duplicates of `plot-host.sh` only. The client also copies `jen_url_for` with the `JEN_URL` override, `jen_url_host` and `jen_key_for` (secret keys), `jen_secret_file`, `jen_save_token` (`expires_in // 300`, `− 30`), `jen_job_path` with `jen_urlencode`, `jen_check_http`'s redirect classification, and the `.jobs` projection. `jen` lives in a different repository and CI does not install it, so the `bitbucket-budget-account` pattern (lift the function, run it) does not work. The precedent that fits is `corpus/record-github-issues-runs.mjs` and `runs-for-sha.corpus.test.ts`: record the real CLI once against a stub server and commit the recordings.
- **Client: Plot would hardcode an organisation's URLs.** Copying `jen`'s defaults (`https://jenkins-ci-{slug}.internal.quatico.dev`, `jen:6`; `https://id.quatico.dev/realms/quatico`, `jen:28`) into `rules/jenkins-url.ts` and the client puts one company's hosts into Plot's domain. CLAUDE.md's *Project-Agnostic Design* forbids that. Today `plot-host.sh` delegates the defaults to `jen` and names no host.
- **Client: Open Question 2 option A races `jen`.** `jen` refreshes with no lock (`jen:185-200`). Where the realm rotates refresh tokens, a fleetd refresh that overlaps an operator's `jen` refresh makes one side lose. The plan records the rotation measurement and nothing for the race.
- **Cutover: no GitHub overlay work.** Open Question 4 (option A) asks for a Jenkins overlay in `githubPrListing` (`adapters/host/github-pr-listing.ts`, which names Jenkins zero times) and a corpus row against the arm at `plot-host.sh:4767`. The Cutover slice line names only `bitbucketPrListing`.
- Low risk: the CI gate *The domain names no vendor* (`ci.yml:1667-1672`) greps non-comment lines outside `adapters/`. New `rules/jenkins-*.ts` pass it only if no code line holds the word `jenkins` (for example, a `'jenkins'` connector literal). Keep such literals in `adapters/build/`. The gate passes on this checkout today (run locally, 0 hits).

## 5. The five decided questions

- Q1 (A) is consistent with the design. The file-backend path must follow `XDG_CONFIG_HOME` and the `jen_secret_file` key mapping.
- Q2 (A) is consistent with the design. It needs a declared rule for the race with a concurrent `jen` refresh, and the slice that writes the blob back must reproduce `jen_save_token`'s format.
- Q3 (A) is consistent with the design and cheaper than the plan states, because `bitbucketBudgetAccount(null, override)` already is the rule (see section 1).
- Q4 (A) is not carried into the slices or into *Done when*.
- Q5 (A) is consistent with the design: `shellReasonOf` (`rules/host-transport.ts`) already answers `PLOT_HOST_TRANSPORT=shell` first.

## Required edits

1. Correct the instance-URL facts. `jen` 0.4.0 fixes `JEN_URL_PATTERN` at `jen:6` and honours only `JEN_URL` (`jen:86`). `jen_url_for` is at `jen:50-60`. `JEN_CONFIG_DIR` defaults to `${XDG_CONFIG_HOME:-~/.config}/jen`. Rewrite the `jenkins-url` Done-when row to match.
2. Keep Plot free of `jen`'s Quatico defaults. The client must take the instance URL, or the realm URL and the pattern, from `Jenkins instance` as a full URL or from the environment (`JEN_URL`, `JEN_REALM_URL`), and keep the shell with a logged reason where none resolves. Name this rule in Slice 1.
3. List the rules the client copies from `jen` as declared duplicates: `jen_url_for` with `JEN_URL`, `jen_url_host` and `jen_key_for`, `jen_secret_file`, `jen_save_token`, `jen_job_path` with `jen_urlencode`, `jen_check_http`'s redirect classification, and the `job list --json` `.jobs` projection. Hold each one with a corpus row that does not need `jen` in CI.
4. Record the shell side of `jenkins-reads.corpus.test.ts` from the real `jen` 0.4.0. Run it once against the stub server with `JEN_URL` and environment credentials, in a recorder such as `corpus/record-jenkins-reads.mjs` modelled on `record-github-issues-runs.mjs`. The stub `jen` must replay the recorded stdout, stderr and exit codes, and must not reimplement `jen`.
5. Add a form or raw body with its own content type to `connector-https.ts` in Slice 1, for the refresh grant. State which ledger key the Keycloak POST charges, or that it charges none.
6. Rework the Cutover for all `hostReadsFor` callers (`registryd-main.ts:3138`, `pr-reader.ts:134,137`, `state-branch.ts:69`, `merge-ports.ts:39`). Keep the rich read on the shell wherever the caller holds no Jenkins client, rather than emptying the constants for every caller. Add a row that proves the board's PR reader and the merge path still carry Jenkins checks with no fleetd running.
7. Add the GitHub overlay to the Cutover slice (`githubPrListing`, with a corpus row against `plot-host.sh:4767`) and add a Done-when row for it, or reverse the Open Question 4 decision.
8. State that the Cutover inverts `bitbucket-jenkins.census.test.ts:51-55` (`bbOpenReads > 0`), along with the start line at `:64-67`.
9. Reuse `bitbucketBudgetAccount(null, override)`, or extract its fallback, for the Jenkins account. Add a row with an empty connector to `bitbucket-budget-account.corpus.test.ts` instead of writing a new rule.
10. Name the guard for Open Question 2 option A against a concurrent `jen` refresh. One option: re-read the stored blob immediately before the refresh, and use the stored blob where it is newer.
11. Write `repair-start.ts:106` as `packages/fleet/src/shared/repair-start.ts:106`.
