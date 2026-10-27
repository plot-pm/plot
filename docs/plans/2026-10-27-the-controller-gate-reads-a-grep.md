# The controller gate reads a grep over a gated script as a run

> The controller gate refuses a read-only `grep` whose file operand is a gated script, although the command runs no script.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2706
- **Review:** pr
- **Impl:** own branches

## Changelog

- The controller gate treats a segment whose program is a reader (`grep`, `head`, `tail`, `wc`, `diff`, `cmp`, `stat`, `shasum`, `sha256sum`, `test`, `[`) as a read, whichever gated script it names. `bash`, `sh` and `xargs` over a gated script are still refused.

<!-- Board impact: none. A matching rule in `packages/domain/src/rules/`. No plan format, no template, no layout. -->

## Motivation

Issue #2706 measured on 2026-10-26, in a master session on `main` with the plugin gate `plot@plot-marketplace` 2.28.1:

```
grep -n 'orphaned claim' skills/plot/scripts/plot-reap.sh | head; grep -n 'holds no claim' skills/plot/scripts/plot-dispatch.sh | head -3
```

The gate answered `plot-controller-gate: plot-dispatch.sh is a controller-owned action.` and printed the dispatch route. The command runs no script. The same search as `grep -rn '…' skills/plot/scripts/*.sh` passed, because the glob matches all three gated scripts and so names none.

An agent that wants to read a controller script has two exits. It rewrites the command to avoid the name (a glob, a directory search), or it takes the unowned-action receipt, which counts a bypass in `.plot/state/unowned-action-writes.tsv` for an action that never ran. Both teach routing around the gate.

## Design

### Approach

`controllerInvocation` (`packages/domain/src/rules/ci-suite.ts:208`) reads every segment that names a gated script as a run, unless `isReadSegment` (`ci-suite.ts:302`) says the segment is a read. `isReadSegment` accepts three programs: `ls`, `cat` and `git grep`. The same file declares a wider set, `READERS` (`ci-suite.ts:60`), and uses it only for the word list of a `for` loop. `grep`, `head`, `tail`, `wc` and the rest are therefore read as a run when they name a gated script.

The change makes `isReadSegment` agree with `READERS`. A segment whose program is a reader that never runs its operand is a read. `git diff`, `git show` and `git log` (`GIT_READERS`) join `git grep`.

Tests, as the issue states them: `grep -n x skills/plot/scripts/plot-dispatch.sh` and `head -5 skills/plot/scripts/plot-approve.sh` read as `null`. `bash skills/plot/scripts/plot-dispatch.sh x` and `xargs skills/plot/scripts/plot-dispatch.sh` still read as `'dispatch'`.

`unpinnedProgram` (`controller-gate.ts:242`) also calls `isReadSegment`. The widening carries over to the merge-pin check: a `grep` whose text names `gh pr merge` stops counting as an unpinned merge. This is the same fix for the same false positive, and the plan's tests cover it.

### Open Questions

- [ ] Does `sed` join the set? `sed -n` reads, but `sed` with an `e` command or a `w` flag runs or writes. The issue allows it only when the script carries neither. A gate that parses `sed` scripts is more code than the three-word reads justify; leaving `sed` out costs one rewrite per use.
- [ ] A reader whose operand holds a substitution runs it: `grep x $(plot-dispatch.sh y)`. `cat $(plot-approve.sh y)` has the same hole today. Does the change close it for all readers, or does it record the hole as known?
- [ ] `isReadSegment` is shared by the dispatch/approve/deliver check and the merge-pin check. Does one reader set serve both, or does the merge check keep its own?
- [ ] `test` and `[` appear in `READERS` for loop bodies. `[ -x plot-dispatch.sh ]` reads. Does a segment with `-exec`-like operands (`find`) stay out of the set? `find` is not in `READERS`; confirm that it stays out.

## Slices

### Reader set

- `feature/the-controller-gate-reads-a-grep` — `isReadSegment` agrees with `READERS`, with tests for the reads and the runs above <!-- builds: isReadSegment reading the full READERS set -->

## Notes

Issue: https://github.com/plot-pm/plot/issues/2706. The plan writes nothing to the tracker.
