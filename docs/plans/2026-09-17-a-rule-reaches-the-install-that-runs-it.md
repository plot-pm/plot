# A rule reaches the install that runs it

> `--start` imports a TypeScript rule from `packages/domain/src/`, which a plugin install carries and cannot execute, while the built bundles that would work are in no install at all.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #934
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-dispatch.sh --start` works from a plugin installation. It imported a rule as TypeScript source, which only a development checkout can run, and named two preconditions that were both satisfied while the real one went unmentioned.

<!-- Board impact: none directly — the board's own bundles already ship. This is
     about a rule the dispatcher imports. No plan format, no template. -->

## Design

**The failure names two conditions that hold and not the one that fails.**
Reported 2026-09-17 from a plugin install:

```
plot-dispatch: --start could not ask how many agents to start — starting none.
  The rule is file:///…/plot/2.17.0/packages/domain/src/rules/fleet-size.ts
  It needs node 24 and a readable checkout of packages/domain.
```

`node --version` answered `v24.4.1` and the file was present and readable. **All
40 rule sources ship; none of them can be imported**, because they are
TypeScript and the plugin cache has no build.

### The bundles do not exist in git at all

The report supposes `dist/` *"is presumably meant to be tracked and shipped"*.
Measured here:

```
$ git ls-files 'packages/*/dist' | wc -l
0
$ git check-ignore -v packages/domain/dist
(no output — not ignored, simply absent)
```

**So this is not a marketplace path that drops a tracked directory.** The
bundles have never been committed; they exist only in a development checkout
after `pnpm build`.

### The precedent is one directory away and it works

**24 board bundles ARE tracked** under `skills/plot/scripts/board/` — including
`plot-ask.mjs`, `plot-propose-stack.mjs` and `plot-panel.mjs` — and they reach
every install, because a skill's own script directory is what a plugin ships.

`a-shell-script-asks-the-domain` settled that shape: **a bundle under
`skills/plot/scripts/board/` is how a shell script reaches a rule.** `--start`
is the one caller that went a different way and imported the source.

**So the fix is to follow the precedent rather than to ship `dist/`.**
`fleet-size`'s answer joins the bundles that already travel.

### Which bundle, and the cost of a wrong answer

**Not `plot-ask.mjs`.** Its entry answers `board` and `fleet` by RUNNING
`plot-fleet-scan.sh` — 18.3 s — so a dispatcher asking how many agents to start
would start a fleet scan to find out. That reasoning is already recorded for
three other bundles.

**A bundle of its own**, sized like the narrow ones: `plot-propose-stack.mjs` is
1.9 KB against `plot-ask.mjs`'s 491 KB, because it imports no entity schemas.
`fleet-size` reads a machine reading and answers a number.

### What this does not do

**It does not ship `packages/*/dist`.** Committing a build output is a decision
about the repository's shape, and the bundle route already exists and already
works for 24 callers.

**It does not change the rule.** `ceilingFor`, `fleetSize` and their thresholds
are untouched; this changes how a shell script reaches them.

**It does not fix `plot-propose-stack.mjs`'s adoption path**, because that one is
already a tracked bundle — the report names it as *"would fail identically"* and
that is checked and false here.

## Slices

### A rule reaches the install that runs it (Branch: bug/a-rule-reaches-the-install-that-runs-it)

- `bug/a-rule-reaches-the-install-that-runs-it` — build `fleet-size`'s answer into its own tracked bundle under `skills/plot/scripts/board/`, have `--start` ask that bundle, and make the refusal name the condition that actually failed

**Done when** `--start` answers from a tree carrying **no** `packages/domain/`
at all, pinned by running it against a copy with that directory removed — the
condition a plugin install is in; the bundle is **tracked in git**, asserted by
`git ls-files`; it is under 50 KB, since `fleet-size` imports no entity schema
and a 491 KB answer would say the wrong import path was taken; the number
`--start` produces is **identical** to today's for the same machine reading,
pinned by comparing both paths on one reading rather than by asserting a
constant; a refusal names the condition that failed rather than two that hold,
pinned by asserting the message text for a missing bundle and for a wrong node
major separately; `--start` in a development checkout behaves byte-identically;
and `pnpm run test:contracts` and `pnpm run test:board` pass.

## Notes

**Reported 2026-09-17 from a plugin install that could start no agents.**

**Two of the report's readings are corrected above rather than carried.** `dist/`
is not tracked and not ignored — it has never been committed — and
`plot-propose-stack.mjs` is a tracked bundle that reaches a plugin install
today.

**The message is half the defect.** *"It needs node 24 and a readable checkout"*
sent an operator to verify two things that were already true. A refusal that
names the wrong condition costs more than one that says nothing, because it
looks actionable.
