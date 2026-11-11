# Operator lens: github-reads-in-process

Position: amend

Lens: what a person sees and does when the in-process GitHub read fails (expired token, rate limit, partial answer), and whether each failure is named, visible on the board or in a log, and recoverable without reading code.

## Open Questions

1. **GraphQL or REST for the deltas.** Keep GraphQL in this plan, as the plan recommends. The corpus needs one recorded request for both transports, and the in-process client moves no request to a new bucket, so the secondary-limit exposure of 2026-11-08/09 does not grow. Condition: the client must put GitHub's response `message` verbatim into `HostRefusal.said`, because the board classifies a refusal by its wording (`refusalKind`, `packages/domain/src/rules/refusal.ts:59`, patterns at `:36-45`). A `said` such as `HTTP 403` classifies as `outage`, and the banner then gives no secondary-limit advice. Also record `Retry-After` where GitHub sends it.
2. **Which identity reads.** Agree: no `Reader app` in this plan. Add one visible line per fleetd start that names the transport and the token source (`GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`), never the token. fleetd runs under launchd with a minimal environment (`skills/plot/units/com.plot-pm.fleetd.plist`, `EnvironmentVariables`), so the operator cannot otherwise tell which identity reads.
3. **Rollback switch.** Keep it until `triggers-replace-the-tick` is delivered. The plan must say how a person sets it: fleetd runs from a launchd plist or a systemd unit, so `PLOT_HOST_TRANSPORT=shell` needs an `EnvironmentVariables` entry and a reload through `plot-fleetctl.sh`. `/plot-fleet --status` must print the active transport, or the person cannot confirm the rollback took effect.
4. **Merged listing `--limit 500`.** Agree: no change in this plan. It changes request counts, not processes or failure modes. The partial-page rule below covers a full read that stops on page 3 of 5.

## Leftovers

- GraphQL vs REST: handled as an open question. Needs the verbatim `said` condition above.
- Identity with no person signed in to `gh`: handled (`GH_TOKEN`). Needs the start line and the auth failure text below.
- Rollback switch lifetime: handled. Needs the setting procedure and the `--status` field.
- `--limit 500`: handled; no change needed.

## Defects

1. **`auth` is not a refusal kind.** The plan answers a second `401` as `failed` with the refusal kind `auth` (Approach, Credentials; Done when, row "A refused token is refreshed once"). `HostRefusal.kind` is `'throttled' | 'secondary' | 'failed'` (`packages/domain/src/ports/host.ts:88`), and the board's `RefusalKind` is `quota | secondary | outage` (`refusal.ts:26`). As written, an expired token reaches the board as `outage`, which `host.ts:72-74` describes as a refusal that a wait does not fix, with no fix named. Choose one: add `auth` to both unions with a board sentence, or keep `failed` and put the fix in `said`. In both cases `said` must name the token source and the fix, for example `GitHub refused the token from gh auth token (401 Bad credentials); run gh auth login`. With the source `gh auth token`, the next `401` re-reads the new token, so no restart is necessary; the plan must state that and test it`. Today `gh` prints its own `gh auth login` hint into stderr; the in-process route loses that hint unless the plan writes it.
2. **The 401 retry is futile when the token comes from the environment.** `gh auth token` returns `GH_TOKEN` when that variable is set, so the refresh re-reads the same rejected token. The plan must say that a token from `GH_TOKEN` or `GITHUB_TOKEN` gets no refresh, and that `said` names the variable and the unit file to edit.
3. **The fallback to the shell is silent.** Slice 5 picks the in-process reads "when the client resolves a token, and the shell reads otherwise". A missing token then degrades to the shell with no line anywhere, and census S4 regresses without a visible cause. Log the choice and its reason at start, and expose it in `/plot-fleet --status`.
4. **The cached token goes stale against `gh auth switch`.** The shell route reads `gh`'s current account on every call. The in-process client keeps the start token until a `401`. After `gh auth switch`, `budget_account` (`plot-host.sh:3513-3534`) names the new user while requests spend the old one's window, and the ledger charges the wrong account. Either take the account from the token (`GET /user` once, or the `X-OAuth-Scopes` response) or re-run `gh auth token` when `hosts.yml` changes. The story's decision of 2026-11-05 ("a user token changes on re-login") names this case.
5. **The partial answer needs its `said`.** `mergedBranches` reads `host.lastRefusal()` to decide `whole` (`packages/fleet/src/server/entry/registryd-main.ts:918-930`). The plan states that a failed or partial page is never `whole`, but not that the in-process client sets `lastRefusal()` with a verbatim `said` on a page that fails after earlier pages arrived. Add a Done-when row: page 2 of 5 fails, the rows of page 1 return, the state reads `possibly-truncated`, and `lastRefusal()` holds the kind and the response message.

## Done-when rows to add

- A `401` refusal reaches the board with a sentence that names the token source and the fix (client row plus one board unit row).
- A `403` secondary refusal from the stub server classifies as `secondary` through `refusalKind(said)`, not only through `Host.observe`.
- fleetd start logs the transport and the token source; `/plot-fleet --status` prints the transport.
- A mid-pagination failure returns the pages read, `possibly-truncated`, and a refusal with verbatim `said`.

## The change that matters most

Define the auth failure end to end: a refusal kind that exists in `HostRefusal` and `RefusalKind`, and a verbatim `said` that names the token source and the command that fixes it. Token expiry is the one failure this plan creates that the shell route did not have, and as written it reaches the operator as an unexplained `outage`.
