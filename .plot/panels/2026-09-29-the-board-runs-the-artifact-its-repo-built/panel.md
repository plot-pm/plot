# Panel — the board runs the artifact its repo built (#1055)

Subject: `docs/plans/2026-09-29-the-board-runs-the-artifact-its-repo-built.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

## The premise survived, and was reproduced rather than accepted

`plot-board-probe.sh:36` documents `plugin | npm | checkout` and `:265-268` is the checkout fallback — **both line numbers verified**. The juror isolated the mechanism with a fixture: the same repository answers `checkout` or `plugin` depending only on whether a plugin root exists.

```
PLOT_PLUGIN_ROOT=/nonexistent  →  artifact_source: checkout
PLOT_PLUGIN_ROOT=~/.claude/…   →  artifact_source: plugin
```

**The order alone causes it** — no missing directory required. And `plot-boardctl.sh` really does just obey: `:328` reads, `:333` refuses on `none`, `:351` branches. Every other mention on the estate is prose. No second decision exists.

## THE FINDING — the test the plan leaned toward misfires on three populations

The plan called `packages/board/package.json` naming `@plot-pm/board` *"a fact only the repository that builds it has"*. **False, measured three ways and confirmed by the moderator:**

- **The plugin ships `packages/`.** `~/.claude/plugins/marketplaces/plot-marketplace/packages/board/package.json` exists. The marker describes Plot's source layout, which the plugin distributes.
- **A vendoring repo or fork carries it for free** and would then run an artifact it never built.
- **Every dispatch desk satisfies it.** Five trees on this machine carry the marker, and their artifacts already disagree — a scratch desk holds `23eb76a3` against the checkout's `c0bff96a`.

**So a worker's desk would run a different board than the main checkout** — the exact quiet-wrong-answer the plan rejects candidate 3 for, arriving through a different door. The plan never considered a worktree.

**Candidate 1 survives all three**, and the juror named the property that decides it: a `Board artifact` key lives in the shared tracked file, so **every worktree inherits it and a desk agrees with main by construction**. The plan's objection — *"a key nobody sets by default"* — is weak here, where `Agent registry` set the precedent and this repository dog-foods its own config.

## Two further corrections

**The outage was a different defect.** The plan cited tonight's `exit 127` as motivation. The marketplace tree is **present again**, rebuilt 12:45, carrying `plot-host.sh` — so that was a deleted-and-restored tree, and reordering would not have prevented it. A missing tree and a present-but-wrong tree are two problems.

**The symptom is latent, not live.** The probe's answer is **byte-identical** to the checkout build (separate inodes, a synced copy). So *"`pnpm build:board` writes a file the running board will never read"* is not currently reproducible through the probe. The divergent copy is `cache/2.21.0`, which the probe deliberately does not select (`:239-241`) — *a running board versus the probe* is a real second question and not this plan's.

What the ordering guarantees is that **nothing keeps them in sync**. That is a sufficient motivation without overclaiming.

## Already shipped

`--dry-run` naming the artifact and its source is `plot-boardctl.sh:357-359` on `main`. Keeping it in `Done when` made the slice look larger and invited a re-implementation. Removed.

## An undeclared edit the plan owed

`scripts/check-bundle-resolution.sh:30-37` exempts the probe **on the stated assumption** that the checkout path is reached only after plugin and npm are absent. Changing the order keeps the gate passing and makes its reasoning false. Now in `Done when`.

## Amendments folded in

1. The fixture reproduction, replacing the three-copies table.
2. The outage split out as a different defect.
3. The symptom restated as latent, with the `cache/2.21.0` question named and excluded.
4. Candidate 2 rejected with its three measurements; candidate 1 chosen, with the worktree-inheritance argument.
5. `Done when` gains the desk assertion and the gate-comment edit, and loses the shipped `--dry-run` item.
