# Plot keeps its files inside the repository

> With no `Worktree root` configured, Plot writes dispatch worktrees and action records beside the checkout, in the directory that contains it. Nine places compute that location, and they disagree on the default.

## Status

- **State:** Delivered
- **Approved:** 2026-10-01, jwloka, in-session
- **Started:** 2026-10-01, jwloka, `bug/the-desk-root-is-one-rule`
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Concepts:** desk-root
- **Delivered:** 2026-10-01

## Changelog

- With no `Worktree root` configured, Plot keeps its dispatch worktrees and action records under `.worktrees/` inside the repository, and never writes beside the checkout. Existing action records move there once.

Board impact: none. The board reads the same records from the new location; no payload changes.

## Motivation

Measured 2026-10-01 on `main`. The rule *the configured `Worktree root`, else a default* is written in nine places:

| Site | Default when unset |
|---|---|
| `packages/board/src/server/agent-log.ts:171` (`agentLogDir`) | the checkout's parent |
| `plot-approve.sh:131`, `plot-deliver.sh:84` | the checkout's parent |
| `plot-fleetctl.sh:580-582`, `plot-resolve-artifact.sh:189-191` | the checkout's parent |
| `plot-dispatch.sh:239`, `:2375`, `plot-reap.sh:419`, `:459`, `plot-reconcile-scan.sh:2569` | read the key; default per site |
| `plot-board-probe.sh:189`, `plot-quiet-stretch.sh:92` | `.worktrees` |

Two defaults that disagree mean two readers look in different places for one desk. The parent default also writes `plot-<kind>-<slug>.log`, `.state` and `plot-wt-*` worktrees into a directory the repository does not own: on a developer machine that is the folder holding all their checkouts.

Found while bringing the board suite to zero leftover entries (#1126): fixture repositories created directly in `TMPDIR` received the board's records in `TMPDIR` itself.

## Design

### The concept

**Desk root**: the directory under which Plot creates dispatch worktrees and writes its action records. A new Concept file, `docs/domain/desk-root.md`, Layer: Domain. Terms: *desk* (a dispatch worktree), *action record* (`plot-<kind>-<id>.log` and `.state`).

### The rule

`deskRoot(reading)` in `packages/domain/src/rules/`, taking the configured `Worktree root` value and the repository root as readings:

| Configured | Answer |
|---|---|
| absent or empty | `<repo>/.worktrees` |
| absolute path | that path |
| relative path | resolved against the repository root |

The default moves from the parent to `.worktrees` because that is what `/plot-init` writes (`composeAdoption`, `adoption.ts:513`) and what the two probes already assume.

### Callers

- `agentLogDir` calls `deskRoot`.
- The seven scripts ask it through one bundle, `board/plot-desk-root.mjs`, per *A Shell Script Asks The Domain*: each runs once per operator command, so the bundle's start-up is the permitted cost. No script keeps its own default.
- `plot-board-probe.sh` and `plot-quiet-stretch.sh` ask it too, so the two `.worktrees` literals go.

### The ignore line

A desk root inside the repository must not appear as untracked files. When the answer lies inside the repository and the repository's `.gitignore` does not ignore it, the caller that creates a desk adds the path to `.git/info/exclude` (local, never committed). `/plot-init` already writes the `.gitignore` line for new adopters.

### Existing files

- **Action records** move once from the checkout's parent to the desk root, by the existing `migrateAgentLogs` (`agent-log.ts:330`): it moves only `plot-<kind>-*` names Plot wrote and records a marker.
- **Existing worktrees stay where they are.** Every reader that asks *which worktree holds this branch* already asks `git worktree list`, so a desk in the parent keeps working until it is reaped. New desks go to the desk root.

### What this does NOT do

- It does not move live worktrees.
- It does not change a configured `Worktree root`.

## Done when

- `deskRoot` has a unit test per row of the table, and `docs/domain/desk-root.md` exists with `Concept status: implemented`.
- `git grep -nE 'repo_root/\.\.|"\.worktrees"'` in `skills/plot/scripts/` returns no default computation; each former site asks the bundle.
- A dispatch in a fixture repository with no `Worktree root` creates its desk under `<repo>/.worktrees/` and writes nothing into the repository's parent; the parent's listing is unchanged.
- The same repository's `git status --porcelain` shows no `.worktrees` entry after the dispatch.
- A fixture with `plot-approve-x.log` in the checkout's parent has it moved into `<repo>/.worktrees/` on the first board action, and the parent holds no Plot file afterwards.
- `pnpm run test:board` leaves zero entries in its root with the fixture repositories as they are.

## Slices

### The desk root is one rule (Branch: bug/the-desk-root-is-one-rule, PR: #1136)

`deskRoot`, its Concept file, the bundle, `agentLogDir`, the nine callers, the ignore line, and the tests.

### Action records move into the repository (Branch: bug/action-records-move-into-the-repository, PR: #1142)

The once-only migration of existing action records from the checkout's parent, and its fixture test.

## Notes

Filed 2026-10-01 while fixing #1126; the operator asked that Plot's files always land inside the repository.
