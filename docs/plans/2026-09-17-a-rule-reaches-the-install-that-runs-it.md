# A rule reaches the install that runs it

> `--start` imports a rule whose dependency chain reaches `zod`, which a plugin install cannot resolve — and the refusal names node and readability, two conditions that hold.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #934
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-17, jwloka, in-session

## Changelog

- `plot-dispatch.sh --start` works from a plugin installation. The rule it imports reaches `zod` through its type imports, which a cache with no `node_modules` cannot resolve, and the refusal named two conditions that were both satisfied.

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

`node --version` answered `v24.4.1` and the file was present and readable.

**The TypeScript is not the problem, and an earlier draft of this plan said it
was.** Node 24 strips types, and the rule imports cleanly from a development
checkout — measured:

```
$ node -e "await import('…/packages/domain/src/rules/fleet-size.ts')"
imported, exports: DEFAULT_FLEET_SIZE,ceilingFor,fleetSize
```

**The failing import is the SECOND one, and the rule is not it.**
`plot-dispatch.sh:1931` imports two modules, and only the first is the rule:

```sh
PLOT_RULE="file://$start_domain/rules/fleet-size.ts"
PLOT_MACHINE="file://$start_domain/entities/machine.ts"
```

`fleet-size.ts` imports one thing and it is `import type` — erased entirely by
type stripping, so it has **no runtime dependency at all**. `machine.ts` opens
with `import { z } from 'zod'`.

Reproduced by copying the sources to a directory with no `node_modules` on the
resolution path:

```
machine.ts FAILED: Cannot find package 'zod'
fleet-size.ts: imported
```

**So the population is one module, not forty.** Measured on this estate: 43 rule
sources, of which **4** import `zod` — and `fleet-size` is not among them. Two
earlier drafts of this paragraph blamed the TypeScript and then the rule's own
chain; **both were wrong, and running the import is what settled it.**

### The bundles do not exist in git at all

The report supposes `dist/` *"is presumably meant to be tracked and shipped"*.
Measured here:

```
$ git ls-files 'packages/*/dist' | wc -l
0
```

**Not tracked. `packages/domain/dist` is not ignored either — it has simply
never been committed**; `packages/board/.gitignore:2` does ignore its own, which
is a difference worth stating rather than generalising over.

### What a plugin install carries is not constant

The report's install (2.17.0) carried `packages/domain/src/` — all 43 rules,
readable. **The cache on this machine carries version 2.8.0 and has no
`packages/domain/` at all:**

```
$ ls …/plot-marketplace/plot/2.8.0/packages/domain/src/rules/fleet-size.ts
ABSENT
```

**So there are two failures wearing one message**: an install that carries the
rule and cannot resolve its dependency, and an install that does not carry the
rule. A refusal naming *"a readable checkout of packages/domain"* is wrong for
the first and right for the second, which is why it has to say which.

### The precedent is one directory away and it works

**24 board bundles ARE tracked** under `skills/plot/scripts/board/` — including
`plot-ask.mjs`, `plot-propose-stack.mjs` and `plot-panel.mjs` — and they reach
every install, because a skill's own script directory is what a plugin ships.

`a-shell-script-asks-the-domain` settled that shape: **a bundle under
`skills/plot/scripts/board/` is how a shell script reaches a rule.**

**Three scripts went the other way, not one** — `plot-dispatch.sh`,
`plot-reap.sh` and `plot-release-refs.sh` each import a rule as a `file://`
source. An earlier draft named only the first. **The other two import rules that
reach no `zod`**, which is why they work today and why they are named here
rather than fixed: a source import that resolves is not this plan's defect, and
a sweep over all three would widen a narrow fix on a guess about the future.

**So the fix is to follow the precedent rather than to ship `dist/`.**
`fleet-size`'s answer joins the bundles that already travel.

### Which bundle, and the cost of a wrong answer

**Not `plot-ask.mjs`.** Its entry answers `board` and `fleet` by RUNNING
`plot-fleet-scan.sh` — 18.3 s — so a dispatcher asking how many agents to start
would start a fleet scan to find out. That reasoning is already recorded for
three other bundles.

**A bundle of its own**, sized like the narrow ones: `plot-propose-stack.mjs` is
1.9 KB against `plot-ask.mjs`'s 491 KB, because it imports no entity schemas.

**And it must carry `headroomFor` as well as `fleetSize`**, since those are the
two things `--start` asks for and the second is what fails. A bundle of the rule
alone would fix nothing.

**`zod` is bundled with it rather than resolved at run time** — which is what
every one of the 24 tracked bundles already does, and why they work in a cache
with no `node_modules`.

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
