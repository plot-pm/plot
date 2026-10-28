# plot-reap --yes deletes a different set than its --dry-run showed

> `plot-reap --yes` re-decides every local branch against the host instead of acting on the set `--dry-run` showed, so the operator approves one set and the run deletes another.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2825
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-reap --yes` deletes the local branches the operator approved and no others, records each deleted branch's tip SHA, and counts `branches_deleted` from the rows it prints.

<!-- Board impact: none expected. The reap entry prints rows the board does not parse. If the plan-file option below is chosen, a new file under `.plot/state/` is added; the plan format, the template and the docs/plans layout stay unchanged. -->

## Motivation

Issue #2825 reports one run on ewz-kus-portal (Plot 2.29.0, Bitbucket, account rate-limited, see #2815). `plot-reap.sh --dry-run` listed the branches it would delete; the operator bundled exactly that set before approving. `plot-reap.sh --yes` then deleted a different set:

| branch | dry run | `--yes` run |
|---|---|---|
| `migration-abw-rechnungsempfaenger` | keep — unlanded work, no merged PR | deleted — PR merged (squash) |
| `feature/EWZREL-9391`, `feature/EWZREL-9832-adds-http-headers` | not listed | deleted — merged into develop |
| 6 branches (e.g. `marc/magellan-integration`, `slice/EWZREL-9386`) | would — PR merged (squash) | kept |

The summary lines disagree as well: dry run `branches=38 branches_kept=18`; real run `branches=37 branches_deleted=37 branches_kept=19`, where the deleted count does not match the rows printed. Nothing was lost, because the squash content is on develop and the operator pinned every dangling commit afterwards.

Cause, read at `7c30e136c`: `runBranchKind` in `packages/board/src/server/entry/reap.ts` (about `:1000-1050`) decides each branch from scratch on every run. It asks `ctx.refs.contains(br, origin/<default>)` and, when that is not `yes`, `ctx.host.prMerged(br)`, and treats a `merged` answer as `PR merged (squash)`. `--dry-run` and `--yes` share that code and differ only at the delete call. Two runs minutes apart answer differently when the host answers differently under 429 pressure, or when the merged-PR reading changed between versions (#2730). `deleteBranch` then runs `git branch -D`, which keeps no record of the tip.

## Design

### Approach

The issue names three expectations; this plan keeps all three and proposes an order.

1. **What is approved is what runs.** Two options from the issue, to be chosen in review:
   - A recorded plan: `--dry-run` writes branch, tip SHA and reason to a file; `--yes --plan <file>` deletes exactly those refs and refuses any whose tip moved.
   - Confirm in place: `--yes` without a plan prints the decision, asks once, and deletes only that set.
   The recorded plan suits an unattended caller and a reviewed backup; the confirmation suits a person at a terminal. The recommendation is the recorded plan, because the tip-SHA check is the part that stops a stale decision, and the confirmation cannot give that to a caller with no terminal.
2. **A deletion is reversible.** Each deleted ref's tip SHA goes to a log under `.plot/state/` (or `refs/plot/reaped/*`), written before the delete call.
3. **A degraded host answer keeps the branch.** A `PR merged (squash)` verdict made while the host is rate-limited or answered partially is downgraded to `keep`. Whether the host adapter exposes "limited or partial" to the reap entry is the first thing to measure.
4. **The summary counts printed rows.** `branches_deleted=` equals the number of `deleted` rows. In `runBranchKind`, `swept` increments before the delete and a failed delete increments `kept`, so the counters can drift from the rows; the fix is a test that parses the output and compares.

The decision belongs in the domain (`firstBranchRefusal` already lives there), per *The Layering Rule* in `CLAUDE.md`: the reap entry should take the recorded decision as a value and the domain should say whether a recorded row is still valid at the current tip.

### Open Questions

- [ ] Recorded plan file or confirm in place? Both?
- [ ] Where do the reaped tips go: a log file, or `refs/plot/reaped/*`? A ref keeps the objects from `git gc`; a log does not.
- [ ] Does the host port report rate-limited or partial answers to `prMerged` today? If not, which slice adds that?
- [ ] Do the worktree and claim kinds (`runWorktreeKind`, the claim sweep) share the same dry-run/yes divergence? This plan covers branches only until measured.
- [ ] Dry-run default stays; does `--yes` with no `--plan` still run, or refuse?

## Slices

### Branch decisions

- `bug/plot-reap-yes-acts-on-the-approved-set` — `--dry-run` records the decision; `--yes` acts on that record and refuses a moved tip; `branches_deleted=` counts printed rows

### Reversibility and degraded host

- `bug/plot-reap-records-the-tip-it-deletes` — record each deleted ref's tip SHA before `git branch -D`
- `bug/plot-reap-keeps-a-branch-when-the-host-was-limited` — downgrade a merged verdict made under a rate limit or a partial answer to `keep` <!-- waits: bug/plot-reap-yes-acts-on-the-approved-set -->

## Notes

- Related: #2807, #2815, #2730.
- Source: tracker issue #2825. The plan writes nothing to the tracker.
