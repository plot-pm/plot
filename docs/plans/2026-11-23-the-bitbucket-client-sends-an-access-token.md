# The Bitbucket client sends an access token

> fleetd's in-process Bitbucket client and `bb` send a workspace or repository access token as `Authorization: Bearer` where one is set, and both count its requests in one `bb` ledger key, so automation runs on a credential of its own and not on its owner's user account.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Issue:** #3689
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Started:** 2026-11-24, Jan Wloka, `feature/bb-sends-an-access-token`

## Changelog

- Plot and `bb` can send a Bitbucket workspace or repository access token instead of a user's email and API token. Automation that uses one spends the token's own rate limit, and a spent limit no longer locks its owner out of bitbucket.org.
- A `Host rate limit` above 800 takes effect for a Bitbucket repository whose clients send an access token.

<!-- Board impact: no plan format, template or docs/plans layout change. No helper script changes behaviour; the `Host rate limit` comment in `plot-config.sh` changes. The board reads `LimitReading` unchanged in shape. No board bundle is committed (`scripts/check-no-bundle-diff.sh`). -->

## Motivation

Issue #3689 reports that `bitbucket-api.ts` can send only a user's email and API token. On `origin/main` at `e15c9d319`, `callOf` builds `Authorization: Basic <email:token>` (`packages/domain/src/adapters/host/bitbucket-api.ts:283`) from `BITBUCKET_CREDENTIAL_VARS = ['BB_EMAIL', 'BB_TOKEN']` (`:34`). `bb` does the same: it sends `-u "${email}:${token}"` at five sites in `cli/bb` (agent-skills `main` at `9e3017986`, lines 709, 757, 827, 877 and 1329).

Both clients key `bb`'s per-account ledger by the email: `bb_account_key` hashes it (`cli/bb:356`), and `bitbucketApi` passes `credential.email` to `ledger.guard` (`bitbucket-api.ts:337`; `bb-ledger-file.ts:44` and `:77`). An access token has no email, so neither client has a ledger key for one.

Atlassian recommends a credential of its own for automation, so that automation cannot lock the owner out of the website. A user API token allows 1,000 requests an hour for the whole account, and the website fails for that user while the limit is spent (`docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md`, *Motivation*). Atlassian documents the scaled cap only for workspace, project and repository access tokens (PR #3579 body, cited there). `plot-config.sh:238-239` therefore says that a `Host rate limit` above 800 has no effect.

For the sprint goal, a second operator who runs Plot unattended against Bitbucket today spends their own user account's limit. An access token gives that run a spend cap that does not reach the operator's website session.

## Design

### Approach

- **`bb` first, in agent-skills.** `bb` reads an access token from a variable of its own. Where it is set, every request sends `Authorization: Bearer <token>` instead of `-u`, and `bb_request_guard` keys the ledger by a key derived from the token. `bb rate-limit --json` and `bb auth status` name which credential is in use.
- **Plot follows `bb`'s contract.** `bitbucketApi` reads the same variable from the environment, then the worktree's and the main checkout's `.env`, as it reads `BB_EMAIL` and `BB_TOKEN` (`readCredential`, `bitbucket-api.ts:248`). Where it resolves, `callOf` sends `Bearer`, the ledger guard and `pauseAfter429` take the token's key, and a `401` names the variable in its fix text. `bbKeyInput` in `rules/bb-ledger.ts` gains the token's key rule, held to `bb_account_key` by a corpus test as the email rule is.
- **The ledger stays one ledger.** fleetd and `bb` meet in one request file only when both derive the same key from the same credential, so the Plot slice waits on the `bb` slice and copies its key rule.
- **Plot's own `budget.tsv` account stays the workspace** (`rules/bitbucket-budget-account.ts`). This plan changes only the `bb` ledger key.
- **The shell needs no change.** `plot-host.sh` reaches Bitbucket through `bb`, so it sends the token once the installed `bb` does. `plot-config.sh:238-239` changes to say that a value above 800 takes effect with an access token.

### Open Questions

- [ ] `[question-variable-name]` Which variable holds the access token? Recommended: `BB_ACCESS_TOKEN`, a name of its own. Reusing `BB_TOKEN` with `BB_EMAIL` unset is ambiguous, because `bb_email` falls back to the keychain (`cli/bb:59`).
- [ ] `[question-precedence]` Which credential wins where both an access token and `BB_EMAIL`/`BB_TOKEN` resolve? Recommended: the access token, because a person sets it on purpose for automation.
- [ ] `[question-ledger-key]` What key does a token get? Recommended: the first 12 hex characters of the SHA-256 of a fixed prefix and the token, so it cannot equal an email key and the ledger file name does not hold the secret.
- [ ] `[question-access-token-limit]` What limit does an access token predict where no reply carries `X-RateLimit-Limit`? Recommended: keep 800 until a reply with the header is measured; `Host rate limit` can raise the ceiling only after `bb` accepts a higher `BB_HOURLY_LIMIT` for that key.

## Slices

### bb

- `feature/bb-sends-an-access-token` — quatico-solutions/agent-skills: `cli/bb` sends `Authorization: Bearer` from the access-token variable at all five request sites, keys `bb_request_guard` and the pause by the token's key, and names the credential in `bb rate-limit --json` and `bb auth status`. Impl: the change is in `cli/bb`, which this repository does not hold, and it ships in a `quatico-bb` release before any Plot machine has it <!-- builds: bb's access-token credential and its ledger key -->

### Client

- `bug/the-bitbucket-client-sends-an-access-token` <!-- waits: feature/bb-sends-an-access-token --> — `bitbucketApi` resolves the access-token variable before `BB_EMAIL`/`BB_TOKEN`, sends `Bearer`, guards and pauses under `bb`'s token key, and names the variable in a `401`; `plot-config.sh` states that `Host rate limit` above 800 takes effect with an access token <!-- builds: the Bearer path of bitbucketApi and the token arm of bbKeyInput --> <!-- tests: a token in the environment and in each .env sends Bearer and no Basic; the token wins over an email pair; a 401 names the variable; the ledger file name matches bb's key in a corpus test against cli/bb -->

## Notes

Created on 2026-11-23 from issue #3689, for the sprint plot-describes-itself.

The Plot slice waits on a change in another repository, its review, a `quatico-bb` release and `brew upgrade quatico-bb` on every machine that runs Plot. The sprint ends on 2026-12-04, so this plan is not fit for that sprint as a commitment; a user API token at 800 requests an hour still gives the unattended run a spend cap.

`plot-deliverable-search.sh` finds no `BB_ACCESS_TOKEN` and no Bitbucket `Bearer` path on `origin/main`; the only `Bearer` is Jenkins' (`adapters/build/jenkins-api.ts:129`).
