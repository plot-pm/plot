Round: 2

# Estate juror: jenkins-reads-in-process

Position: amend

All eleven round-1 estate edits are answered in the plan at `3491292d8`. The plan reuses the right pieces and builds no second transport. One claim is false in a way that makes a slice fail CI: the new `rules/jenkins-*.ts` files cannot import one another, or import `rules/jenkins-pr-checks.ts`, without tripping the gate *The domain names no vendor*. One census cost claim is wrong. Both have a named edit below. Neither makes the plan unsound.

## Round-1 edits, checked

1. Instance-URL facts: answered. `jen:6` is a plain assignment, `jen:28` defaults `JEN_REALM_URL`, `jen:31` defaults `JEN_CONFIG_DIR` through `XDG_CONFIG_HOME`, `jen_url_for` starts at `jen:50`, `jen_instance_url` at `jen:85` (checked with `grep -n '^[a-z_]*() *{'` and `sed -n` on `/opt/homebrew/bin/jen`, 1,819 lines). The Done-when row now tests `JEN_URL` and an `http://127.0.0.1:<port>` value.
2. No Quatico hosts: answered (*Approach*, second paragraph; Done-when row with the `grep -n 'quatico'` check).
3. `jen` rules as declared duplicates: answered (*Slice 1*, third bullet), with `record-jenkins-reads.mjs` modelled on `packages/domain/corpus/record-github-issues-runs.mjs`, which exists.
4. The stub `jen` replays the real `jen`: answered (*Slice 1*, census bullet; Done-when *The census measures Jenkins*).
5. Form body and the refresh POST's ledger key: answered (form body bullet; *The token endpoint charges its own bucket*).
6. Every `hostReadsFor` caller: answered (decision 7). The five call sites are true: `registryd-main.ts:3138`, `pr-reader.ts:134` and `:137`, `state-branch.ts:69`, `merge-ports.ts:39` (`grep -rn "hostReadsFor("`). `pr-reader.ts:134` passes `ci: ''` only where `shellReasonOf` already chose the shell, so it needs no client.
7. GitHub overlay: answered (Cutover bullet and Done-when row).
8. Inverting `bitbucket-jenkins.census.test.ts`: answered. The case is at `:52-56` and the start line at `:64-67` (read with `sed -n 30,70p`).
9. `bitbucketBudgetAccount(null, override)`: answered. `rules/bitbucket-budget-account.ts:22` returns the override, else `unknown`.
10. Guard against a concurrent `jen` refresh: answered (lock, re-read, adopt the newer blob, torn-read retry).
11. `repair-start.ts` path: answered (`packages/fleet/src/shared/repair-start.ts:106`).

## 1. Existing deliverables

No slice deliverable exists. `packages/domain/src/adapters/build/` holds `build-actions`, `build-fixture`, `build-jenkins`, `build-none`, `build-resolve` and `build-shell`, and no Jenkins client. `rules/` holds `jenkins-pr-checks.ts` and no other Jenkins rule. `packages/fleet/test/census/stub-host.ts` names Jenkins zero times, and `sandbox.ts:265-267` writes stubs `gh`, `bb` and `curl` only. The corpus has no Jenkins recorder or Jenkins corpus test.

Pieces the plan reuses exist as stated: `connectorHttps` (`connector-https.ts:152`), `throttledOf` (`:119`), `rowsToBind` and `bindChecks` (`rules/jenkins-pr-checks.ts`), `jenkinsConclusion` and `newestPerSha` (`build-jenkins.ts`), `rules/host-transport.ts`, `scripts/check-host-https-callers.sh`, and `jira-api.ts` under `adapters/tracker/`. `connector-https.ts:49` already allows `http:` for a stub server, and `:168` builds an `http.Agent`, so the loopback rule needs no transport change. The plan does not name two pieces that Slice 3's Bitbucket corpus row can extend: `packages/domain/corpus/bitbucket-pr-listing.corpus.test.ts` and `record-bitbucket-pr-listing.mjs`.

## 2. Factual claims checked

Checked with `sed -n` and `grep -n` in this checkout:

- `plot-host.sh` has 6,033 lines. `:1754-1758`, `:1762-1779`, `:1990-2006`, `:2074-2077`, `:3069-3072` and `:3095-3098` (Bitbucket and Jira `.env` only), `:3909` (`jen()` with `host_slot_take jenkins ''`), `:4941-4961` (`_bb_jen_bind`, `$jmap`) and `:5925-5928` (`limit` 60, `predicted`) name what the plan says.
- `host-reads.ts:24` (`SHELL_CI`), `:31` (`SHELL_RICH_CI`), `:39` (`shellCiOf`), `:126-130` (the rich split) and `:209` are correct.
- `connector-https.ts:174` (`JSON.stringify`) and `:190` (`Content-Type: application/json`) are correct.
- `census-report.ts:20` (`CensusFixture` with no `ci`), `:144-145` (`entryKey`) and the last-key rule in `compareCensus` (`:183-187`) are correct.
- `ci.yml:887-892` (20 minutes, 830 s), `:1665-1672` (the vendor gate) and `:2850` (`validate`'s `needs:` without the census job) are correct.
- `registryd-main.ts:3371` is `buildShell({ repoRoot, scriptDir }, readsApi)`. fleetd reaches `buildFor` through `buildShell` (`build-resolve.ts:57-67`), so the Jenkins client must pass through `buildShell` as well. The plan names only `buildFor`.
- Wrong: the shell's Jenkins account is `budget_account jenkins`, not `budget_account ''`. `jen()` calls `host_slot_take jenkins ''` and `budget_record_call jenkins ''`, and both resolve `budget_account "${2:-$1}"` (`plot-host.sh:3863`, `budget_record_call` at `:3654`), so `$2=''` falls back to `jenkins`. The answer is the same (`PLOT_BUDGET_ACCOUNT`, else `unknown`, because `jenkins` matches no arm), but the corpus row must call it with `jenkins` to lift the shell's real call.
- Wrong: *The census cost* says the Jenkins fixture "adds one traced run and no extra untraced run". `fleetd.census.test.ts:154` is `describe.each(FIXTURES)`, and the shell baseline at `:228` calls `buildSandbox(fixture)` inside each fixture's block, so a fourth fixture adds one traced run and one untraced shell run. The 950 s estimate counts only the traced run.

## 3. Done-when rows

Each row names a check that fails before the change and passes after it. Two notes:

- *Plot names no organisation's Jenkins or realm host* greps for `quatico` but no row runs the vendor gate on the new `rules/` files. The gate runs in CI on every PR, so it holds without a row; see required edit 1 for why it will fail.
- *The Jenkins transport is visible* asks `/plot-fleet --status` to print the Jenkins transport. Today no status output prints the git-host or Jira transport: `hostTransportLine` has callers in `registryd-main.ts` and `pr-reader.ts` only, both start-log lines. The row builds a new status surface for one connector. That is not a defect, but the slice must build it, not extend it.

## 4. Missing or wrong

- **The vendor gate fails on cross-imports between Jenkins rules.** `ci.yml:1667` greps `\b(…|jenkins|…)\b` case-insensitive over code lines in `packages/domain/src/` outside `adapters/`. A module path is a code line: `printf "import { a } from './jenkins-pr-checks.js';\n" | grep -Ei '\bjenkins\b'` matches. The plan's `rules/jenkins-sha-runs.ts`, `rules/jenkins-build-map.ts` and the Bitbucket per-row projection "beside them" (*Slice 3*) will import each other's types or `rowsToBind` from `./jenkins-pr-checks.js`. Today no file under `packages/domain/src/` imports `rules/jenkins-pr-checks.ts` (`grep -rn jenkins-pr-checks packages/domain/src` finds none); its callers are the board entry and the corpus, through the package export `./rules/*`. The plan's sentence *"Literals that name `jenkins` stay in `adapters/build/`, so the CI gate … passes on the new `rules/` files"* holds for literals and not for import paths.
- **The token bucket and the slot bound.** `connector-https.ts` keys the bound on connector and account only (`boundKey`, `boundFor`), and ignores the bucket. A `token`-bucket entry with a non-`unknown` basis sets the Jenkins instance's slot bound. The plan states the instance entry's basis (`predicted` 60) and not the token entry's. Non-blocking: state the token entry's basis, `unknown` or `predicted` 60, so it cannot change the bound.
- **`jen_save_token`'s `//`.** `jen:153` is `jq -r '.expires_in // 300'`: jq's alternative operator, *`expires_in`, or 300 where absent*. The plan's `(expires_in // 300)` reads as floor division to a TypeScript author. The corpus row catches a wrong reading, so this is a wording note.

## 5. Decisions and the five added choices

The eight decisions agree with the slices. Decision 7 is carried into the Cutover bullet and a Done-when row; decision 8 into a composition row with a `.env` holding `JENKINS_API_TOKEN`; decision 6 into the unit-environment composition row.

- **Realm URL from `JEN_REALM_URL`, else the token's `iss`:** consistent. `jen` already reads claims from the stored access token (`jen_kc_claim`, `jen:210`), so decoding a claim is not new to the estate. The person's measurement row checks `iss` against the realm URL before the Client branch merges.
- **A bare slug with no `JEN_URL` keeps the shell:** consistent with *Project-Agnostic Design*. `plot-host.sh:1770` splits the slug the same way. On a repository whose `Jenkins instance` is a slug, the saving needs a config edit, and the reason line names that edit.
- **Credentials only to `https:` or loopback:** consistent. The transport sends `http:` today for stub servers (`connector-https.ts:49`), so the rule is the client's, and the census stub at `127.0.0.1` passes it.
- **Refresh POST under connector `jenkins`, bucket `token`:** consistent with the ledger, see the bound note in section 4.
- **Census cap at 1.45 times the measured HEAD time above 1,000 s:** consistent with the comment at `ci.yml:887-888`. The estimate under it is low, see section 2.

## Required edits

1. Make the new Jenkins rules pass *The domain names no vendor* (`ci.yml:1667`) with their imports. Either name the `rules/` files with no standalone `jenkins` token (for example `ci-build-map.ts`, `ci-sha-runs.ts`), or import them only from `adapters/build/` and `adapters/host/`. Correct the sentence in *Approach* to cover import paths as well as literals.
2. Correct *The census cost*: a fourth entry in `FIXTURES` adds one traced run and one untraced shell-baseline run (`fleetd.census.test.ts:154`, `:228`). Restate the estimate for both runs, or run the Jenkins fixture's baseline outside the `FIXTURES` loop and say so.

Non-blocking notes: pass the Jenkins client through `buildShell` (`build-resolve.ts:57`), because fleetd calls that at `registryd-main.ts:3371`. Lift `budget_account` with the argument `jenkins`, not `''`. State the `token` entry's basis. Write `jen_save_token`'s rule as *`expires_in`, else 300, minus 30*. Name `bitbucket-pr-listing.corpus.test.ts` and `record-bitbucket-pr-listing.mjs` as the base for the Bitbucket overlay corpus row.
