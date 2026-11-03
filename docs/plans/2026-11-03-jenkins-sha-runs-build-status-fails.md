# jenkins_sha_runs: build status fails behind an auth proxy because it bypasses jen

> `jenkins_sha_runs` reads a commit's Jenkins builds with `curl -u`, so a Jenkins behind an OAuth2 proxy answers HTTP 302 and every PR reports `checksLookup: broken`; the read goes through `jen api` instead.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #3061
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `pr-state --with-checks` and `pr-list` report the Jenkins result for a PR's head sha on Jenkins instances behind an auth proxy, as they already do on instances without one.

Board impact: none. The plan format, the template and the `docs/plans` layout do not change, and the board reads the same `checks` and `checksLookup` fields.

## Motivation

Issue #3061, measured on Plot 2.30.0 with `CI: jenkins` and a multibranch instance behind oauth2-proxy (Keycloak): `plot-host.sh pr-state <open PR> --with-checks` prints `Jenkins did not answer` and `"checksLookup":"broken"`, and the board shows no build status.

`jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:2047`) sends `curl -sg -u "$cred"` to `https://$host$path/api/json?$tree`. The proxy answers that request with a 302 to the login page. Every other Jenkins call in `plot-host.sh` goes through `jen`, which sends `Authorization: Bearer <keycloak token>` for the proxy and `X-Jenkins-Authorization: Basic <user:api-token>` for Jenkins.

| Transport | Proxied instance | Instance without proxy |
|---|---|---|
| `curl -u "$cred"` (what `jenkins_sha_runs` sends) | HTTP 302 to the login page | HTTP 200 |
| `jen -I <slug> api "<path>/api/json?<tree>"` | HTTP 200, builds with `lastBuiltRevision.SHA1` | HTTP 200 |

The comment above the function says `jen` is not the transport because a `jen build list --json` entry carries no sha. That holds for `build list`. `jen api <path>` is a raw passthrough that sends one request with the instance's auth headers and prints the body, and the `tree=` query returns the sha through it. The path passed testing on an instance without a proxy, where plain basic auth works.

## Design

### Approach

In `jenkins_sha_runs`, replace the `curl` call with `jen -I "$slug" api "$path/api/json?$tree" 2>/dev/null`. The `$tree` string passes through unchanged: against the proxied instance, the exact value the function builds returned `{"number":1,"result":"FAILURE","sha":"f9a88cf…"}`.

The JSON checks after the call (`has("builds")`, the branch-answered test, the multibranch container test) stay as they are, and so does the `host_slot_take` / `budget_record_call` bracket around each request.

`jenkins_resolve_host` and `jenkins_rest_credential` then have no caller in `plot-host.sh` (grep: the only call sites are lines 2055 and 2058, inside this function). Plot reaches Jenkins only through `jen`. The slice removes both helpers, the "no Jenkins API credential" refusal and the `cred` handling, and rewrites the comment above `jenkins_sha_runs` to say `jen api` is the transport. `test/reconcile/host.test.mjs` references both helpers and needs matching changes.

Layering: `plot-host.sh` stays the one place that talks to the host CLI (`scripts/check-host-cli-callers.sh`); this change removes a second transport from it. Manifesto Principle 3 holds: the script collects and reports, the skills interpret.

### Open Questions

- [ ] Does `jen api` exit non-zero or print an error body on a 302 or a 401? The `|| true` and the `jq -e 'has("builds")'` check treat both as "no builds", so the refusal stays `Jenkins did not answer`, but the fixture should cover it.
- [ ] Which `jen` version first ships `api`? If 0.2.0 (the version named at `plot-host.sh:1776`) lacks it, the slice must name the minimum version and fail with a readable refusal on an older one.
- [ ] Does `plot-config.sh:250`'s `Default branch job` comment, which says the key is "Read by `jenkins_sha_runs` only", stay true unchanged? It should; confirm when the slice lands.

## Slices

### Jenkins sha read through jen

- `feature/jenkins-sha-runs-through-jen` — replace the `curl -u` call in `jenkins_sha_runs` with `jen -I "$slug" api`, remove `jenkins_resolve_host` and `jenkins_rest_credential`, update the comment and the host tests <!-- builds: jenkins_sha_runs reads through jen api -->

## Notes

- Related, shipped: [jenkins-sha-lookups-in-plot-host](2026-10-24-jenkins-sha-lookups-in-plot-host.md) (#2478) introduced the sha read and its `curl` transport.
- Deliverable search: `plot-deliverable-search.sh "jenkins_sha_runs"` found only the function itself and its callers; no existing `jen api` use in `plot-host.sh`.
- Ceremony answers chosen unattended: `Plan PRs: required` fixes `Review: pr`; `Impl: own branches` because the plan PR merges before the implementation branch starts.
- Source: issue https://github.com/plot-pm/plot/issues/3061. Nothing is written to the tracker.
