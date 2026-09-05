## Implementation brief — a-merge-is-a-domain-question (slice: Answering the merge question)

- **Plan (canonical):** `docs/plans/2026-09-04-every-element-is-a-domain-concept.md` on `main`
- **Branch:** `feature/a-merge-is-a-domain-question` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of six, and it gates the other five.

## What this delivers

`pr_merged` and `pr_open` — today in `skills/plot/scripts/plot-pr-merged.sh` — become domain rules behind a bundle. **The shell functions survive; only their bodies move**, so every sourcing caller is untouched.

## The reasoning IS the deliverable

This slice moves 90 lines of shell, of which about 55 are the argument for why the code is shaped as it is. That argument is what must survive the move, and it is the reason this is a domain rule rather than a script that got tidied.

**An unreachable host answers *not merged*.** A missing `gh`, an unauthed one, a network failure — all return 1, so every caller KEEPS what it was considering removing. *Silence is never permission.*

**`pr_open` can only ever keep a ref, never release one.** It fails in the SAME direction as `pr_merged` — an unreachable host returns 1 — but with the OPPOSITE effect, because this answer vetoes a deletion. So its failure direction is safe **only because `pr_merged` already refused on the same silence**. Neither function is safe alone; the pair is. That coupling is the single most important thing to preserve, and it is exactly the kind of property a test can hold and a comment cannot.

**`mergedAt` is read, never `state`.** A merged PR reports `CLOSED`. Trusting `state` would refuse every squash-merged branch, which is the whole population these scripts exist for.

**And never ancestry.** Squash-merge rewrites the commits, so a merged branch stays ahead of the default branch forever. Measured 2026-09-04: ancestry disagreed with the host on **ten of ten** merged branches on this estate.

**The question is "ANY PR", not "the newest".** This asked with `--limit 1` until 2026-08-27. Measured that day:

```
an-unreachable-host-says-so         newest #473 null → real merge #446
the-scan-sees-a-stale-sprint-tally  newest #464 null → real merge #463
a-plan-cites-a-jira-key             newest #476 null → real merge #447
```

The masking PRs were ones the fleet opened itself on already-merged waves, which closes a loop: a leftover worktree lets auto-dispatch adopt a merged branch, its worker opens a duplicate, the duplicate is newer, the reaper keeps the worktree — the input to step one.

**`--limit 100` rather than unbounded** because `gh` has no *all* sentinel. A branch with more than 100 PRs whose only merge is the oldest would still be missed — a far narrower window than *any duplicate at all*, and it fails SAFE, toward keeping.

## The two assertions the plan names

**1. A host that cannot be asked deletes nothing.** Both functions' failure paths, and the coupling between them, asserted rather than commented.

**2. The rule answers without `gh`.** A domain rule takes readings as values and performs no I/O — that is what makes the first assertion testable without a network.

## The callers — four, not ten

The plan says ten sourcing callers. **Verified 2026-09-05: there are four.**

```
skills/plot/scripts/plot-reap.sh:170
skills/plot/scripts/plot-release-refs.sh:84
skills/plot/scripts/plot-dispatch.sh:152
skills/plot/scripts/plot-quiet-stretch.sh:149     (guarded: 2>/dev/null || true)
```

The other mentions are comments citing the file's reasoning — `plot-host.sh`, `plot-agent-monitor.sh`, `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`, `plot-budget.sh`, `plot-monitor-subject.sh`, and four TypeScript files. Those need no change and should not be touched.

**`plot-quiet-stretch.sh:149` sources it guarded** and calls it behind `command -v pr_merged`. Whatever replaces the body must keep that tolerable — it is a script that works when the helper is absent.

**Why the pair must never disagree**, which is why they were extracted in the first place: `plot-reap.sh` removes a checkout, re-creatable with `git worktree add`. `plot-release-refs.sh` deletes a remote ref, which is **not re-creatable at all**. A second implementation drifting toward permissive would fail in the direction that cannot be undone.

## Shape

**Readings as values.** `rules/quiet.ts:36` already documents this exact answer as a passed-in reading:

> Whether the host merged a PR is `plot-pr-merged.sh`'s answer passed in — never `git merge-base`.

So the rule receives what the host said and decides; an adapter does the asking. Keep the layering: `controller → domain → port ← adapter → script`, dependency pointing inward.

**The bundle.** `plot-approve.sh:474` pipes JSON into `board/plot-transition.mjs` and reads the answer back — nine such bundles exist under `skills/plot/scripts/board/`. That is the precedent for reaching a domain rule from shell.

**`Host` is a connector**, the one adapter kind that reaches a remote service with an account and a rate limit. `ports/host.ts:140` already declares `prState`.

**A note on a caveat that has since been fixed.** `CLAUDE.md` records `HostBackend` as a closed vendor list — `'github' | 'bitbucket'` — in the domain, and calls the adapter-only property a target rather than the current state. Verified 2026-09-05: `ports/host.ts:17` now reads `export type HostBackend = string;`. The caveat is stale and the port no longer names vendors. Do not re-narrow it.

**Arrow functions**, purity gate holds, TSDoc says what an export does and not why it was decided. The measurements above belong in the commit message and this brief, where `git log -S` finds them.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

`scripts/check-ancestry-decisions.sh` is a live gate: every ancestry call declares its kind within five lines above it. If this branch touches a call site, the declaration goes with it.

## Done when

- `pr_merged` and `pr_open` keep their names and signatures; all four sourcing callers are unchanged
- the rule answers with no `gh` present, asserted by a test
- an unreachable host is asserted to delete nothing — the coupling between the two failure directions is a test, not a comment
- `mergedAt` is still what is read, across ANY PR, not the newest
- `plot-quiet-stretch.sh` still works with the helper absent
- the gates above pass

## Do not

- **Do not make `pr_open` safe on its own.** Its safety comes from `pr_merged` refusing on the same silence. Changing that coupling without changing both is the failure this file exists to prevent.
- **Do not read `state` or ancestry.** Ten of ten, measured.
- **Do not narrow to the newest PR.** Three named branches, measured.
- **Do not touch the ten files that only cite this one in comments.**
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
