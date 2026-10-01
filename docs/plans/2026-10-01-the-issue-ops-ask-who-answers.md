# The issue ops ask who answers

> `plot-host.sh issue-list` and `issue-view` send a `Tracker` scheme other than `jira` to the git host, so a repository that declared `linear`, `plot`, or `github-issues` on Bitbucket gets its git host's issues. `plot-reconcile-scan.sh` section 23 reads that list. Both callers ask the domain rule `issueSource` (#1132) through a bundle, and a scheme no connector lists answers exit 4 with the rule's reason.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1133
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-host.sh issue-list` and `issue-view` no longer ask the git host for the issues of a repository that declared a tracker no connector lists. They exit 4 with a sentence that names the declared scheme, the same answer the board shows since #1132.
- `/plot-reconcile` section 23 (`open_issues=`) reports a tracker no connector lists as *not evaluated* with the reason, and asks no host.

<!-- Board impact: none on the payload. The board already asks issueSource before issue-list (fleet.ts:2369); issue-view from the board's Create plan action (idea.ts:195) now receives exit 4 for such a scheme instead of a git-host issue. -->

## Motivation

Measured 2026-10-01 on origin/main `0d2b4d5c`:

- **The script's dispatch has two arms.** `issue-list` (`plot-host.sh:4306`) tests `[ "$(tracker_scheme)" = "jira" ]` at `:4327`, and `issue-view` (`:4494`) tests the same at `:4505`. Every other scheme falls through to the git host's arm. `issue-status` (`:4597`) is already correct: `:4619` exits 4 where the scheme is not `jira`.
- **The fall-through, run.** With a stub `gh` on `PATH` that records its arguments, `PLOT_HOST=github PLOT_TRACKER=linear plot-host.sh issue-list --limit 5` exited 0 and the stub recorded `gh issue list --state open --limit 5 --json number,title,url,createdAt`. `PLOT_TRACKER=plot` gave the same. `issue-view 7` called `gh issue view 7` for both schemes.
- **The rule exists and the board uses it.** #1132 added `issueSource` (`packages/domain/src/rules/issue-source.ts:46`): an empty `Tracker` asks the git host, a scheme in the listers table asks that tracker (with `onlyOnHost` binding `github-issues` to GitHub), and any other scheme answers `nobody` with a reason. `refreshIssues` asks it before the host call (`packages/board/src/server/fleet.ts:2369-2380`). The table is `TRACKER_LISTERS` (`packages/domain/src/adapters/tracker/tracker-resolve.ts:15-18`). The rule has eight unit tests in `packages/domain/test/issue-source.test.ts`.
- **The scan reads the fall-through.** Section 23 (`plot-reconcile-scan.sh:2863`) reads the scheme at `:2938`, refuses only `jira` at `:2950` (numbers cannot match Jira keys), and otherwise calls `plot-host.sh issue-list` at `:2961`. For `linear`, it compares a finished plan's `Issue: #N` with the git host's open issues, which is a list from the wrong service.
- **No shell caller asks a bundle in `plot-host.sh` today.** It holds no `.mjs` call. Its scheme decision is a second copy of the rule, and the copy has drifted: it knows `jira` only.

## Design

### Approach

**The rule does not change.** `issueSource` already decides all three answers and has its tests. This plan gives it a shell entry and two shell callers. No new `plot-*.sh` script.

**The listers table moves to a file with no runtime imports.** `TRACKER_LISTERS` lives in `tracker-resolve.ts`, which imports `runProcess` and the three tracker connectors. Slice 1 moves the constant to `adapters/tracker/tracker-listers.ts`, which imports only the `IssueLister` type, and `tracker-resolve.ts` re-exports it, so `fleet.ts:75` and every other importer stay unchanged. The entry then imports the rule through `@plot-pm/domain/rules/issue-source` and the table through the new file, the narrow-path pattern `entry/desk-root.ts:1-3` uses.

**The entry: `board/plot-issue-source.mjs`.** `plot-issue-source.mjs <git-host>` reads the `Tracker` value on stdin, because the value can carry a URL after the scheme. It answers one line on stdout and exits 0:

- `tracker\t<scheme>` — ask that tracker's arm,
- `git-host` — ask the git host's arm,
- `nobody\t<reason>` — the rule's sentence.

Exit 2 means the git host argument is missing. The entry reaches no filesystem and runs no git; `build.mjs` builds and ships it beside `plot-desk-root.mjs` (`build.mjs:931-936`), and the build prints its size.

**Slice 1: `plot-host.sh` asks the entry.** One helper, `issue_source`, runs `node "$here/board/plot-issue-source.mjs" "$(backend)"` with `tracker_raw` on stdin. `issue-list` and `issue-view` call it once before their arms:

- `nobody` → the reason on stderr with the `plot-host:` prefix, exit 4.
- `tracker` with `jira` → the existing Jira arm.
- `tracker` with `github-issues`, or `git-host` → the existing git-host arm.
- The entry cannot be asked (node missing, bundle missing, non-zero exit, an answer outside the three words) → a sentence on stderr and exit 1, which every caller reads as *the question failed*. It never falls through to the git host, because the fall-through is the defect.

`issue-status` keeps its own `jira` test at `:4619`: it writes, and only the Jira connector writes a status, which is a different question from who lists issues.

**Cost.** The board calls `issue-list` once per PR refresh, on the PR gate (`fleet.ts:3101-3114`), and the scan calls it once per run. One node hop, measured at 39 ms for a shipped bundle (`docs/shell-and-domain.md:17`), sits beside a host call that takes seconds. The script runs once per operator command or once per board PR refresh, never once per agent per pass, so the cost rule permits a call rather than a duplicate.

**Slice 2: section 23 asks the entry.** Before the host call, section 23 asks `plot-issue-source.mjs` with the scan's `Tracker` value and backend. `nobody` prints `(not evaluated — <reason>)` and the note that names how many plans went unchecked, the shape `:2968-2970` uses for exit 4, and no host call is made. `tracker` with `jira` keeps the refusal at `:2950-2955`. The other answers call `issue-list` as today. An entry that cannot be asked prints `(not evaluated — the tracker source could not be decided: <reason>)`, never `(none)`.

### What this does NOT do

- It does not add a connector for `linear`, `plot` or any other scheme.
- It does not change `issue-status`, the board's `refreshIssues`, or the rule.
- It does not change what a repository with no `Tracker` key sees: it still asks its git host.

### Open Points

- [ ] A repository that declared `Tracker: plot` on GitHub lost its open-issue list on the board with #1132; after slice 1 it loses it in `plot-host.sh` too, and `/plot-reconcile` section 23 stops checking its plans' issues. That is the rule's decision (a declared tracker is never answered by the git host), stated here so a reviewer can object before it ships.

## Slices

### The host script asks who lists issues (Branch: bug/the-host-script-asks-who-lists-issues) <!-- builds: plot-issue-source.mjs, the issueSource shell entry -->

`tracker-listers.ts` with the re-export; `entry/issue-source.ts` and its `build.mjs` target; the `issue_source` helper in `plot-host.sh` and its use in `issue-list` and `issue-view`; contract tests in `test/reconcile/host.test.mjs`; a unit test for the entry's three answers and its usage exit; a `plot` patch and an `@plot-pm/board` patch changeset.

### The scan asks who lists issues (Branch: bug/the-scan-asks-who-lists-issues) <!-- waits: bug/the-host-script-asks-who-lists-issues -->

Section 23 asks the entry before `issue-list`; contract tests in `test/reconcile/scan.test.mjs`; a `plot` patch changeset.

## Done when

- Slice 1, each failing on origin/main today:
  - `PLOT_HOST=github PLOT_TRACKER=linear plot-host.sh issue-list` exits 4, stderr names `linear`, and a recording `gh` stub records no call. Today it exits 0 and the stub records `gh issue list` (measured above).
  - The same for `PLOT_TRACKER=plot`, and for `PLOT_HOST=bitbucket PLOT_TRACKER=github-issues` with a recording `bb` stub; stderr names `github` as the host `github-issues` needs.
  - `issue-view 7` with `PLOT_TRACKER=linear` exits 4 and records no `gh` call.
  - With the bundle path made unreadable, `issue-list` exits 1, names the entry, and records no `gh` call.
- Slice 1, regression locks: an empty `PLOT_TRACKER` still calls `gh issue list`; `PLOT_TRACKER=jira …` still takes the Jira arm (`host.test.mjs:2676` passes unchanged); `PLOT_TRACKER=github-issues` on GitHub still calls `gh`.
- Slice 2, failing on origin/main today: a scan fixture with `Tracker: linear` and one delivered plan naming `Issue: #7` prints `(not evaluated — no connector lists issues from the declared tracker \`linear\` …)` in section 23, reports `open_issues=0`, and its host stub records no `issue-list` call. Today the section calls `issue-list`.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

Found while fixing #1131 (2026-10-01). #1132 built the rule and moved the board onto it; this plan moves the two shell callers the issue names.
