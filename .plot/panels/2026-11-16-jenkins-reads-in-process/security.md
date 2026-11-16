Round: 2

# Security and credentials juror

Position: amend

The amendment answers all ten round-1 edits for this lens. Three gaps remain, and each one is a plan-text edit: the refresh lock has no named location that two fleetds of two repositories share, the realm and scheme rules added without a person's decision have no Done-when row, and the rotation measurement decides nothing because the plan names no consequence for its result.

## Round-1 edits, checked against the plan at `3491292d8`

| Round-1 edit | Answered at | Status |
|---|---|---|
| 1. fleetd under launchd finds the file backend | decision 6 (plan:129), design plan:86, row plan:145 | answered |
| 2. `JEN_CONFIG_DIR` default, `JEN_URL`, `jen_key_for`, `jen_secret_file` | plan:65, plan:85, row plan:137 | answered |
| 3. Refresh against the second writer | plan:87, rows plan:142-143 | answered, with the lock-location gap below |
| 4. Atomic `0600` write-back, only to the store read | plan:88, row plan:144 | answered |
| 5. Rotation measurement is a person's step, includes reuse revocation | plan:89, row plan:151 | answered, with the consequence gap below |
| 6. Redirect and status rules | plan:90, rows plan:147-148 | answered |
| 7. Token POST charges the ledger | plan:93, row plan:150 | answered |
| 8. Credential-leak row, `said` from `error` and `error_description` only | plan:91, row plan:149 | answered |
| 9. Drop `.env` for Jenkins | decision 8 (plan:131), row plan:146 | answered |
| 10. fleetd's account reads `unknown` under launchd | decision 3 (plan:126) | answered |

## 1. Existing deliverables

None exists. `adapters/build/` holds no `jenkins-api.ts`, and `packages/domain/src/rules/` holds only `jenkins-pr-checks.ts` for Jenkins, which the plan reuses. No code under `packages/` reads `jen`'s store or posts a Keycloak refresh grant (round-1 grep, unchanged by the amendment, which touches only the plan file).

## 2. Factual claims checked

- `jen` 0.4.0 has 1,819 lines (`wc -l /opt/homebrew/bin/jen`). `JEN_REALM_URL` defaults to the company realm at `jen:28`, and `JEN_CONFIG_DIR` defaults to `${XDG_CONFIG_HOME:-${HOME}/.config}/jen` at `jen:31`. Both are true.
- The file-backend write `( umask 077; printf '%s' "$2" > file )` is at `jen:134`, as the plan now says. It takes no lock and does no rename. True.
- `jen_secret_backend` (`jen:115-118`) picks `keychain` wherever `security` exists and no `JEN_SECRET_BACKEND` is set. So the probe of decision 6 departs from `jen` on purpose: the client reads a file store that `jen` on the same machine ignores. plan:86 names this case (a file store the operator's `jen` no longer uses reads as a dead session) only where the refresh fails; see note 3.
- `jen_save_token` (`jen:150-155`) stores `now + (expires_in // 300) − 30`. True.
- The refresh posts `refresh_token=…` as a `curl -d` argument (`jen:194-197`), so it is visible in `ps` while `curl` runs. True. The in-process refresh removes that exposure for fleetd.
- `JEN_TOKEN_ENDPOINT` derives from `JEN_REALM_URL` once at `jen:34`. `jen` never reads `iss`. So the `iss` fallback is a new rule with no `jen` twin, and the corpus cannot hold it.
- `connector-https.ts:50` documents `url` as "`http:` is allowed, for a stub server", and `:175` picks `http` for any host with `http:`. So the transport does not enforce *https or loopback*; the Jenkins client is the only guard for that rule.
- The transport logs no header (`connector-https.ts:53`) and puts only `error.message` into an error (`:196`, `:217`). The refresh token travels in the body, never in the URL, so `error.message` cannot carry it.
- The installed fleetd unit and the template carry `PATH` and `PLOT_REPO_ROOT` only (round-1 check, key names only). `~/.config/jen` does not exist on this machine (`ls -d`).
- `jen_migrate_instance_keys` (`jen:228-262`) moves a legacy slug key to the canonical key and deletes the old one, through `jen_secret_set` and `jen_secret_del`. The plan's declared duplicates do not include it; see note 2.

## 3. Done-when rows

- Rows plan:141-150 are fail-before, pass-after checks against the stub server: before Slice 1 no client exists, so each row fails.
- Row plan:144 (atomic and private write-back) is a real check: a poller over 100 write-backs fails on a truncate-then-write implementation.
- Row plan:145 holds decision 6 under the unit's environment, which closes round-1's trivial-pass finding.
- Row plan:151 is a person's record. It cannot fail mechanically, and the plan says so.
- **No row holds the three amendment rules added without a person's decision**: the realm URL from `JEN_REALM_URL` else `iss`, the refusal of a credential to a non-`https:`, non-loopback URL, and the bare-slug fallback is held by plan:139 only for the slug. See required edit 2.
- **No row holds the lock between two fleetds of two repositories.** Row plan:143 says "two clients over one store" and does not say that they run in two repositories. See required edit 1.

## 4. What is missing or wrong

- **The lock location.** plan:87 puts `keycloak-token.lock` "under the Plot state directory". The bearer is realm-wide and the store is per user (`~/.config/jen`), while Plot keeps both a per-user state directory (`~/.plot/state`, which holds `budget.tsv` and `slots`) and a per-repository one (`.plot/state` under the common git dir). Two fleetds that serve two `CI: jenkins` repositories share one store. A per-repository lock does not serialise them, both post a grant from one refresh token, and where the realm rotates, the second gets `invalid_grant` or, if reuse detection is on, revokes the session for `jen` and both fleetds. The lock must live in a per-user place keyed by the store directory, for example beside the store or under `~/.plot/state`.
- **The `iss` fallback has no row and no failure rule.** Under launchd fleetd never sees `JEN_REALM_URL`, so in production the `iss` arm is the only realm source, not a fallback. The plan names no answer for an access token that does not parse as a JWT, has no `iss`, or carries an `iss` with `http:` on a non-loopback host. The last case is a known Keycloak shape: behind a TLS-terminating proxy without forwarded headers, Keycloak issues `http://…` issuers. The rule "credentials only to `https:` or loopback" then refuses, which is right, but no row proves it, and `connector-https.ts:50` does not stop it.
- **The rotation measurement decides nothing.** plan:89 records whether reuse of a rotated refresh token revokes the session. `jen` takes no lock (`jen:134`), so a refresh by `jen` and one by fleetd from the same token within one round trip remains possible after every guard in plan:87. Where reuse revokes the session, that race logs the operator out of `jen` and stops fleetd's Jenkins reads until `jen auth login`. The plan must say what each result means for the Cutover: proceed and name the cost, or hold the Cutover.

## 5. The decisions and the five amendment choices

- **Decisions 1, 6 and 8** are consistent with plan:86 and rows plan:145-146. Decision 6's probe ignores `jen`'s backend choice, and plan:86 states the consequence for a store that no longer refreshes.
- **Decision 2** is consistent with plan:87-88 and rows plan:142-144, subject to required edits 1 and 3.
- **Decision 3** is consistent with plan:92 and row plan:150.
- **Decisions 4, 5 and 7** carry no credential issue. Decision 5's switch now changes only the transport, because decision 8 removed the `.env` arm.
- **Realm URL from `JEN_REALM_URL`, else the stored token's `iss`.** Safe in trust terms. The store file is the user's own, mode `0600`, and the access token in it came from the realm the previous refresh posted to. An attacker who can write that file can already read the refresh token in it, so trusting its unsigned `iss` gives such an attacker nothing new. The claim is read without a signature check, so the rule rests only on the store's file mode, and the plan should say so in one line. It needs the row and the failure rule in required edit 2.
- **A bare-slug `Jenkins instance` with no `JEN_URL` keeps the shell.** Safe and conservative: the client never guesses a host, so it never sends a credential to a guessed one. On a default install it means the in-process path needs a host in `Jenkins instance`, which plan:79 names in the reason text.
- **Credentials only to `https:` or loopback.** Right, and necessary, because the transport admits `http:` for any host (`connector-https.ts:50`). It must apply to the instance URL, the realm URL from either source, and the token endpoint. It needs a row (required edit 2).
- **The refresh POST charges connector `jenkins`, bucket `token`.** Sound. It meters the refresh and keeps it off the instance's limit of 60. The ledger entry holds connector, bucket, account and basis, never the body.
- **The census cap at 1.45× the measured HEAD time above 1,000 s.** No credential bearing; outside this lens.

## Required edits

1. Name the lock's location in plan:87 as a per-user path keyed by the store directory (beside `keycloak-token.secret`, or under `~/.plot/state`), so that fleetds of two repositories over one `jen` store serialise. Change row plan:143 to two clients with two repository roots over one store.
2. Add client and composition rows for the realm and scheme rules: `JEN_REALM_URL` wins over `iss`; an access token with no parseable `iss` keeps the shell with a named reason; an instance URL, `JEN_REALM_URL` or `iss` with `http:` on a non-loopback host keeps the shell with a named reason, and the stub receives no request. State in plan:79 that the client reads `iss` without a signature check and that the store's `0600` mode is what makes that safe.
3. State in plan:89 what each rotation result means: where reuse of a rotated refresh token revokes the session, the plan either names the accepted cost (a `jen` and fleetd refresh race logs the operator out, and the refusal names `jen auth login`) or holds the Cutover until a person decides.

## Notes, not blocking

1. A torn read and a stale-lock takeover (two processes both find a lock older than 30 s) can still produce two grants; the `invalid_grant` re-read bounds that, so it is acceptable as written.
2. The client does not copy `jen_migrate_instance_keys`. State that it reads the canonical key only and never migrates or deletes a key, so fleetd is never a second writer of the per-instance secrets.
3. Decision 6 can read a file store that `jen` on the same machine ignores (the machine has `security`, so `jen` uses the Keychain). A store whose refresh token still works then keeps a session alive that the operator believes abandoned. One line in plan:86 can state that the log line names the directory, so the operator sees it.
4. `rename` over a `keycloak-token.secret` that is a symlink replaces the link with a regular file. An `fsync` of the temp file before the rename makes the write-back survive a crash; neither is a defect in this plan's scope.
5. A daemon that refreshes every 270 s keeps the Keycloak session alive up to the realm's SSO Session Max. That follows from decision 2 and the story's 2026-11-05 decision; the *Measures* line could record the realm's session maximum beside the rotation result.
