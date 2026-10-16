# A lifecycle micro-PR merged past the review gate

> The ladder's micro-PR fallback merged #1730 four seconds after it opened, with no `validate` run and no `plot/review` status on its head.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1737
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1738 merged
- **Started:** 2026-10-15, Jan Wloka, `bug/a-lifecycle-micro-pr-merged-past-retry`
- **Started:** 2026-10-15, Jan Wloka, `bug/a-lifecycle-micro-pr-merged-past-pin`
- **Started:** 2026-10-16, Jan Wloka, `infra/a-lifecycle-micro-pr-merged-past-identities`
- **Rejected:** 2026-10-16 (PR #1816 for `infra/a-lifecycle-micro-pr-merged-past-identities` merged carrying only its claim commit; the writer and merger identities were never built)

## Changelog

- A lifecycle write whose push to the default branch is rejected fetches, re-applies and pushes again, and refuses by name after a bounded number of attempts. It never opens a pull request.
- Plot merges pull requests with a credential that is not on the default branch's bypass list, so the required checks bind Plot's own merges.
- `plot-host.sh pr-merge` refuses an unpinned merge on GitHub; every caller names the head SHA it checked.

<!-- Board impact: none expected. The plan format and the board's plan parsing do not change. -->

## Motivation

Main's ruleset 24412719 requires `validate` (integration 15368) and `plot/review` (integration 5317669) since 2026-10-15T02:17:59Z. The gate must hold against Plot's own tooling, not only against people.

`POST /api/release {"slug":"a-pr-cannot-merge-until-its","version":"2.27.0"}` lost a push race with nine other release records and took the micro-PR fallback in `packages/board/src/server/entry/ladder.ts:155-177`. #1730 opened at 03:36:31Z and merged at 03:36:35Z under the maintainer's account. Its head had no `validate` run and no `plot/review` status (`gh api repos/plot-pm/plot/commits/<head>/statuses` lists none).

The ladder writes the `plot/review` status itself through `commitStatus`, ignores the result (also listed in #1719), then runs `plot-host.sh pr-merge <n> --delete-branch`. That call runs `gh pr merge` without `--admin` and without `--match-head-commit`.

At 03:2xZ the same account ran `gh pr merge 1604 --squash --match-head-commit <sha>` without `--admin` while `validate` was not yet linked to the PR. GitHub refused it: "the base branch policy prohibits the merge". The ladder's merge passed four seconds after the PR opened. Some path lets a merge by this account pass the required checks. The admin role is on the bypass list with `bypass_mode: always`.

This is also the likeliest answer to the open question of who merged #1667, #1668, #1687 and #1726 under the maintainer's account: a Plot process merging with that account's token.

## Design

### Decisions

Decided by the maintainer on 2026-10-15 (issue #1737, comment of that date).

- **A rejected push retries; there is no micro-PR.** A lifecycle write runs on a disposable branch cut from the fetched default branch. When its push is rejected, the ladder fetches again, re-cuts the branch, re-applies the same write, and pushes again, up to five attempts with a jittered wait of 2 to 10 seconds. After the last attempt it refuses with the attempt count and writes nothing. The micro-PR fallback in `ladder.ts:155-177` is removed, and with it the `plot/review` status the ladder writes on its own PR: a review status from a process that reviewed nothing is not a review. The race that started this (nine release records pushed at once, 2026-10-15) ends with every write landing, one after another.
- **Plot's tooling gets no bypass for merges.** Every pull-request merge Plot performs (`plot-ask.mjs merge`, the approve controller's plan-PR merge, any `pr-merge` caller) runs with a credential that is not on the ruleset's bypass list. The maintainer's own break-glass is unchanged: an admin merge with a `review-bypass: <reason>` comment, which `/plot-reconcile` reports.
- **`pr-merge` is pinned on GitHub.** `plot-host.sh pr-merge` exits 1 on GitHub without `--match-head <sha>`. Every caller passes the head SHA its checks were read on. Bitbucket keeps its named refusal (exit 4) when a pin is asked for, because its host cannot pin a merge.

### The two identities

The first two decisions pull against each other. A lifecycle write is a direct push to the default branch, and the ruleset (a pull-request rule and two required checks) refuses a direct push from anyone off the bypass list. Today those pushes succeed only because the maintainer's token is on that list (`push=bypassed` in every release record of 2026-10-15). Taking the bypass away from Plot's tooling therefore also stops its lifecycle writes.

**Recommended answer: two identities with one job each.**

- **Lifecycle writer:** a narrow GitHub App on the bypass list, set up like `plot-board-builder` (which pushes the built bundles today), with `Contents: write` only. The ladder pushes plan, sprint and index writes with its installation token, minted the way `plot-commit-status.mjs` mints the review App's. It never merges a pull request.
- **Merger:** a third narrow GitHub App, not on the bypass list, with `Contents: write` and `Pull requests: write`. A merge by it passes only when `validate` and `plot/review` are green on the pinned head.

A credential holding both jobs would be on the bypass list and could merge past the gate, so this plan does not offer one.

### Answered

- **Two identities: confirmed** (maintainer, 2026-10-15). The writer App pushes lifecycle writes; the merger merges pull requests.
- **The merger is a third narrow App** (maintainer, 2026-10-15): `Contents: write` and `Pull requests: write`, on no bypass list, its key under `~/.config/plot/` and named by a Plot Config key as `Review app` is. Its merges show as `<app>[bot]`.
- **Five push attempts, 2 to 10 seconds apart with jitter** (maintainer, 2026-10-15), about 30 seconds at worst before a lifecycle write refuses.

## Slices

### Retry

- `bug/a-lifecycle-micro-pr-merged-past-retry` — the ladder re-fetches and re-pushes a rejected lifecycle write a bounded number of times and refuses by name; the micro-PR fallback and its self-written `plot/review` status are removed <!-- builds: a bounded push retry in the ladder --> → #1795

### Pin

- `bug/a-lifecycle-micro-pr-merged-past-pin` — `plot-host.sh pr-merge` refuses an unpinned merge on GitHub, and every caller passes the head SHA it checked <!-- builds: a mandatory merge pin --> → #1809

### Identities

- `infra/a-lifecycle-micro-pr-merged-past-identities` — lifecycle pushes use the writer App's token and pull-request merges use the merger credential, each read from a Plot Config key; the docs give the person's setup steps for both and keep the merger off the bypass list <!-- waits: bug/a-lifecycle-micro-pr-merged-past-retry, bug/a-lifecycle-micro-pr-merged-past-pin --> → #1816

### Identities (build)

- `infra/a-lifecycle-micro-pr-merged-past-identities-build` — builds what `### Identities` promised: lifecycle pushes use the writer App's token and pull-request merges use the merger credential, each read from a Plot Config key; the docs give the person's setup steps for both and keep the merger off the bypass list. #1816 merged carrying only its claim commit, so nothing of the Identities slice exists on main.

## Notes

- Related: #1719 (the ladder ignores the `commitStatus` result; the retry slice removes that call), #1730 (the PR that merged), plan `a-pr-cannot-merge-until-its` (the gate this bug passes).
- The maintainer merged some of #1667, #1668, #1687 and #1726 by hand; those are break-glass merges, not this bug.
