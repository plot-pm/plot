## Implementation brief — a-sprint-cannot-be-read-as (wave 1: Read path)

- **Plan (canonical):** `docs/plans/2026-10-21-a-sprint-cannot-be-read-as.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2217 merged
- **Branch:** `feature/jira-version-read` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `feature/sprint-reads-jira-release`, waits on this branch: it calls the read this branch adds. This branch changes no skill and no sprint script.

### What to build

A `Tracker` port read, `versionRead`, that returns one Jira version (name, released flag, release date) and the issues whose fixVersion names it. Today `packages/domain/src/adapters/tracker/tracker-jira.ts` has no version or fixVersion endpoint (measured 2026-10-21 on `01a6cf2ad`), so `/plot-sprint` and `/plot-release` cannot compare a sprint's Must-haves with the Release `kus-portal-102`. The plan is canonical; this brief orients.

- **Port:** add `versionRead` to `Tracker` in `packages/domain/src/ports/tracker.ts` as a method returning `Promise<PortResult<…>>`, next to `issueListClosed`. Its TSDoc is factual (what, parameters, return, failure) — no decision history (CLAUDE.md, *The Domain Package*).
- **Adapters:** `trackerNone`, `trackerGitHost`/`trackerGithub` and the fixture adapter answer `unaskable` with a reason, as `tracker-none.ts:30-36` does for every other operation. A silent empty answer there would report a Release that nobody read.
- **Jira:** `tracker-jira.ts` implements it over the Jira version endpoint and a JQL `fixVersion = "<name>"` search. It goes through `plot-host.sh` like every other Jira call in this file (`runProcess('bash', [host, …], run)`) — a new `plot-host.sh` op, `version-read <name>`, documented in the usage header beside `issue-list`. It adds no second Jira caller (`scripts/check-host-cli-callers.sh`). Paging and the `complete` flag follow `IssueRead`: a read that stopped at its limit reports `complete: false`.
- **Connector accounting:** the read spends requests on the Jira connector's own account and window, so it reports `pages` the way `IssueRead` does and appears in `spender()`.

### Settled decisions — do not re-derive them

- **No sprint-to-version name matching.** The sprint file's `Release:` field (read at `plot-sprint-release.sh:14` and `:203`) is the fixVersion name. The read takes a name and matches nothing. Decided 2026-10-21 by Jan Wloka.
- **`sprintOwner()` is not touched here.** Its rule stays (`issue-source.ts:131-136`, pinned by `issue-source.test.ts:114` and `:123`); wave 2 gives it its first caller. Do not add a `Sprint owner` value.
- **Three outcomes stay apart, as in `issue-list`:** a version Jira does not know is a clean not-found answer; an unreachable Jira is `failed`; a tracker that cannot be asked is `unaskable`. Never read an empty issue list as "the Release holds nothing" — absent is not false, and an empty result read as no PRs refused four fully-merged plans on 2026-08-27. A 404 on the version and an empty search are different answers.
- **The read is not written to the issue index.** `issues.json` has one writer (`refreshIssueIndex`) and no lifecycle decision reads it. Whether a later slice indexes this read is an open question in the plan; do not settle it here.
- **Open questions that are not this branch's:** how a sprint item names its Jira issue, and which statuses count as done. Carry the raw status string in the returned issues; interpret nothing.

### Done when

The plan has no `## Done when` list; the slice line is the specification: *Tracker port read for a version and its fixVersion issues, with the Jira implementation and fixture tests*. Concretely:

- `versionRead` exists on the port, and every adapter implements it (the compiler enforces it).
- Fixture tests for the Jira adapter cover: version found with issues; version found with zero issues (an answered empty list, `complete: true`); version unknown; Jira failing; paging past the limit reporting `complete: false`. The empty-versus-unknown pair catches an implementation that collapses them.
- `trackerNone` and the git-host tracker answer `unaskable` — a test per adapter.
- Domain tests assert on the returned value, not on the shell arguments alone.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: the new `plot-host.sh` op is paid for in the same change — keep it a thin launcher over a bundle or remove shell elsewhere. The gate stores no number and has no override. Add a changeset for `plot` (description first, `bumps:` block last).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/ports/tracker.ts`, `packages/domain/src/adapters/tracker/*`, their tests under `packages/domain/test/`, the new op in `skills/plot/scripts/plot-host.sh` and its row in `skills/plot/scripts/README.md`. It does not touch `skills/plot-sprint/`, `skills/plot-release/`, `plot-sprint-release.sh` or `rules/issue-source.ts` — wave 2 owns them. In flight beside it in the same sprint: `bug/jira-issue-list-limit-above-one` fixes `issue-list` paging in the same adapter family; read `main` for it before touching the shared paging code, and rebase rather than copy.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
