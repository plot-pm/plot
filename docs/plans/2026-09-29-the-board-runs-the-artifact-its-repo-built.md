# The board runs the artifact its repo built

> `plot-board-probe.sh` resolves `plugin | npm | checkout` in that order, so a checkout that has the plugin installed never runs its own build. In Plot's own repository `pnpm build:board` writes a file the running board will never read, and the symptom is indistinguishable from the fix not working.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1055
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- A checkout that builds the board artifact runs the one it built, not the installed plugin's.

Board impact: this IS the board's startup path. No payload change.

## Motivation

`plot-board-probe.sh:36` states the order:

```
artifact_source  plugin | npm | checkout  (resolved in that order)
```

`checkout` is the LAST fallback (`:265-268`), reached only when no plugin and no npm shim exist. That is correct for an adopting project and backwards for the repository that builds the artifact.

### Measured on this machine, 2026-09-29 — and the order alone causes it

The probe answers `plugin` here. Isolated with a fixture, the **same repository** answers both ways depending only on whether a plugin root exists:

```
PLOT_PLUGIN_ROOT=/nonexistent  →  artifact_source: checkout
PLOT_PLUGIN_ROOT=~/.claude/…   →  artifact_source: plugin
```

Same repo, same artifact on disk, shadowed purely by resolution order. **The mechanism is real and does not depend on any tree being missing.**

### The symptom is latent here, not live

An earlier draft claimed three divergent copies. Measured properly:

```
c0bff96ac2b5b4e6  skills/plot/scripts/board/board-server.mjs          (checkout, HEAD)
c0bff96ac2b5b4e6  …/marketplaces/plot-marketplace/…/board-server.mjs  (the probe's answer)
23eb76a3bbdfc1c0  …/cache/plot-marketplace/plot/2.21.0/…             (one live board)
```

**The probe's answer is byte-identical to the checkout build** — separate inodes, a copy kept in sync rather than a symlink. So *"`pnpm build:board` writes a file the running board will never read"* is **not currently reproducible through the probe**, and this plan must not claim it is.

What the ordering guarantees is that **nothing keeps them in sync**. The day the plugin copy lags, the developer gets a silent wrong answer with no warning and evidence pointing at their change rather than at the loader. That is the defect: a latent shadowing, not a live divergence.

**The divergent copy belongs to a different gap.** `cache/2.21.0` is what one running board loaded, and the probe deliberately does not select it (`:239-241`). *A running board versus the probe* is a real second question and is **not this plan's.**

### Tonight's outage was a DIFFERENT defect

An earlier draft cited an `exit 127` (`plot-host.sh: No such file or directory`) as motivation. That was a board running from a tree that was deleted **and has since been restored** — verified, the marketplace tree is present again, rebuilt 12:45, and carries `plot-host.sh`.

**A missing tree and a present-but-wrong tree are two defects, and reordering would not have prevented the outage.** The plan stands without it.

### Not only this repo

Two boards run here — `:7777` for this checkout, `:7778` for `ewz-kus-portal` — and both resolve through the same plugin path. The adopting project SHOULD get the plugin's copy. This repository should not.

## Design

### The rule

**A repository that builds the board artifact runs the one it built.**

Everything else keeps today's order. The probe is the only place this is decided — `plot-boardctl.sh:351` reads `artifact_source` and obeys it, so a correct probe answer needs no caller change.

### Which test decides "builds the board artifact"

**The plan picks candidate 1, because 2 and 3 were measured and both misfire.**

**Candidate 1 — a `Board artifact` config key.** Explicit, per-repository, follows `Agent registry`'s precedent, which this repository already dog-foods in its own `## Plot Config`. **A key set once in the hub doc is inherited by every worktree**, because worktrees share the tracked file — so a desk and the main checkout agree by construction. That is the property neither alternative has.

**Candidate 2 — `packages/board/package.json` names `@plot-pm/board` — is FALSE and rejected.** An earlier draft called it *"a fact only the repository that builds it has"*. Measured three ways:

- **The plugin ships `packages/`.** `~/.claude/plugins/marketplaces/plot-marketplace/packages/board/package.json` exists. The marker is a fact about *Plot's source layout*, which the plugin distributes — not about building.
- **A vendoring repo or a fork carries it for free**, then answers `checkout` and runs whatever artifact sits in its tree, including one it never built.
- **EVERY DISPATCH DESK SATISFIES IT.** A desk is a full worktree. Measured, five trees carry the marker and their artifacts already disagree — one scratch desk holds `23eb76a3` against the checkout's `c0bff96a`.

**So under candidate 2 a worker's desk would run a different board than the main checkout.** That is the quiet-wrong-answer this plan rejects candidate 3 for, reproduced through a different door.

**Candidate 3 — newest artifact wins on mtime — stays rejected**: a stale build after `git pull` would silently win.

**And the scope exclusion below becomes the defect under candidate 2.** *"It does not warn about a stale checkout build"* reads as a boundary; the moment the probe *prefers* a possibly-stale copy in ten trees nobody builds in, staleness stops being the developer's business.

### What this does NOT do

- **It does not reorder the probe for adopting projects.** `plugin | npm | checkout` stays for every repository that does not build the artifact.
- **It does not warn about a stale checkout build.** Whether `pnpm build:board` ran is the developer's business; this plan decides *which file* runs, not whether it is fresh.
- **It does not touch `plot-boardctl.sh`'s invocation.** The `case` on `artifact_source` is already right.
- **It does not restart a running board.** An installed board keeps running the code it loaded; the operator restarts it.

## Done when

- **With `Board artifact` declared, the probe answers it**, asserted against a fixture that also has a plugin path available — otherwise the test passes for the wrong reason.
- **With no key declared the probe still answers `plugin`**, asserted. That is the adopting project's case and it must not change.
- **A DISPATCH DESK RESOLVES THE SAME ARTIFACT AS THE MAIN CHECKOUT**, asserted in a real worktree. Five trees on this machine carry `packages/board/package.json` and their artifacts already disagree; a key in the shared tracked file is what makes them agree.
- `artifact_source: none` still refuses, unchanged.
- **`scripts/check-bundle-resolution.sh:30-37`'s exception text is updated.** It exempts the probe *on the stated assumption that the checkout path is reached only after plugin and npm are absent*. The gate keeps passing, but that reasoning stops being true — an undeclared edit is how a comment becomes a lie.

**Removed from an earlier draft:** *"`--dry-run` names the artifact and its source"* — already shipped at `plot-boardctl.sh:357-359`, verified. Leaving it made the slice look larger and invited a re-implementation.

## Slices

### The board runs the artifact its repo built (Branch: bug/the-board-runs-the-artifact-its-repo-built)

Pick the test, apply it in the probe, and assert both directions.

## Notes

**The three copies were found while answering an operator's question about isolating two repositories' daemons and boards**, not by anything in Plot. No check compares what the probe resolves against what is running, and the probe's answer changed tonight under two live boards with nothing reporting it.

**Its sibling is `the-board-port-is-configured-not-typed`**, which makes the port survive a restart. Together they are what "two checkouts, two boards" needs; neither depends on the other.

**`#1051` is the third piece**, for the supervisor rather than the board: a label override that reaches the unit. Approved and dispatched 2026-09-29.


### Round 1, 2026-09-29

One juror, **amend**, **executed**. Moderation: `.plot/panels/2026-09-29-the-board-runs-the-artifact-its-repo-built/panel.md`.

The premise survived and was reproduced with a fixture: the same repository answers `checkout` or `plugin` depending only on whether a plugin root exists. `plot-boardctl.sh` really does just obey the probe, and no second consumer exists.

**Three corrections, and the third changes the fix:**

1. **Tonight's `exit 127` was a different defect** — a deleted tree, since restored. Reordering would not have prevented it.
2. **The probe's answer is byte-identical to the checkout build**, so the headline symptom is latent rather than live. The divergent copy is `cache/2.21.0`, which the probe does not select — *a running board versus the probe* is a separate question.
3. **Candidate 2 misfires on three populations**, including every dispatch desk, and the plan had leaned toward it. Candidate 1 was chosen instead, for the property the juror named: a key in the shared tracked file is inherited by every worktree, so a desk and main agree by construction.

One `Done when` item was already shipped and has been removed.
