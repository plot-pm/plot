# Panel: jenkins-sha-runs-build-status-fails, round 1

Outcome: unanimous amend (layering, safety, testability, seams).

## Shared findings

Every juror found these, and each was verified against the source before the plan adopted it:

- **Doubled slot and budget bracket (HIGH, four of four).** The `jen()` wrapper at `plot-host.sh:3905-3915` already takes the `jenkins` slot and records the call. Keeping the bracket at `:2066-2068` records two ledger rows per request and, with a slot bound of 1, makes the inner take wait `PLOT_SLOT_WAIT_MAX_S`=30 s. Plan: no bracket around the `jen` request; one ledger row per path, with a test.
- **Unmeasured "instance without proxy" cell (four of four).** `jen` sends the Basic credential only in `X-Jenkins-Authorization` and needs a Keycloak token (`jen:12-18`, `jen_token` `:159-180`). The plan's HTTP 200 for `jen api` on such an instance came from a `curl` run. Plan: the cell reads "not measured"; the loss is stated as a decided consequence.
- **The `.env` and keychain credential sources disappear (four of four).** #1936 and #2263 added the `.env` source for Linux agents and CI. Plan: removal decided by the user and stated in the Changelog and Notes.
- **Refusal names an empty `$host` and `2>/dev/null` discards `jen`'s actionable line (four of four).** Plan: the refusal names the slug and forwards `jen`'s first `error:` line.
- **The 30 s bound disappears (four of four).** `cmd_api` has no `--max-time`. Plan: a `PLOT_JEN_BOUND_S` bound inside the `jen()` wrapper, modelled on `bb_fetch_base_bounded`, so the slot is released and the call recorded after a kill.
- **Comments beyond the one the plan named become false (four of four).** `plot-host.sh:1971`, `:1986-1989`, `:2044`, `:5110-5123`, and `build-jenkins.ts:78-89`. Plan: a table of every site.
- **Test surface is far larger than "matching changes" (four of four).** `makeJenStub` has no `api` arm; about 70 tests use `curl`, `security` or the credential helpers; `:3586` counts every `jen` call; `:5016` asserts the sha route never calls `jen`; `sourcedJenkinsShaRuns` would reach the real `jen`. Plan: a migration table and seven new tests.
- **Open questions answered from `jen` 0.4.0 source (four of four).** Every `jen api` failure gives empty or non-JSON stdout and exit 4, so `checksLookup` stays `broken`; 0.4.0 ships `api` and no earlier version is verified; `plot-config.sh:250` stays true.

## Where jurors differed

- **Remedy for the credential loss.** Layering proposed exporting the `.env` pair to `jen`'s environment, as `jira_load_env_file` does. Testability proposed `jen api` first with a `curl -u` fallback. Seams and safety asked only that the plan state the regression. The user decided: no fallback and no export; the sha read goes through `jen` only.
- **Severity of the credential loss.** Layering rated it HIGH, safety and seams MEDIUM, testability made a measurement its first required amendment.
- **Slot stall today.** Layering read the stall as latent (Jenkins records basis `unknown`, so `host_concurrency_bound` takes no slot); safety and seams described it as active at bound 1. All agree the doubled ledger row is real now.
- **`pr-status.ts:66`.** Seams placed its dead Jenkins alternative in a follow-up; safety asked the plan to remove it or say why it stays. The plan removes it in the slice, because nothing prints the notice after the change.
- **The GitHub `pr-list` stale colour (`:4755-4763`).** Only safety raised it, and marked it out of scope. The plan records it as a follow-up.
- **Old `jen`.** Safety and seams required a named refusal; testability required only a pinned decision. The plan refuses by name with "jen 0.4.0 or later with `api`".

## What each juror ran versus read

| Juror | Ran | Read only |
|---|---|---|
| layering | `jen --version`, `jen --help`, `jen api --help`; greps for callers and fixtures; `cmp` of the worktree `plot-host.sh` against `main` | `plot-host.sh`, `plot-budget.sh`, `build-jenkins.ts`, `pr-status.test.ts`, `host.test.mjs` ranges; the slot stall is derived |
| safety | `jen --version`, `--help`, `api --help`; greps; `git log` on the marketplace clone | the `jen` source, from which its failure table is derived; the slot leak is derived, not reproduced |
| testability | `jen` help commands; a sourced harness with `curl` and `jen` PATH stubs that ran current and patched `jenkins_sha_runs` in four modes, including a budget count that observed two `jenkins` rows per request | `plot-host.sh`, `host.test.mjs` ranges, the `jen` source |
| seams | `jen` help commands; a search of every cached `working-with-jenkins-api/bin/jen` for its version and `api` arm; greps across `skills/`, `packages/`, `docs/`, `test/`, `CHANGELOG.md` | `plot-host.sh`, `plot-budget.sh`, the `jen` source, `host.test.mjs` ranges |

Only testability executed the function under change, and only testability observed the doubled ledger row rather than deriving it. No juror called a Jenkins instance or ran `host.test.mjs`.

## Shared blind spot

No juror measured `jen api` against a live instance, proxied or not. The proxied HTTP 200 rests on the issue author's run, and every failure-mode row rests on reading `jen` 0.4.0's source. No juror found the first `jen` version that ships `api`, because the marketplace clone is shallow. The plan's behaviour for an instance with no auth edge is therefore a prediction from source, and the plan says so.
