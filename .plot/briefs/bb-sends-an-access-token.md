## Implementation brief — the-bitbucket-client-sends-an-access-token (wave 1: bb)

- **Plan (canonical):** docs/plans/2026-11-23-the-bitbucket-client-sends-an-access-token.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `feature/bb-sends-an-access-token` (base: `main` of quatico-solutions/agent-skills)
- **Ends as:** one PR in quatico-solutions/agent-skills, to its `main`
- **Review of the code:** per that repository's convention. Plan `Review: pr` covers the plan only.

This is the first wave and the only one in `agent-skills`. The Plot slice `bug/the-bitbucket-client-sends-an-access-token` waits on it: it needs the variable name, the precedence rule and the ledger key rule fixed here, a `quatico-bb` release, and `brew upgrade quatico-bb` on every machine that runs Plot. Whatever you choose here, the Plot slice copies.

The change is in `cli/bb`, which the Plot repository does not hold. The Plot gates (`plot-local-checks.mjs`, `check-shell-lines.sh`, changesets) do not apply to this PR. Read `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md` in `agent-skills` for its own gates, and run them.

### What to build

Today `bb` can send only a user's email and API token. Five request sites run `-u "${email}:${token}"` (the plan counts lines 709, 757, 827, 877 and 1329 at `9e30179`; the line numbers move, so `grep -n -- '-u "\${email}:\${token}"' cli/bb` and count five before you start). A user API token allows 1,000 requests an hour for the whole account, and the Bitbucket website fails for that user while the limit is spent. Atlassian recommends a workspace or repository access token for automation. An unattended Plot run on a user token therefore locks its owner out of bitbucket.org.

Add an access-token credential to `bb`:

- `bb` reads the token from `BB_ACCESS_TOKEN`. Where it is set, every request sends `Authorization: Bearer <token>` and sends no `-u`.
- `bb_request_guard` and the 429 pause key the ledger by a key derived from the token, not the email. `bb_request_guard` takes an email argument today (`cli/bb:652`) and `bb_account_key` hashes it (`:356`); both need a token arm.
- `bb rate-limit --json` (`cmd_rate_limit`, `:3273`) and `bb auth status` (`cmd_auth_status`) name which credential is in use: access token or email pair. They never print the token.

Close by reading the plan: it is canonical, this brief is orientation.

### Decisions the plan leaves as recommendations — take them, and report a deviation

The plan was approved with its four open questions still unchecked. Each carries a recommendation, and the Plot slice is written against them. Implement the recommendation. If measuring shows one is wrong, stop and report it rather than choosing differently: a different choice here silently breaks the Plot slice's corpus test against `cli/bb`.

- **Variable name: `BB_ACCESS_TOKEN`.** Reusing `BB_TOKEN` with `BB_EMAIL` unset is ambiguous, because `bb_email` falls back to the keychain (`cli/bb:59`): `BB_TOKEN` alone would read as an email-less user token or as an access token depending on the keychain.
- **Precedence: the access token wins** where both it and `BB_EMAIL`/`BB_TOKEN` resolve. A person sets it on purpose for automation. `bb auth status` states that the email pair was set and ignored.
- **Ledger key:** the first 12 hex characters of the SHA-256 of a fixed prefix and the token. The prefix makes it unable to equal an email key, and the 12-character hash keeps the secret out of the ledger file name. **The prefix is a contract:** the Plot slice hashes the same bytes (`bbKeyInput` in `packages/domain/src/rules/bb-ledger.ts`) and a corpus test compares the two. Document the exact input in a comment above the key function and in `bb`'s help text. Choose it once, e.g. `access-token:` followed by the token with no case folding. The email arm lowercases ASCII letters; a token is case-sensitive, so the token arm must not.
- **Limit:** keep the 800 ceiling (`BB_HOURLY_LIMIT`, default `BB_BUDGET_DEFAULT`) until a reply carrying `X-RateLimit-Limit` for an access token is measured. Do not raise the default. `BB_HOURLY_LIMIT` already lets a person raise it; Plot's `Host rate limit` raises the ceiling only after `bb` accepts a higher `BB_HOURLY_LIMIT` for that key. Make sure it does for a token key.

### Settled — do not re-derive

- **One ledger.** fleetd and `bb` meet in one request file only when both derive the same key from the same credential. Plot's in-process client already writes `bb`'s ledger (`packages/domain/src/adapters/host/bb-ledger-file.ts`). Do not give the token a ledger of its own format or location. The file layout, the pause file and the stamps stay as they are; only the key's input changes.
- **Plot's own `budget.tsv` account stays the workspace.** This plan changes only the `bb` ledger key.
- **The shell needs no change.** `plot-host.sh` reaches Bitbucket through `bb`, so it sends the token once the installed `bb` does.
- **No new request site.** All five sites must go through one helper that picks Bearer or Basic. A sixth copy of `-u` is the shape that lets one site keep sending the email pair after the others moved.
- **Absent is not false, and read the exit code, not the emptiness.** A token variable that is set and empty means unset. A 401 with an access token names `BB_ACCESS_TOKEN` in its message and does not fall back to the email pair: a silent fallback spends the user's limit, which is the failure this change exists to remove.
- **The token never reaches a log, a ledger file name, `--json` output, an error message or `set -x` output.** Pass it to `curl` through a header that does not appear in `ps` where the repository's existing code already does so for `-u`; match what it does, do not weaken it.

### Done when

The plan's `## Slices` entry for `bb` is the specification:

1. `cli/bb` sends `Authorization: Bearer` from `BB_ACCESS_TOKEN` at all five request sites.
2. `bb_request_guard` and the pause key the ledger by the token's key.
3. `bb rate-limit --json` and `bb auth status` name the credential in use.

Assertions that exist because a naive implementation passes without them:

- **A request made with only `BB_ACCESS_TOKEN` set sends no `Basic` header and no `-u`.** Catches a Bearer path added at four sites while `cmd_auth_login` or one list helper still demands `bb_email`, which exits 1 when no email resolves. Run every command family, not one.
- **With both credentials set, the Bearer header is sent and the email key is not used.** Catches a precedence written in the request code but not in the guard: the request goes out on the token while its count lands in the owner's email ledger.
- **The ledger file name for a token equals the documented key, and contains no substring of the token.** The Plot corpus test depends on the first; the second catches a key that is the token's own prefix.
- **A 429 on a token pauses the token's key and leaves the email key unpaused, and the reverse.** Catches one key variable (`BB_ACCOUNT_KEY`, cached per email at `:660`) reused across the two arms: the cache is keyed on `BB_ACCOUNT_EMAIL`, so a token call after an email call can read the wrong key.
- **`bb auth status` with only an access token set exits 0 and names the credential.** Today it needs an email (`bb_email || exit 1`).
- **An unset or empty `BB_ACCESS_TOKEN` changes nothing** for an email-pair caller: every existing test passes unchanged.

Plus the gates `agent-skills` names for a `cli/bb` change: its tests, its docs for `bb` (`skills/` and `docs/` mention `BB_EMAIL`/`BB_TOKEN`; grep and add the new variable beside them), and its changeset or `CHANGELOG.md` entry per its own convention. The release is a `quatico-bb` release. Do not cut it: a release needs an explicit request.

### Bookkeeping

- Push the first real commit as soon as it exists.
- When the PR is created, report its number and URL in your final message. The plan's `→ <owner>/<repo>#<number>` annotation on this slice's line (`quatico-solutions/agent-skills#<n>`) is written by the session that books the plan, since a worker in `agent-skills` cannot commit to the Plot plan.
- Open the PR with that repository's own convention. `plot-open-pr.sh` reads Plot plans and refuses a branch no local plan names.

### Scope guard

- **This branch owns:** `cli/bb` and the documentation and tests of `bb` in `agent-skills`. Nothing else.
- **In flight elsewhere:** `bug/the-bitbucket-client-sends-an-access-token` in the Plot repository holds `bitbucket-api.ts`, `rules/bb-ledger.ts`, `bb-ledger-file.ts`, the ledger corpus test and the `plot-config.sh` comment. It waits on this branch and starts after the `quatico-bb` release. Do not edit Plot from here.
- The sibling plan `docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md` made fleetd and `bb` share one ledger. Read its *Motivation* before touching the key; do not change the file layout it settled.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
