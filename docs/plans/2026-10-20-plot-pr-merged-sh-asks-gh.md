# Bitbucket: plot-pr-merged.sh asks gh, so pr_merged never reports a merged branch

> `plot-pr-merged.sh` asks `gh` directly, so on a Bitbucket remote every merged branch reads as unknown; both lookups route through `plot-host.sh` instead.

## Status

- **State:** Delivered
- **Type:** bug
- **Issue:** #2186
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2189 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/plot-pr-merged-sh-asks-gh`
- **Delivered:** 2026-10-21

## Changelog

- `pr_merged` reports a merged branch on a Bitbucket remote. Release-ref cleanup, the dispatcher's merged-branch guard and the quiet-stretch check see Bitbucket merges.

<!-- Board impact: none. The plan format, the template and the docs/plans layout do not change. -->

## Motivation

`skills/plot/scripts/plot-pr-merged.sh` asks `gh` in `_plot_merged_lookup` and `_plot_open_lookup` (`gh pr list --head <branch>`, lines 135–152 at main `1c347d610`). On a Bitbucket remote `gh` fails, both lookups answer `unaskable`, `plot-landed.mjs` turns that into `unknown`, and `pr_merged` returns 1 for every branch, merged or not.

Measured 2026-10-20 on ewz-kus-portal (Bitbucket, base `develop`), read-only: `pr_merged infra/EWZKUS-3885-hotfix-tagging` returned rc 1 and the lookup printed `unaskable`. `plot-host.sh pr-merged` on the same branch answered `merged` (#3705, merged into `develop`).

Every caller that sources the script cannot see a merged branch on Bitbucket:

- `plot-release-refs.sh:213/216` never releases the ref of a merged branch.
- The dispatcher's merged-branch guard (`plot-dispatch.sh`, about line 3834) cannot refuse a branch that already merged.
- `plot-quiet-stretch.sh:151`.

`scripts/check-host-cli-callers.sh` exempts `plot-pr-merged.sh` (line 70 onward) pending a route through `plot-host.sh`. The route was attempted on 2026-09-06 and not finished. The release 2.28.0 waits on this: Plot must work on a Bitbucket + Jenkins + Jira project before it ships.

## Design

### Approach

Both lookups ask through `plot-host.sh` and keep the three-word answer `found` / `none` / `unaskable` that `plot-landed.mjs` reads.

- `_plot_merged_lookup` calls `plot-host.sh pr-merged <branch>` and maps `merged` → `found`, `not-merged` → `none`, `unknown` or a non-zero exit → `unaskable`.
- `_plot_open_lookup` asks for an open PR on the branch through `plot-host.sh pr-list --state open --branch <branch>`, if that op filters PR rows by head. An empty list maps to `none`, a non-empty list to `found`, a failed call to `unaskable`.
- The `check-host-cli-callers.sh` exemption for `plot-pr-merged.sh` and its explanatory comment are deleted in the same change.

The failure direction does not change: a missing CLI, an unauthenticated one and a network failure stay `unaskable`, never `none`. Silence is never permission.

The exemption comment records why the 2026-09-06 attempt stopped, and the slices answer each point:

1. `plot-host.sh pr-merged` read an absent CLI as `not-merged`. Fixed 2026-09-06; it now answers `unknown`.
2. `pr-state` answers about the newest PR only and collapses a failed lookup into `state:"NONE"`, so it cannot express "any open PR" or "unaskable". The open lookup therefore needs `pr-list`, not `pr-state`.
3. The two lookups move together. `pr_open` can only keep a ref, and that is safe because `pr_merged` refuses on the same silence. Routing one without the other separates two answers whose safety is a property of the pair.

### Open Questions

- [ ] Does `pr-list --branch <b>` filter pull-request rows by head branch on both backends? In `plot-host.sh` (line 4076) the flag names branches for the check-run reads. If it does not filter PR rows, the open lookup needs a new op (capability, not routing), and the first slice adds it.
- [ ] Does `pr-list` on Bitbucket distinguish a failed call from an empty result? The open lookup maps an empty result to `none`, so a swallowed failure would read as a real absence.
- [ ] `test/reconcile/host.test.mjs` pins the exemption with two tests (around line 6128). They change with the exemption; confirm which assertions stay as the pair's safety proof.
- [ ] Does a test cover the Bitbucket arm of `pr_merged` end to end, with a stubbed `bb` and no `gh` on `PATH`? The measured failure is exactly that shape.

## Slices

### Route the lookups (Branch: bug/plot-pr-merged-sh-asks-gh, PR: #2206)

- `bug/plot-pr-merged-sh-asks-gh` — route `_plot_merged_lookup` and `_plot_open_lookup` through `plot-host.sh`, delete the gate exemption, and add a Bitbucket test (stub `bb`, no `gh`) proving a merged branch reads as merged.

## Notes

- Source: tracker issue #2186. Reported 2026-10-20 against ewz-kus-portal.
- Related plans on the same host-routing family: `2026-10-18-bitbucket-jenkins-pr-list-binds-a`, `2026-10-16-bitbucket-parity-and-app-identities`. Overlap in subject only; this plan changes a different script.
- Layering: `check-shell-lines.sh` ratchets shipped shell lines. Deleting the two `gh` calls and the exemption comment shrinks the count.
