# Panel: jenkins-reads-in-process, round 1

- **Date:** 2026-11-16
- **Subject:** `docs/plans/2026-11-16-jenkins-reads-in-process.md` at `cfd3a3ae0`
- **Commitment:** `Position: proceed|amend|reject`
- **Reconcile:** `unanimous amend` — estate, security, census

## What each juror looked at

- **estate** read the plan against the checkout: `plot-host.sh` line references and package references with `sed -n`, the callers of `hostReadsFor`, `connector-https.ts`, and the installed `jen` 0.4.0 source. It ran no tests.
- **security** read the installed `jen` 0.4.0 for its storage, refresh, keying and HTTP check code, `connector-https.ts`, `env-file.ts`, `host-reads.ts`, and the installed fleetd launchd plist (key names only). It read no secret and ran no tests.
- **census** read the census harness (`census-report.ts`, the Bitbucket and Jenkins census test, `ci.yml`) and checked the plan's line references against `fa158c452`. It ran no census.

All three positions rest on reading code. No juror ran a test or a census.

## Where the jurors agree

Every juror found the slice order sound and found no deliverable that exists already. Every juror found the line references nearly all true. Each juror holds that the plan is approvable only after named edits.

## Findings that two jurors reached separately

- **The write-back of decision 2A races `jen`.** estate (edit 7) and security (edit 2) both found that the plan names no guard against a concurrent `jen` refresh. security adds that `jen` writes its file with `printf >` and no lock (`jen:141`), so the client must re-read the store before each refresh and on `invalid_grant`, write by temp file and `rename`, and lock between Plot processes.
- **The client's base URL is not settled.** census asks the plan to name how the client reaches the stub server, and suggests a `JEN_URL_PATTERN` value. estate found that `jen` assigns `JEN_URL_PATTERN` without reading the environment (`jen:6`), so only `JEN_URL` overrides it, and that copying `jen`'s Quatico host defaults into the domain breaks the project-agnostic rule. The two findings meet: the instance and realm URLs come from Plot config or the environment, and the census sets them to the stub server.
- **The cutover must invert `bitbucket-jenkins.census.test.ts:51-56`.** estate and census both found the assertion `bbOpenReads > 0`, which turns false at cutover.
- **Decision 4A has no work in the slices.** estate found no GitHub overlay work and no Done-when row; census found that no census fixture is GitHub with `CI: jenkins`, so a corpus row is the only proof.

## Findings one juror holds alone

- **estate:** emptying `SHELL_RICH_CI` and `SHELL_CI` changes four other callers of `hostReadsFor` (`registryd-main.ts:3138`, `pr-reader.ts:134,137`, `state-branch.ts:69`, `merge-ports.ts:39`), among them the board's PR reader that writes the PR index with no fleetd. `connector-https.ts:174,190` sends only JSON bodies, and the Keycloak refresh needs a form body. The client copies `jen` rules as well as shell rules, and a stub `jen` cannot test them; record the real `jen` once against the stub server.
- **security:** fleetd's launchd unit carries only `PATH` and `PLOT_REPO_ROOT`, so under decision 1A fleetd on the operator's machine never finds `JEN_SECRET_BACKEND=file` and always keeps the shell. The shell reads no Jenkins credential from `.env`, so `.env` is a new source with no shell twin. Redirect, `403` and token-leak rules are not pinned. The rotation measurement needs a person, because an unattended worker cannot log in.
- **census:** the census report key has no CI field (`census-report.ts:20`, `:145`), so a Jenkins fixture of the existing Bitbucket size overwrites its rows (`:187`). P12's `≤` check passes a client that makes no request. The `security` stub row cannot fail on a Linux runner. The census job is not in `validate`'s `needs:`, so P12 does not block a merge.

## A finding against a person's decision

security's finding on decision 1A does not say 1A is wrong. It says 1A as written delivers no saving on the one machine the story measures, because fleetd's environment never names the file backend. The fix is a design choice that the decision did not cover: the unit carries `JEN_SECRET_BACKEND` and `JEN_CONFIG_DIR`, or the client probes `jen`'s default file location. A person chooses.

## What the lenses had in common

All three lenses read the plan as a fleetd change on this machine. The plan itself states that this machine runs no fleetd over a repository with `CI: jenkins`, so its saving lies on another machine or another repository. No juror asked which repository that is, or checked the plan's 1 `plot-host.sh` and 3 to 13 `jen` trees per minute against it.
