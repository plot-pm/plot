# Controller gate refuses read-only commands that name a gated script (grep, sed)

> The controller gate refuses a read-only `sed`, `rg` or `awk` whose file operand is a gated script, although the command runs no script.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #2530
- **Review:** pr
- **Impl:** own branches

## Changelog

- The controller gate treats a segment whose program is `sed` (without `-i`, `-s` write forms or `e`/`w` commands), `rg` or `awk` as a read, whichever gated script it names, with the same guards a reader segment has today.

<!-- Board impact: none. A matching rule in `packages/domain/src/rules/`. No plan format, no template, no layout. -->

## Motivation

Issue #2530 (2026-10-23, Plot 2.28.0) reports `grep -n -E '"People"|People:' …/plot-approve.sh` and `grep -n -E 'WORKER_CMD|Worker command' plot-dispatch.sh` refused with `plot-approve.sh is a controller-owned action`. Its title also names `sed`. Nothing ran a gated script.

Most of the report is answered. `the-controller-gate-reads-a-grep` (#2706, Released 2.29.0) made `isReadSegment` delegate to `isReader` over `READERS` (`packages/domain/src/rules/ci-suite.ts:60`), so `grep`, `cat`, `head`, `tail`, `wc`, `diff`, `cmp`, `stat`, `shasum`, `sha256sum`, `test`, `[` and `git diff|show|log|grep` read as reads. `controller-gate-fires-on-a-script` (#2440) covered the commit-message shape.

What `READERS` does not list: `sed`, `rg`, `awk`. Those are the readers the issue title names (`sed`) and the ones an agent reaches for next after `grep`. Read from `ci-suite.ts:60` on `origin/main` (`fbf670eaf`) on 2026-11-04; not yet measured against a live gate. A local run of `plot-gate.mjs` on that checkout allowed even a plain `plot-approve.sh foo`, so the refusal itself needs a reproduction in a session with the hooks active before the first slice.

The cost is the one #2706 measured: an agent that cannot read a controller script with `sed` rewrites the command around the name or takes the unowned-action receipt, which counts a bypass for an action that never ran.

## Design

### Approach

Extend the one reader predicate, and add no second list. `sed`, `rg` and `awk` differ from `grep` in that each can run or write something:

- `sed -i`, `-s` with `w`, and the `e` and `w` commands write or execute.
- `awk` has `system()` and output redirection inside its program text.
- `rg` has `--pre <command>`, which runs a program on every file.

So each needs an option guard of the kind #2706 gave `git`: `sed` is a read without `-i`/`--in-place`, and with no `e` or `w` command in its script; `rg` is a read without `--pre`; `awk` is a read when its program text holds no `system(`, `|` or `>`. The guards sit beside the `git` run-option guard.

### Open Questions

- [ ] Does the gate refuse `sed`, `rg` and `awk` today? Reproduce with the hooks active before building.
- [ ] Is `awk` worth admitting? Its program text is hard to read as data, and `sed -n` and `rg` cover the reads the issue reports.
- [ ] Do `find`, `jq` and `column` belong in the same pass, or do they wait for a report?

## Slices

### Reader set

- `feature/controller-gate-reads-sed-and-rg` — add `sed` and `rg` to the reader predicate with their run and write guards, and tests that pin each guard <!-- builds: sed and rg entries in the controller gate's reader predicate -->

## Notes

Related: #2440, #1852, #2706.
