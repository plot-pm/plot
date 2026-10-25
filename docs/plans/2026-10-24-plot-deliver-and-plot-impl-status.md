# plot-deliver and plot-impl-status resolve a PR on the host its reference names

> `plot-deliver.sh` and `plot-impl-status.sh` send every `→ owner/repo#N` reference to the plan repository's git host, so a plan on Bitbucket with merged GitHub implementation PRs reads as unmerged.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2158
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2489 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/plot-deliver-and-plot-impl-status-repro`
- **Started:** 2026-10-25, Jan Wloka, `bug/plot-deliver-and-plot-impl-status`

## Changelog

- A split-home plan whose implementation repository sits on a different git host than the plan repository delivers: `plot-impl-status.sh`, `plot-deliver.sh` and the reconcile scan resolve each cross-repo `owner/repo#N` reference through the host that repository lives on.

<!-- Board impact: none expected. The slice-line reference syntax stays readable by the board's parser if option 2 is not chosen; if a `host:` prefix is added, the board's reference parsing needs a check. No plan template or layout change. -->

## Motivation

Reported in #2158 on Plot 2.26.0. A plan lives in a Bitbucket repository (`pr_source=bb`), declares `Impl: other repo`, and its slice lines carry `→ owner/repo#N` references to merged PRs in a GitHub repository.

- `plot-impl-status.sh <slug>` prints `{"prs": []}`.
- `plot-deliver.sh <slug>` refuses with `cannot deliver: 2 branch(es) not merged`.

`plot-impl-status.sh:320` resolves a cross-repo reference with `plot-host.sh pr-state "$NUM" --repo "$REPO"`. `plot-host.sh` selects one backend per checkout (`$PLOT_HOST`, else the `Git host` key), and `--repo` only passes `-R <repo>` to the `gh` arm or the repository argument to the `bb` arm. On a Bitbucket checkout the GitHub reference therefore goes to `bb`, which finds no such PR, and the call degrades to `state NONE`.

`/plot-deliver` step 4 states that split-home references resolve "in that repo via the host adapter". That holds only while both repositories share a host. The workaround in the issue is a hand edit of `State:`, which bypasses the script that owns the line.

## Design

### Approach

Choose the host per reference instead of per plan repository. Two options from the issue:

1. A `## Plot Config` key mapping implementation repositories to hosts, for example `Impl hosts: owner/repo = github`.
2. An explicit host prefix on the reference, for example `→ github:owner/repo#N`.

Trade-offs to settle in review:

- A config key keeps slice lines unchanged and matches how `Implementation home` already names repositories. It needs a new key and a lookup in `plot-host.sh`.
- A prefix is local to the line and visible to the reader. It changes the reference grammar that `plot-impl-status.sh`, `plot-deliver.sh`, the reconcile scan and the board parser all read.
- The per-reference backend choice lives in the `host` port's adapter, `hostShell` in `packages/domain/src/adapters/host/host-shell.ts`, not in each caller. For a `--repo` reference, `prState` and `prMerged` ask the checkout's own backend first and, on a clean miss only, the other drivable backend once. The decision is the domain rule `rules/cross-repo-probe.ts`. `plot-host.sh` stays the one place that talks to a host CLI (`scripts/check-host-cli-callers.sh`) and holds only the switch: `PLOT_HOST_OTHER=1` selects the `HOST_DRIVES` entry that is not the checkout's own. `plot-impl-status.sh` asks `board/plot-pr-state.mjs` for a cross-repo reference, and `deliverability.ts` reads the references from the plan text through `rules/cross-repo-reference.ts`.
- A reference with no mapping or prefix keeps today's behaviour: the plan repository's host.
- A reference whose host CLI is missing or unauthenticated reports `unknown`, not `not merged`. The same rule as *An unasked host is not an absent PR* applies.

### Open Questions

- [ ] Config key or reference prefix, or both?
- [ ] Which callers read cross-repo references today? Known: `plot-impl-status.sh`, `plot-deliver.sh`, the reconcile scan (step 7b), and the domain's delivery gate. This list is unverified.
- [ ] Does the `host.ts` port (`HostBackend = string`) take a per-call backend, or does the adapter pick it from the repository argument?
- [ ] Does the fleet's PR index key its rows by repository and backend?

## Slices

### Reproduction

- `bug/plot-deliver-and-plot-impl-status-repro` — a failing test: a Bitbucket plan repository with a cross-repo GitHub reference, host CLIs stubbed, asserting `plot-impl-status.sh` lists the PR and `plot-deliver.sh` accepts it → #2552

### Resolution

- `bug/plot-deliver-and-plot-impl-status` — per-reference host selection in `plot-host.sh` and the callers, per the option chosen in review → #2663

## Notes

- Drafted from #2158 by `/plot-idea`, unattended. Review channel `pr` and `Impl: own branches` follow from `Plan PRs: required`. No Design answer was given, so the plan starts in Draft.
