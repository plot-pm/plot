# Bitbucket: pr-state and pr-merged miss a PR merged before the newest 50

> On Bitbucket, `pr-state` and `pr-merged` read one page of 50 merged PRs, so a PR merged before the newest 50 reads as `NONE` / `not-merged`; both ask for the branch itself instead.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2187
- **Review:** pr
- **Impl:** own branches

## Changelog

- On Bitbucket, `plot-host.sh pr-state`, `pr-merged` and the merge-commit and head lookups find a PR merged before the newest 50 merged PRs, so delivery, reaping and the merged-branch guards see old merges.

<!-- Board impact: none expected. No plan-format, template or docs/plans layout change; the board reads `pr-state` rows from the pulse as before. -->

## Motivation

On Bitbucket, `plot-host.sh pr-state <branch>` and `plot-host.sh pr-merged <branch>` read one page of `bb pr list --state merged --json`: 50 rows (`plot-host.sh` lines 3801, 3873 and 3914 at main `1c347d610`). A PR merged before the newest 50 merged PRs is not on that page. `pr-state` then answers `{"number":0,"state":"NONE"}` and `pr-merged` answers `not-merged`.

Measured 2026-10-20 on ewz-kus-portal, read-only: the 50-row merged page reached back to 2026-09-30. `feature/ewzkus-3845-contractaccount-bykey-tracer` merged as PR #3644 into `develop` on 2026-09-26 (`bb pr view 3644`), and `pr-state` / `pr-merged` read it as `NONE` / `not-merged`. `plot-host.sh pr-list --state merged --branch <that branch>` returned #3644 with "sweep complete".

On an active Bitbucket repository, every slice merged more than about three weeks ago reads as unmerged wherever `pr-state` or `pr-merged` decides: delivery, reaping and the merged-branch guards. A `not-merged` answer from a page that did not reach far enough is a false negative, which *One Answer To "Did This Land"* in `CLAUDE.md` forbids. Release 2.28.0 waits on this: Plot must work on a Bitbucket + Jenkins + Jira project before it ships.

## Design

### Approach

Each Bitbucket arm asks for the branch itself, with the per-branch query `pr-list --branch` already uses (`bb_branch_query`, `bb_branch_sweep`, `plot-host.sh` around line 1090). The query carries `source.branch.name` inside `q=`, so the host filters and the page holds only that branch's PRs.

- **The sites.** The arms at lines 3801 (`pr-merged`), 3873 (merge commit of a merged branch) and 3914 (merged head) all read `bb pr list --state merged --json` and filter `source.branch.name==$b` locally. The `pr-state` arm needs the same reading; the slice lists every `bb pr list` call that filters by branch locally before it changes any of them.
- **Fallback when the branch query is unavailable.** If the branch query cannot run, or the page it reads is full without containing the branch, the answer is `unknown` (exit 3 where the arm uses it), never `NONE` / `not-merged`.
- **Cost.** One request per asked branch, against one request per page today. The connector's rate-limit contract applies (`CLAUDE.md`, *The Layering Rule*): the slice records the request count per `pr-state` call in the budget log.

### Open Questions

- [ ] Does the branch query serve `pr-state` too, or does `pr-state` need an open-or-merged-or-declined sweep (`bb pr list` has no `all` state; see the comment near `plot-host.sh:804`)?
- [ ] Does `pr-state` keep its `NONE` answer for a branch the branch query proves has no PR in any state?
- [ ] The `unknown` word: does each caller of `pr-merged` and `pr-state` already treat exit 3 / `unknown` as "ask again later"? The slice lists the callers and their handling first.

## Slices

### Branch query

- `bug/pr-state-and-pr-merged-miss` — Bitbucket `pr-state`, `pr-merged` and the merge-commit and head lookups ask for the branch itself, or answer `unknown`; tests cover a fixture whose branch merged past the first page.

## Notes

Prior art in the same area: the delivered plans for #2154 and #2156 (Bitbucket `pr-list` rows) and the approved plan for #2186 (`plot-pr-merged.sh` routed through `plot-host.sh pr-merged`). The #2186 route makes `pr_merged` depend on the answer this plan fixes.
