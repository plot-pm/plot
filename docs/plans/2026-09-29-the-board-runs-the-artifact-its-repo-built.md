# The board runs the artifact its repo built

> `plot-board-probe.sh` resolves `plugin | npm | checkout` in that order, so a checkout that has the plugin installed never runs its own build. In Plot's own repository `pnpm build:board` writes a file the running board will never read, and the symptom is indistinguishable from the fix not working.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1055
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A checkout that builds the board artifact runs the one it built, not the installed plugin's.

Board impact: this IS the board's startup path. No payload change.

## Motivation

`plot-board-probe.sh:36` states the order:

```
artifact_source  plugin | npm | checkout  (resolved in that order)
```

`checkout` is the LAST fallback (`:265-268`), reached only when no plugin and no npm shim exist. That is correct for an adopting project and backwards for the repository that builds the artifact.

### Measured on this machine, 2026-09-29

```
probe:     artifact_source: plugin
           ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/…/board-server.mjs
checkout:  skills/plot/scripts/board/board-server.mjs   1 198 574 bytes, built from HEAD
running:   node …/marketplaces/plot-marketplace/…/board-server.mjs   ← a THIRD path
```

Three copies, and the running boards hold a fourth state: they were started from `marketplaces/plot-marketplace/`, which **no longer exists on disk** — the directory was removed while they ran, and node had already read the file into memory. So the probe's answer changed under two live boards and nothing reported it.

**The failure mode is what makes this worth fixing.** A developer changes board code, runs `pnpm build:board`, reloads, and sees no change. Nothing is broken, nothing warns, and the artifact on disk is correct. The evidence points at the change rather than at the loader.

### Not hypothetical, and not only this repo

Two boards run here — `:7777` for this checkout, `:7778` for `ewz-kus-portal` — and both resolve through the same plugin path. The adopting project SHOULD get the plugin's copy. This repository should not.

## Design

### The rule

**A repository that builds the board artifact runs the one it built.**

Everything else keeps today's order. The probe is the only place this is decided — `plot-boardctl.sh:351` reads `artifact_source` and obeys it, so a correct probe answer needs no caller change.

### Which test decides "builds the board artifact"

**This is the slice's one real decision, and the plan does not pick for it.** Three candidates, each with a cost:

1. **A `Board artifact` config key.** Explicit, per-repository, follows `Agent registry`'s precedent exactly. Costs a key nobody sets by default, so it fixes nothing until someone reads this plan.
2. **The checkout declares the package.** `packages/board/package.json` naming `@plot-pm/board` is a fact only the repository that builds it has. No configuration, no key to forget.
3. **A newer checkout artifact wins on mtime.** Requires no declaration at all and is the one to reject: a stale build after `git pull` would silently win, which is the same class of quiet-wrong-answer this plan is about.

**The slice picks between 1 and 2 with an argument, and 3 is rejected here.**

### What this does NOT do

- **It does not reorder the probe for adopting projects.** `plugin | npm | checkout` stays for every repository that does not build the artifact.
- **It does not warn about a stale checkout build.** Whether `pnpm build:board` ran is the developer's business; this plan decides *which file* runs, not whether it is fresh.
- **It does not touch `plot-boardctl.sh`'s invocation.** The `case` on `artifact_source` is already right.
- **It does not restart a running board.** An installed board keeps running the code it loaded; the operator restarts it.

## Done when

- **In this repository the probe answers `checkout`**, asserted against a fixture that also has a plugin path available — otherwise the test passes for the wrong reason.
- **In a repository that does NOT build the artifact the probe still answers `plugin`**, asserted, because that is the case this must not break.
- `--dry-run` names the artifact and its source, so an operator can see which copy is about to run without starting one.
- **The choice between the config key and the package declaration is argued in the PR**, with the reason the other was not taken.
- `artifact_source: none` still refuses, unchanged.

## Slices

### The board runs the artifact its repo built (Branch: bug/the-board-runs-the-artifact-its-repo-built)

Pick the test, apply it in the probe, and assert both directions.

## Notes

**The three copies were found while answering an operator's question about isolating two repositories' daemons and boards**, not by anything in Plot. No check compares what the probe resolves against what is running, and the probe's answer changed tonight under two live boards with nothing reporting it.

**Its sibling is `the-board-port-is-configured-not-typed`**, which makes the port survive a restart. Together they are what "two checkouts, two boards" needs; neither depends on the other.

**`#1051` is the third piece**, for the supervisor rather than the board: a label override that reaches the unit. Approved and dispatched 2026-09-29.
