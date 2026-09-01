## Implementation brief — a-machine-is-an-instance (slice: Correcting)

- **Plan (canonical):** `docs/plans/2026-08-30-a-machine-is-an-instance.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `docs/a-machine-has-an-identity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

Sole slice. Nothing waits on it inside its own plan, but `the-pulse-is-an-entity` was the plan
this was cut from, and it asserts *"one pulse per machine"* — a claim that only means something
once "machine" is defined. Landing this first is what makes the pulse plan reviewable.

### What to build

**A documentation correction, and it must stay one.** `DESIGN-machine.md` currently claims a
Machine has no identity *"because there is exactly one"*, and calls that singularity
load-bearing in §8: *"if there were two, headroom would be a property of a pair and the whole
entity would need a key."*

The working environment already satisfies that condition.

### The decisions the plan settles — do not re-derive them

**The measurement, re-verified 2026-09-01 before approval:**

```
Agentic-Tools/plot          Plot Config: yes   .plot/: yes   fleet-controls.json: yes
Agentic-Tools/agent-skills  Plot Config: yes   .plot/: yes   fleet-controls.json: no
EKZ.Webportal/ekzweb        Plot Config: yes   .plot/: yes   fleet-controls.json: no
hostname: ani  — the same string for all three
```

Three Plot instances, three boards, three fleets, one laptop. **So the case §8 calls
hypothetical is the working environment**, and the spec's own sentence names the consequence.

**The key already exists and is already correct.** `packages/board/src/server/fleet.ts:645`:

```ts
function cacheKey(opts: BuildBoardOptions): string {
  return `${opts.repoRoot}\0${opts.scriptsDir}`;
}
```

Every cache — every pulse, every PR timer, every estate — is already keyed per instance. **The
code was never wrong; the spec was.** That is the whole shape of this slice, and it is why
nothing under `packages/domain` changes.

**Two entities where the spec has one:**

| | **Machine** (instance) | **Computer** (hardware) |
|---|---|---|
| identified by | `hostname` + short id from `repoRoot + scriptsDir` | `hostname()` |
| how many | one per Plot project | one |
| owns | its pulse, its fleet, its estate, its divisors | `spawnCostMs`, `loadAverage`, `cores` |
| answers | *whose clock is this?* | *can anything fork cheaply right now?* |

Three instances measuring one spawn cost is **correct, not duplication** — three tenants
reading one landlord's meter.

**`parallelAgents` is a claimed share, not a wanted count.** The same number, a different
question. And an **unset share is still a share**: two of the three instances have never written
`fleet-controls.json`, so they run on config-seeded defaults (`fleet-settings.ts:137`) — the
share is *implicit* for them, not merely unreported.

**Do not write "three at 11 is 33."** That sum was in an earlier draft and was removed: nobody
ever set it. What is true is that nothing reports the total and two instances have never
declared one.

**Rejected, with its reason: renaming `Machine` to `Instance`.** The word appears in
`DESIGN-agent.md`, `DESIGN-worktree.md`, `ports/machine.ts`, `entities/machine.ts`, its adapter
and its tests. A rename is a large diff that changes no meaning — and the meaning was never
wrong, only the count.

### Done when

The plan's five numbered items are the specification:

1. `DESIGN-machine.md` no longer claims a Machine has no identity.
2. The key is named, **and `hostname()`'s inadequacy is stated** — including the worktree case
   that rules out a basename. (Two worktrees of one repo share a basename; they are not two
   machines, and a basename key would say they were.)
3. Hardware-level and instance-level readings are separated in the fields table.
4. The shared-cap question is **recorded as a known blind spot, not solved.** Resist writing a
   scheduler into a docs plan — the plan argues the problem dissolves: a machine declares a
   share rather than negotiating one, and the sum is the operator's to keep sensible.
5. `pnpm test` green — a docs change should touch nothing else.

**If the correction implies a code change, that is a finding for the PR body, not a commit.**
The spec is what was wrong.

Plus the repo gates: a changeset (`'plot': patch`, description first, `bumps:` block last).
`pnpm run typecheck` and `pnpm build:board` should be no-ops here; if either produces a diff,
something outside scope was touched.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim and the whole
  locking mechanism.
- When the PR exists, append `→ #<number>` to the branch line. **This plan uses the bullet
  form** under `## Slices`, so the trailing arrow is correct here — unlike
  `production-calls-the-domain-one-rule-at-a-time`, which carries the PR inside its `### `
  heading.
- **Never begin a line with a backticked branch name** inside a Branches/Slices section: the
  loose matcher reads it as a claim, the anchored one does not, and `parser.test.mjs`'s
  estate-wide differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-machine.md`, and a
changeset.

**It does not own** `packages/domain/**` — stated by the plan, and it is the line that keeps
this slice a docs change. `DESIGN-agent.md` and `DESIGN-worktree.md` also say `Machine`; leave
them, since the rename was rejected.

**In flight elsewhere, 2026-09-01:** `feature/the-refusals-are-domain-rules` (claimed 12:19,
`plot-dispatch.sh` + a new domain rule) and `infra/the-agents-tab-tests-serve-their-own-state`
(#591, board browser tests). Neither touches `docs/stories/`.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
