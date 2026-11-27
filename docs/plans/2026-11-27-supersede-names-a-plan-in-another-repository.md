# Supersede names a plan in another repository

> `plot-supersede.mjs --by owner/repo:slug` and `POST /api/supersede` record a successor plan that lives in another repository, mark it as unverified, and refuse a reference that does not parse.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** fleet-runs-safely-alone
- **Issue:** #3710
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `feature/supersede-takes-a-foreign-successor`
- **Started:** 2026-11-27, Jan Wloka, `feature/the-supersede-dialog-takes-a-foreign-successor`

## Changelog

- A plan can be superseded by a plan in another repository: `plot-supersede.mjs --by owner/repo:slug <slug>` and the board's Supersede dialog record `Superseded: <date>, by \`owner/repo:slug\` (unverified)`. A reference that does not parse refuses as `successor-unparsed`.

<!-- Board impact: the Supersede dialog accepts an `owner/repo:slug` successor, and the plan card shows the foreign successor. No change to the plan format, the template or the docs/plans layout. -->

## Motivation

`quatico-solutions/agent-skills-internal` holds the Approved plan `plot-init-checks-bb`, whose one slice targets plot-pm/plot. plot-pm/plot holds `plot-init-checks-for-the-bb-cli` (#2533), the same change. On 2026-11-24, `plot-supersede.mjs --by plot-init-checks-for-the-bb-cli plot-init-checks-bb` in the agent-skills-internal checkout refused `successor-not-found` and wrote nothing. The workaround was a hand edit in agent-skills-internal (`fd401290a`): a `deferred:` marker on the duplicate's slice and a removal from its sprint. The plan stays Approved, and a board shows it as open work that nothing will build.

`successorPreconditions` (`packages/domain/src/rules/supersede-successor.ts:32`) refuses `successor-not-found` where `successorFile` is `''`. The controller looks for the successor in this checkout and on the default branch only (`packages/board/src/server/entry/supersession.ts:333`). `POST /api/supersede` accepts only a slug in `by` (`packages/board/src/server/supersede.ts:92`). The `Host` port (`packages/domain/src/ports/host.ts`) has no operation that reads a file in another repository.

## Design

### Approach

- **One rule parses the successor.** A new domain rule, `successorReference(by)`, answers `{ repo: '', slug }` for a bare slug and `{ repo: 'owner/repo', slug }` for `owner/repo:slug`. The grammar follows the `owner/repo` part of `→ owner/repo#N` (`rules/cross-repo-reference.ts`). Anything else answers `unparsed`.
- **A foreign successor skips the file check.** `successorPreconditions` takes the parsed reference. For a foreign one it adds `successor-unparsed` where parsing failed and `same-plan` never applies; `successor-not-found` applies only to a successor in this repository. A reference that names this repository's own `owner/repo` is read as a bare slug.
- **The record says what was checked.** `supersede` writes `Superseded: <date>, by \`owner/repo:slug\` (unverified)` for a foreign successor and the record it writes today for a local one. The command's summary names the successor as unverified.
- **The board takes the same form.** `POST /api/supersede` accepts `owner/repo:slug` in `by` and answers 422 `successor-unparsed` for anything else. The Supersede dialog accepts the form as free text beside its list of local slugs. The plan card names a foreign successor as text, with no link to a file this checkout does not hold.

### Open Questions

- [ ] `[question-verify-foreign]` Does the command verify that the foreign plan exists? Recommendation: no, record it unverified. Verification needs a new `Host` file read, and through a connector it costs a host call per supersession and fails on a repository the account cannot read. The record names its own uncertainty, which a person can check.
- [ ] `[question-host-reference]` A successor on another host (a Bitbucket repository superseding a GitHub one) has no host in the reference. Recommendation: out of scope; the reference names a repository on the same host, as `→ owner/repo#N` does.

## Slices

### Command

- `feature/supersede-takes-a-foreign-successor` — `successorReference`, the foreign arm of `successorPreconditions` with `successor-unparsed`, the `(unverified)` record, and `plot-supersede.mjs --by owner/repo:slug` <!-- builds: successorReference, the successor reference parser --> <!-- tests: `--by quatico-solutions/agent-skills-internal:plot-init-checks-bb` writes the unverified record with no plan file present; `--by owner/:x` refuses successor-unparsed; `--by plot-pm/plot:<local slug>` in plot-pm/plot reads the local file and refuses successor-not-found where none exists --> → #3744

### Board

- `feature/the-supersede-dialog-takes-a-foreign-successor` — `POST /api/supersede` accepts the form, the dialog takes it as free text, and the plan card names the foreign successor <!-- waits: feature/supersede-takes-a-foreign-successor --> <!-- builds: the foreign-successor arm of the Supersede route and dialog --> <!-- tests: the route answers 200 for owner/repo:slug and 422 successor-unparsed for a malformed reference; the card's successor text is a domain property read in a unit test --> → #3759

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.
