# Refs and worktrees read from files

> The `Refs` and `Trees` adapters answer ref and worktree reads from the files git keeps — loose refs, `packed-refs`, symbolic refs and `worktrees/*/HEAD` — instead of starting `git`. The file reader is a declared duplicate of git's ref rules with a corpus test against git, and it falls back to git on a reftable repository or on any name it does not cover.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged

## Changelog

- fleetd and the board read branch tips, the default branch and the worktree list from the files under `.git` instead of starting a `git` process for each question. A repository that stores its refs as reftable keeps today's behaviour.

Board impact: none visible. The board's own reader (no fleetd) starts fewer processes, because it builds its refs through the same adapter. The plan format, the template, the helper scripts and the `docs/plans` layout do not change; `board-server.mjs` rebuilds on `main`.

## Motivation

Census S4 on the sprint PR #3277 (CI run 42595561157, `census-report-head` artifact) counts per idle fleetd pass, 5 open PRs: GitHub 0 desks 1124.5, GitHub 3 desks 2585.5, Bitbucket 3 desks 2676. The report keys every `execve` by image and first argument. The ref and worktree reads per pass on GitHub with 0 desks are:

| Command key | Per pass (GitHub 0 / 3 desks, Bitbucket 3) | Source in this worktree |
|---|---|---|
| `bash` + `git symbolic-ref` + `sed \|\|` | 18 + 18 + 18 / 21 × 3 / 18 × 3 | `refsGit.defaultBranch`, one `bash -c 'git symbolic-ref … \| sed … \|\| git rev-parse --abbrev-ref HEAD'` per call (`packages/domain/src/adapters/refs/refs-git.ts:450-455`), asked from 23 call sites in `packages/fleet/src` (for example `fleet-scan.ts:719`, `registryd-main.ts:641`, `:727`, `:1041`, `index-monitor.ts:61`, `queue-reading.ts:486`) |
| `git for-each-ref` | 17 / 17 / 8.5 | `refState` and `refStateSync` (`refs-git.ts:761-775`, read once per beat by `readRefSnapshot`, `packages/domain/src/workflows/plan-walk-cache.ts:221`), `listBranches` (`:460-468`), `branchTips` (`:718-731`), `branchDates` (`:816`), the `refs/replace` probe in `containsMany` (`:930`) |
| `git worktree` | 14 / 14 / 6 | `treesGit.list`, `git worktree list --porcelain` (`packages/domain/src/adapters/trees/trees-git.ts:249`, sync twin `:593`); `registry.ts:1184` (`packages/fleet/src/shared/`) |
| `git rev-parse` | 28 / 28 / 19 | `resolve` (`refs-git.ts:486-487`), `currentBranch` (`:586`), `remoteHead` (`:989-1004`), `--short` in the walk header (`:398`), `--is-shallow-repository` (`:927`), `--git-dir` (`:754`, `:1002`) |

The ref subset is therefore at most about 113 of 1124.5 `execve` per pass on GitHub with 0 desks (10 %). The `defaultBranch` triple alone is 54. The report keys by the first argument only, so it cannot say how many `rev-parse` calls take a ref name and how many take a revision expression, and how many `git worktree` calls are `list` rather than `prune`. Slice 1 measures that split.

The board repeats the same reads on its own path while no fleetd runs: `git worktree list --porcelain` and `for-each-ref refs/remotes/origin` on its timeout path (`packages/board/src/server/fleet.ts:1038-1042`) and `symbolic-ref refs/remotes/origin/HEAD` in `idea.ts:458`.

Git keeps every one of these answers in a plain file under the common git directory, which `fixed-answers-once` already reads once per process (`processAnswers`, `packages/domain/src/adapters/git-dirs/git-dirs.ts:259`). A file read is not an `execve` (story, *Target Shape*: "Answers with no process").

## Design

This plan depends on `the-snapshot-entity` (delivered): the snapshot's `refs` and `desks` readings are what the file reader fills. `triggers-replace-the-tick` (Phase 8) depends on this plan, because a ref watch event re-reads the refs, and that re-read must start no process. `desk-probes-in-domain` (this sprint) owns the per-desk `git -C <desk>` probes and the `plot-worker-state.sh` path; this plan reads no desk status and moves no worker probe. `one-cat-file-batch` also edits `packages/domain/src/adapters/refs/refs-git.ts`: this plan changes the ref and default-branch methods, that plan changes the object-read methods, and the second to merge rebases. The other plans of this sprint (`github-reads-in-process`, `node-worker-wrapper`, `liveness-token`, `sprint-prs-run-ci`) share no file with this one.

This plan moves census row **S4** down on every fixture and leaves it `it.fails`: its zero belongs to `triggers-replace-the-tick`. S5 and S6 run the same scan and move with it.

### Approach

**Placement under *The Layering Rule*.** Git's ref rules are a pure domain rule over file contents; the adapter only reads the files.

- `packages/domain/src/rules/ref-files.ts` exports arrow functions over text: `packedRefsOf(text)` parses `packed-refs` (the `# pack-refs with:` header, `<oid> <ref>` lines, and `^<oid>` peel lines that belong to the tag line above them); `refsFrom({ loose, packed })` merges them with loose over packed; `symbolicTarget(text)` reads `ref: <name>` and answers `undefined` for an oid; `resolveName(name, refs)` follows git's short-name order (`<name>`, `refs/<name>`, `refs/tags/<name>`, `refs/heads/<name>`, `refs/remotes/<name>`, `refs/remotes/<name>/HEAD`, `gitrevisions(7)`) and answers `undefined` for anything that is not a plain name: `^`, `~`, `:`, `@{`, `..` and an abbreviated oid; `worktreesFrom(entries)` builds the `Trees` port's `Worktree` list from each `worktrees/<id>/` directory's `gitdir`, `HEAD` and `locked` files. The list holds the main checkout first and the linked worktrees in no stated order; the TSDoc of `Trees.list` in `ports/trees.ts` documents "main first, the rest unordered", and the callers key worktrees by path.
- `packages/domain/src/adapters/refs/ref-files-fs.ts` reads the files under the common git directory and hands them to the rule. It is the only new code that touches the file system.
- `refsGit` and `treesGit` call the file reader first for the methods it covers, and call git for every answer the reader returns as `unaskable`. No port signature changes, so the 83 `refsGit(` construction sites in `packages/board/src` and `packages/fleet/src` change nothing.

**The rules the reader duplicates, and how it refuses.** This is a declared duplicate of git (`CLAUDE.md`, *A Shell Script Asks The Domain*: "Duplication is allowed and undeclared duplication is not"):

| Git rule | Reader answer |
|---|---|
| A loose ref shadows the same name in `packed-refs` | `refsFrom` takes the loose oid |
| An annotated tag's `^<oid>` line names the peeled commit | kept as the peeled value for `resolve`; `refState` leaves `refs/tags` out, as `NAMESPACES` (`refs/heads`, `refs/remotes`, `refs-git.ts:100-104`) already does, so no caller reads a tag through it |
| `HEAD` and `refs/remotes/origin/HEAD` are symbolic | `symbolicTarget` follows one level; a chain or a dangling target answers `unaskable` |
| `HEAD`, `refs/bisect/`, `refs/worktree/` and `refs/rewritten/` are per worktree | read from the worktree's own git directory, never from the common one |
| `extensions.refStorage = reftable` keeps no loose refs | the adapter reads `<common>/config`; any `refStorage` other than `files` answers `unaskable` for every method, and git answers |
| `git pack-refs` writes `packed-refs` and then deletes the loose files | the adapter reads the `packed-refs` stat before and after the loose scan; a change retries once, and a second change answers `unaskable` |

The last row is a measured risk, not a theoretical one: the census counts 5 `git maintenance` starts per pass after each fetch, and maintenance runs `pack-refs`.

**What the reader answers.** `refState` and `refStateSync` (the snapshot's `refs` reading), `defaultBranch`, `listBranches`, `branchTips`, `resolve` for a plain name, `currentBranch`, `remoteHead`, and `Trees.list`. `branchDates` needs the commit date, which lives in an object; it stays on git, and `one-cat-file-batch` takes it. A destructive action keeps its git re-read (story, *Re-ask before acting*): `Refs.delete*`, the claim release and `trees-git.ts:539` call git as today, and a file read is not an accepted re-read there.

**Worker records.** The story's bullet names worker records too. `agents-fs.ts` already reads `.plot-worker.pid` and `.plot-worker.exit` from files (`packages/domain/src/adapters/agents/agents-fs.ts:28-45`). The remaining process-based worker reads are the `bash -c . plot-worker-state.sh` probes (`packages/domain/src/adapters/processes/processes-shell.ts:157-180`), which `desk-probes-in-domain` owns. This plan adds no worker record reader: worker records count as delivered by `agents-fs.ts` and `desk-probes-in-domain`.

**Slice 1: the reader and its corpus test.** The rule, the adapter, unit rows for each row of the table above, and `packages/domain/corpus/ref-files.corpus.test.ts`. The corpus test compares the reader with git on two estates: this repository, and a sandbox repository built with a loose ref and a packed ref of the same name, an annotated tag, `refs/remotes/origin/HEAD`, a detached worktree, a locked worktree and a worktree whose directory is gone (prunable). It asserts `refState('both')` against `for-each-ref --format='%(refname) %(objectname) %(HEAD)'`, `defaultBranch` against the `symbolic-ref` pipeline, `resolve` for every listed ref name against `rev-parse`, and `Trees.list` against `worktree list --porcelain`. A disagreement names the subject and both answers. A sandbox with `git init --ref-format=reftable` asserts that every method answers `unaskable`. The slice also records the census split the report cannot give: it runs S4 locally under the census driver with full argv and states, in the PR, how many `rev-parse` and `git worktree` calls per pass take a plain name. That split fixes where in the range of 54 to about 113 `execve` per pass the saving lies, and slice 2 claims no figure before slice 1 states it.

**Slice 2: the adapters ask the files first.** `refsGit` and `treesGit` call the reader first for the methods above. fleetd's `readRefSnapshot` and the `desks` reading in `fleetScan` (`packages/fleet/src/shared/fleet-scan.ts:699-701`, `:730-733`) then fill the snapshot with no process. The board's timeout path (`fleet.ts:1038-1042`), `idea.ts:458` and `registry.ts:1184` move to the port where they still call git directly. The census S4 report on the sprint PR shows the effect.

### Open Questions

- [x] Git's worktree order: `git worktree list` prints the main checkout first and the linked worktrees in the order it reads `worktrees/`. The callers key worktrees by path. Slice 1 states the order git uses, and a person decides whether the reader matches it or the port documents "main first, the rest unordered". **Decided 2026-11-09, jwloka: the port documents "main first, the rest unordered".**
- [x] `refState` reports an annotated tag's own oid, as `for-each-ref` does. No caller reads tags through `refState` today (`NAMESPACES` lists `refs/heads` and `refs/remotes`, `refs-git.ts:100-104`). A person confirms that the reader may leave `refs/tags` out of `refState` and read tags only for `resolve`. **Decided 2026-11-09, jwloka: the reader may leave `refs/tags` out of `refState`; tags are read only for `resolve`.**
- [x] A destructive action keeps git for its re-read. A person decides whether a file read is an acceptable re-read there too, which would remove those processes as well; this plan assumes no. **Decided 2026-11-09, jwloka: destructive re-reads keep git.**
- [x] The story counts worker records under Phase 5's first bullet. This plan treats them as delivered by `agents-fs.ts` plus `desk-probes-in-domain`. A person confirms. **Decided 2026-11-09, jwloka: confirmed. Worker records count as delivered by `agents-fs.ts` and `desk-probes-in-domain`.**
- [x] The expected effect is 54 to about 113 `execve` per pass on GitHub with 0 desks. Slice 1 measures the split before slice 2 claims a figure. **Decided 2026-11-09, jwloka: slice 1 measures the split before slice 2 claims a figure.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| Loose shadows packed | `refsFrom` row: one name in both, the loose oid wins | Reader |
| Peel lines belong to the tag above them | `packedRefsOf` row: a `^<oid>` line after a tag line peels that tag; a `^` line first in the file fails the parse | Reader |
| A name the reader does not cover goes to git | `resolveName` rows: `main^`, `HEAD~1`, `main:docs`, `@{u}`, `a..b` and a 7-hex prefix answer `undefined` | Reader |
| A reftable repository falls back | corpus: a `--ref-format=reftable` sandbox answers `unaskable` on every method, and `refsGit` returns git's answer | Reader |
| `pack-refs` during a read cannot lose a ref | adapter test: a `packed-refs` stat that changes between reads retries once, and a second change answers `unaskable` | Reader |
| Worktree order is main first | `worktreesFrom` row: the main checkout is first; the corpus compares the linked worktrees by path, not by position | Reader |
| `refState` holds no tags | `refsFrom` row: `refState('both')` holds no `refs/tags/` entry, and `resolve('v1.0')` answers the tag from `packed-refs` | Reader |
| A destructive re-read keeps git | spawn-spy row: `Refs.delete*` and the claim release start `git` with the file reader present | Files first |
| The reader agrees with git | `ref-files.corpus.test.ts` over this repository and the sandbox: `refState`, `defaultBranch`, `resolve` and `Trees.list` match git; a disagreement names the subject and both answers | Reader |
| The split is measured | the slice's PR states per-pass `rev-parse` and `git worktree` counts by full argv on the GitHub 0-desk fixture | Reader |
| No port signature changes | `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass with no signature change in `ports/refs.ts` or `ports/trees.ts`; the TSDoc of `Trees.list` states "main first, the rest unordered" | Files first |
| The snapshot fills with no ref process | `--once` test over the census fixture with a spawn spy: `readRefSnapshot` and `Trees.list` start 0 processes | Files first |
| S4 moves | census S4 on the sprint PR: `git symbolic-ref` and `sed \|\|` read 0 on every fixture, and S4 drops on GitHub with 0 desks against the merge base by the figure slice 1 measured, and by at least 54 per pass | Files first |

## Slices

### Reader

- `feature/refs-from-files-reader` — `packedRefsOf`, `refsFrom`, `symbolicTarget`, `resolveName` and `worktreesFrom` in `packages/domain/src/rules/ref-files.ts`; the file adapter in `packages/domain/src/adapters/refs/ref-files-fs.ts` with the reftable check and the `packed-refs` stat retry; `packages/domain/corpus/ref-files.corpus.test.ts` against git; the measured `rev-parse` and `git worktree` split <!-- builds: refFiles, a git ref and worktree file reader declared as a duplicate of git with a corpus test -->

### Files first

- `feature/refs-from-files-adapters` — `refsGit` and `treesGit` ask the file reader first for `refState`, `refStateSync`, `defaultBranch`, `listBranches`, `branchTips`, `resolve`, `currentBranch`, `remoteHead` and `Trees.list`, and git for `unaskable`; the board's direct `worktree list` and `symbolic-ref` calls move to the port; a `--once` spawn-spy test; a changeset <!-- builds: Refs and Trees adapters that read refs and worktrees from files with a git fallback -->

## Notes

- Phase 5 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), candidate plan `refs-from-files`; depends on `the-snapshot-entity`.
- Census figures: `census-report-head` artifact of CI run 42595561157 (PR #3277, 2026-11-09). The report records two passes per S4 row; the per-pass figures above are half the recorded command counts. The `git` key without a subcommand (6 per pass at 0 desks, 75 at 3 desks) is `git` with a leading option such as `-C` or `--no-optional-locks`, mostly per-desk probes that `desk-probes-in-domain` owns.
- Line numbers checked in this worktree (`idea/batch-refs-from-files`, cut from `origin/sprint/the-board-reads-the-channel`) on 2026-11-09.
- Deliverable search (`plot-deliverable-search.sh`) for "refs-from-files", "ref file reader" and "packed-refs": no reader exists; the only hits are unrelated (`plot-reconcile-scan.sh:2579`, `check-decision-count.sh:74`). `git grep reftable` finds nothing.
- Definition of Done: docs/definition-of-done.md.
