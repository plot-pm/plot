# Host connector: Bitbucket parity and App identities

> Six closed issues leave open work on the host connector: Bitbucket arms that trail GitHub, and the Writer and Merger App identities that refuse or fall back wrongly.

## Status

- **State:** Approved
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** feature
- **Issue:** #1848
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Started:** 2026-10-16, Jan Wloka, `bug/merge-names-what-it-did`
- **Started:** 2026-10-16, Jan Wloka, `bug/app-identities-refuse-by-name`
- **Started:** 2026-10-16, Jan Wloka, `feature/bitbucket-commit-status-parity`

## Changelog

- The board-free merge names the right refusal reason for an uppercase sha and says when a merge was not pinned.
- Bitbucket pages from any `bb` version that returns a JSON envelope read as complete when the page has no `next`.
- `plot-host.sh commit-status` on Bitbucket maps `pending` to `INPROGRESS`, times out, and encodes the URL parts.
- The Writer App push uses the App token only, removes its token file on every exit, and reports exit 3 and 4 by name.
- A failed config read refuses by name instead of counting as an absent App key.

<!-- Board impact: none. The plan format, the template, the docs/plans layout and the board's payload do not change. Slice 1 touches packages/board/src/server/entry/merge.ts, which the board artifact bundles; rebuild with pnpm build:board to test, restore the generated paths before the push. -->

## Motivation

Issue #1848 tracks a triage of all open issues against main at `c40ac9e96` (2026-10-16). Each member issue was closed in favour of #1848. Its line below says what is still open on main.

| Issue | Open on main |
|-------|--------------|
| #1533 | An uppercase sha passes validation in `entry/main.ts:146` and then refuses as `head-moved`. The `unaskable` detail in `merge.ts:104` says "Absent is not green" while a null reading permits the merge. The TSDoc at `merge.ts:70-73` names `plot-host.sh` and `checksSha = headRefOid`, which are adapter facts. |
| #1556 | `plot-ask merge` merges unpinned on Bitbucket since #1809, but its answer does not say so. `skills/plot-sprint/SKILL_new.md` is a tracked stray copy of `SKILL.md`. The refusal text for an unpinned `gh pr merge` in `controller-gate.ts` does not say that `gh` has no place on a Bitbucket repository. |
| #1713 | `plot-bitbucket-commit-status.mjs` refuses `pending` and `error`. `fetch` has no timeout. `workspace`, `repoSlug` and `sha` enter the URL unencoded. The `_bb_wr` slug parse in `plot-host.sh` fails on a trailing slash. The `plot-host.sh` row in `skills/plot/scripts/README.md` still says `commit-status` is GitHub only. No corpus test holds both backends' answers. |
| #1757 | `BB_LIST_PAGE_VERSIONS` in `plot-host.sh` and the table in `adapters/host/listing-paging.ts` name only `bb` 1.9.0. With `bb` 1.11.1 every Bitbucket page reads as possibly truncated. Measured 2026-10-15: `pullrequests?state=OPEN&pagelen=50` returns 9 values, no `next`. |
| #1824 | Four MEDIUM findings on the Writer App push and one on the changeset (see slice 4), and five LOW findings. |
| #1827 | `plot-github-app.mjs:25-31,45-50` takes `absent` from `!declared`, so a failed `plot-config.sh` read counts as no key. The changeset `app-identities-are-opt-in.md` says "still refuses with exit 4" for a path that reports `rejected`. |

The first three rows are Bitbucket parity. The last two are App identities. Both sit on the host connector and share files (`plot-host.sh`, `skills/plot/scripts/README.md`).

## Design

### Approach

Five slices, one branch each. They touch different files and run as one wave. Each slice fixes what its issue lines name, and nothing else.

**Layering.** The merge slice follows the layering rule: the domain TSDoc states what the port promises and names no script. Slice 2 adds no script call outside an adapter.

**Slice 2 rule.** A page that comes back in the `bb api` JSON envelope and has no `next` is complete, for any `bb` version. The version list stays as the fallback when the envelope is missing. This is the way out that #1137 and #1757 name. It removes the list as a per-upgrade chore. A corpus test holds `plot-host.sh` and `listing-paging.ts` to the same answer, because both implement the rule (see `docs/shell-and-domain.md`).

**Slice 4 rule.** A credential helper must not be a second source for the App push. The push runs `git -c credential.helper= push https://github.com/<repo>.git`, so the askpass token is the only credential and the origin URL does not matter. The script saves its exit status, removes its token directory, then exits. `plot-push-main.sh` passes exit 3 and 4 through before `classify`, so the ladder in `ladder.ts` stops retrying a refusal.

**Slice 5 rule.** `absent` comes from exit 0 with empty output only. Any other exit from `plot-config.sh` refuses by name.

### Open Questions

- [ ] Slice 3: does `pending` map to `INPROGRESS` on Bitbucket, or does the plan record the refusal as deliberate? `error` has no Bitbucket state (`FAILED` and `STOPPED` are the nearest); the plan needs one answer for both.
- [ ] Slice 3: what is Bitbucket's merge-check shape? #1711's plan left it open and the slice must answer it or record it as out of scope.
- [ ] Slice 2: does a missing `next` in an envelope always mean the last page on `bb` 1.9.0 and 1.11.1, and does any version return `next` on the last page? The measurement of 2026-10-15 covers 1.11.1 only.
- [ ] Slice 4: the changeset of PR #1823 is a `patch` and gives no upgrade warning. Does the correction ship in the next changeset, or does the released entry need an amendment? The release entry cannot change after publication.
- [ ] Does slice 1 delete `SKILL_new.md`, or does it have a purpose? `git log` on the file decides; the slice states the result.

## Slices

### Wave 1

- `bug/merge-names-what-it-did` — #1533 and #1556: lowercase the sha before the compare, correct the `unaskable` detail to "A failed read is not an absent reading", move the adapter facts out of the `merge.ts` TSDoc, add "merged unpinned: Bitbucket cannot pin a merge" to the answer, state in the gate's refusal text that `gh` has no place on a Bitbucket repository, and remove or explain `skills/plot-sprint/SKILL_new.md` <!-- builds: unpinned-merge notice in the plot-ask merge answer --> → #1882
- `bug/bitbucket-pages-read-complete` — #1757: a page without `next` in the `bb api` envelope is complete in `plot-host.sh` and `adapters/host/listing-paging.ts`; add `1.11.1` to both version lists as the fallback; a corpus test holds the pair <!-- builds: envelope-based page completeness rule --> → #1884
- `feature/bitbucket-commit-status-parity` — #1713: map `pending` (and decide `error`) in `STATE_MAP`, add a fetch timeout, encode `workspace`, `repoSlug` and `sha`, make the `_bb_wr` slug parse tolerate a trailing slash or answer `unsupported`, correct the `commit-status` row in `skills/plot/scripts/README.md`, and add a corpus test that holds both backends' answers
- `bug/writer-app-push-uses-only-the-app` — #1824 Writer findings: `git -c credential.helper=` and a push to the HTTPS URL, remove the token directory before exit, pass exit 3 and 4 through before `classify` in `plot-push-main.sh`, catch an invalid PEM in `plot-push-writer-app.mjs` and `plot-merger-token.mjs`, and tighten the `pushmain.test.mjs` assertion from `notEqual(code, 0)` to the exit code <!-- builds: App-only push path with no credential helper -->
- `bug/app-identities-refuse-by-name` — #1824 and #1827 remaining findings: `absent` only from exit 0 with empty output in `plot-github-app.mjs`, `plot-commit-status.mjs` stops signing an unused JWT, `plot-host.sh` names the failed repo lookup, `docs/review-status-rollout.md` step 4 checks the push actor, the `approve*.test.mjs` fixture moves to one shared helper, and the changeset text names the required setup and the real exit codes → #1886

## Notes

- Created from tracker issue #1848 on 2026-10-16. The plan writes nothing to the tracker; the `Issue:` field is the only link.
- The reviewer's out-of-scope note in #1827 (the five-round retry on a rejected push) is the `classify` passthrough in slice 4. It existed before PR #1823.
- Slices 4 and 5 both touch `plot-push-writer-app.mjs` and `plot-github-app.mjs` neighbours. If the diffs collide, `/plot-reslice` orders them.
- Definition of Done: `docs/definition-of-done.md`.
