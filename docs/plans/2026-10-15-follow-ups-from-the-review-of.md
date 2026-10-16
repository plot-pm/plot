# Follow-ups from the review of #1722: the reviewer judges the PR diff

> `plot-review` can fail at exec on a 128K–200K character diff, judges a PR against `origin/HEAD` instead of its base, throws on a tracked `.plot-review` file, and has no test for `readChange`.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #1724
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1749 merged
- **Started:** 2026-10-15, Jan Wloka, `feature/review-diff-limit-in-bytes`
- **Started:** 2026-10-15, Jan Wloka, `feature/review-judges-the-pr-base`
- **Started:** 2026-10-15, Jan Wloka, `feature/review-refuses-a-tracked-dir`
- **Delivered:** 2026-10-16
- **Released:** 2026-10-16, v2.27.1

## Changelog

- `plot-review` limits the inline diff by bytes, judges a PR against its own base branch, and refuses with exit 3 when a tracked `.plot-review` file blocks its directory.

<!-- Board impact: none. The change is in `packages/domain/src/rules/review-verdict.ts` and `packages/board/src/server/entry/review.ts`. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

The `plot-review` run on #1722 at 5a0043588 reported two MEDIUM and two LOW findings. The command could not file them itself, so they sit in #1724.

- **Inline diff above the Linux argument limit.** `reviewRequestBlock` (`review-verdict.ts:44`, `:78`) inlines the diff when it holds at most `REVIEW_INLINE_DIFF_LIMIT` = 200,000 UTF-16 code units. The prompt goes to `bash -c` as one argument (`agent-run-command.ts:64`), and Linux caps one argument at 131,072 bytes. The charter prompt adds to the diff. A diff of about 128K to 200K characters fails at exec, no status is written, and the PR cannot merge.
- **Wrong diff base.** `readChange` (`review.ts:298-310`) diffs against `deps.base`, which is `origin/HEAD` (`review.ts:340`, `:187`). The `Pr` entity has no base ref. A PR that targets a release branch, or a stacked PR, is judged against the wrong change.
- **Tracked `.plot-review` file.** When a regular file named `.plot-review` is tracked, `mkdirSync` throws (`review.ts:351`). The run ends with a stack trace instead of a named refusal with exit 3.
- **`readChange` has no test.** The refspec, the merge-base step, `--no-ext-diff`, the size limit and the `--name-only` split are untested.

## Design

### Approach

1. **Byte limit.** Replace the character comparison with `Buffer.byteLength(diff, 'utf8')` against a limit in bytes. The limit is 128 KiB minus a reserve for the charter prompt and the fixed request block. A diff above the limit is left out of the prompt, as today, and the reviewer reads `diffPath`.
2. **PR base.** Add the base branch name to the `Pr` entity and fill it in the host connectors (`gh`, `bb`). `review.ts` passes that name to `readChange` in place of `deps.base`.
3. **Named refusal.** Catch the `mkdirSync` failure in `review.ts` and return `{ code: EXIT.refused, lines }` naming the path.
4. **`readChange` tests.** Cover the fetch refspec, the merge-base step, `--no-ext-diff`, `REVIEW_DIFF_MAX_BYTES` and the `--name-only` split, against a sandbox repository with a real base branch.

Layering: the limit is a domain rule; `readChange` and `mkdirSync` stay in the board entry; the host connectors supply the base ref through the existing `Host` port. Functions written here are arrows.

### Open Questions

- [ ] What reserve does the byte limit leave for the charter prompt? Measure the charter file and the fixed block, then pick a number.
- [ ] Does the `Pr` entity gain `base` as a required field, or optional with a fallback to the default branch for a host that cannot report it?
- [ ] Does Bitbucket report a PR's destination branch through the same `pr-state` call?

## Slices

### Wave 1

- `feature/review-diff-limit-in-bytes` — limit the inline diff in bytes below the argument cap <!-- builds: REVIEW_INLINE_DIFF_LIMIT in bytes, with a reserve for the prompt -->
- `feature/review-judges-the-pr-base` — add the base ref to `Pr` and diff against it → #1804 <!-- builds: Pr.base, filled by the host connectors -->

### Wave 2

- `feature/review-refuses-a-tracked-dir` — a tracked `.plot-review` file ends the run with exit 3, and `readChange` gets its tests → #1807 <!-- builds: a named refusal for an unusable review directory; readChange tests --> <!-- waits: feature/review-judges-the-pr-base -->

## Notes

- Source: issue #1724, from the `plot-review` run on #1722.
- Created unattended. `Review: pr` and `Impl: own branches` are the defaults for a multi-slice plan; the reader can change them before approval.
