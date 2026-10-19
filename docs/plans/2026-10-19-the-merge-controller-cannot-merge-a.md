# The merge controller cannot merge a Bitbucket PR

> On a real Bitbucket repository the merge path refuses every PR: it compares a 12-character head with a 40-character sha by equality, and `pr-merge` without `--match-head` still merges. This plan makes the head comparison a prefix match and makes the unpinned Bitbucket merge refuse.

## Status

- **State:** Approved
- **Type:** bug
- **Story:**
- **Sprint:**
- **Issue:** #2076
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2101 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/the-merge-controller-cannot-merge-a-rule`

## Changelog

- A Bitbucket PR merges through the merge controller: the head check matches a short sha against a full one by prefix (minimum 7 hex characters), and `pr-merge` on Bitbucket refuses without `--match-head`.

## Motivation

Field test on 2026-10-19 against ewz-kus-portal (plot at `fb05579d6`). Nothing was merged, and every call was proven to make no write. The merge controller cannot merge any Bitbucket PR:

1. **Short and full sha compared by equality.** Bitbucket reports a 12-character head (`66836536f8c9`). `plot-ask.mjs merge` accepts only 40 characters (`packages/board/src/server/entry/main.ts:148`, `/^[0-9a-f]{40}$/`). With the full sha, `packages/domain/src/workflows/merge.ts:96` compares by equality and refuses `head-moved` with the detail "the head of PR #3686 is 66836536f8c9; the caller read 66836536f8c9". `plot-host.sh` `pr-merge --match-head` (about line 3953) compares the same way and refuses the real 40-character head too.
2. **Checks are never bound.** With the shas aligned, `merge.ts:103` refuses `checks-unbound` because `checksSha` is always empty on Bitbucket. The cause and fix belong to #2075 (`2026-10-19-jenkins-checks-never-bind-to-the.md`, Approved), not to this plan.
3. **Unpinned merge.** The Bitbucket arm of `pr-merge` without `--match-head` (the final `else` of the `pr-merge` case) still calls `bb pr merge`. The header of `plot-host.sh` says `--match-head` is mandatory; only the GitHub arm enforces it.
4. **Short merge commit.** `pr-state` reports `mergeCommit` with 12 characters on Bitbucket and 40 on GitHub. It is harmless today. A consumer that compares it to a git sha by equality fails as item 1 does.

The refusal itself works: `pr-merge 3686 --squash --match-head 000000000000` answered `head-moved … nothing was merged` (exit 1) after one `bb pr view`.

Related: #2054 (the head re-read that this plan corrects), #2067, #1974 (the same prefix rule for Jenkins).

## Design

### Approach

One rule, applied at three sites: two shas name the same commit when one is a prefix of the other and the shorter has at least 7 hex characters, compared case-insensitively. A shorter value, or a non-hex value, never matches.

- **Domain.** A single exported helper in `packages/domain/src/rules/` holds the rule. `merge.ts` calls it for the `head-moved` check. `rules/verification-record.ts:109` already holds a private `sameCommit` (`startsWith` both ways, no minimum); the plan decides whether to export one shared helper or leave that one alone (Open Points).
- **Board entry.** `main.ts:148` accepts 7 to 40 hex characters for `sha` instead of exactly 40.
- **Shell.** `plot-host.sh` `pr-merge --match-head` on Bitbucket compares by the same rule. The shell duplicates the rule per *A Shell Script Asks The Domain*, so the pair joins the corpus tier at `packages/domain/corpus/` and a test says they agree. The line cost is paid under `scripts/check-shell-lines.sh`.
- **Unpinned merge.** The Bitbucket arm refuses without `--match-head`, with the same wording as the GitHub arm: `pr-merge: bitbucket needs --match-head <sha>; nothing was merged`, exit 1.
- **mergeCommit.** `pr-state` keeps reporting what Bitbucket gives. A consumer compares through the shared rule; no consumer compares by equality today (to be confirmed by a grep in the slice).

Out of scope: `checks-unbound` on Bitbucket (#2075).

### Open Points

- [ ] Export one shared prefix helper and move `verification-record.ts`'s `sameCommit` onto it, or keep two? The unit is the function: a pass-through rename is not wanted.
- [ ] Does `pr-state` normalise `mergeCommit` to 40 characters (one extra `bb` call) or leave it short? Item 4 says harmless; the default is leave it short.
- [ ] Which test proves item 3 without a real Bitbucket: a stubbed `bb` in `test/reconcile/`, as the existing `--match-head` tests do?

## Slices

### Rule and entry

- `bug/the-merge-controller-cannot-merge-a-rule` — shared sha prefix rule in the domain, used by `merge.ts`; `plot-ask.mjs merge` accepts 7 to 40 hex characters <!-- builds: a shared sha prefix-match helper with a 7-character minimum -->

### Host

- `bug/the-merge-controller-cannot-merge-a-host` — `plot-host.sh pr-merge` on Bitbucket matches the pin by prefix and refuses without `--match-head`; corpus test pairs it with the domain rule <!-- waits: bug/the-merge-controller-cannot-merge-a-rule -->

## Notes

- Created from tracker issue #2076. Definition of Done: `docs/definition-of-done.md`.
