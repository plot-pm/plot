# A branch state is derived once

> Three domain rules read `BranchState` and none produces one. The eight states are decided in four places across a 4,008-line shell script — a git reading, a prerequisite judgement, a plan statement — and merged by an `if` in a loop.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- Plot derives a branch's state in one place, so the answer the fleet acts on and the answer the board renders cannot differ.

Board impact: yes. The board reads `state` from the pulse and groups every section by it. The wire shape does not change; what changes is who computed it.

## Motivation

**Three domain rules consume `BranchState`. None produces one.**
`rules/eligible.ts:122`, `rules/waiting.ts:14` and `rules/verdict.ts:41` all take
a `state` and judge it — `waiting.ts` even groups them, `SETTLED = ['merged',
'deferred']` and `TAKEN = ['claimed', 'wip']`. The domain reasons about branch
states carefully. It just cannot say what state a branch is in.

That answer lives in `plot-fleet-scan.sh`, 4,008 lines, and it is not one
function.

### Eight states, four deciders

| state | decided by | where |
|---|---|---|
| `open`, `wip`, `merged` | git archaeology | `branch_state()`, `:3007`, **183 lines** |
| `claimed` | a claim ref | an early return inside the same function, `:3086` |
| `waiting`, `blocked` | the prerequisite's own state | `waits_state()`, `:1132` |
| `deferred` | **the plan's annotation** | the caller, `:3411` |
| `unknown` | a reading that failed | scattered |

**The last row is the structural fact.** `:3411` reads

```
if [ "$deferred" = "true" ]; then st="deferred"; else st=$(branch_state "$br"); fi
```

so `deferred` is a **statement by the plan** that overrides everything git says,
applied at the *call site* rather than inside the derivation. A branch can be
merged in git and deferred in the plan; the estate carries **33** such
annotations today — 29 `deferred:`, 3 `moved:`, 1 `split-from:`.

So `BranchState` is not one derivation with eight outcomes. It is three
different kinds of answer — an observation, a judgement about a prerequisite,
and a declaration — merged by an `if` nobody can test.

### What that costs

**The merge point is where the disagreement lives, and it has no name.** Whether
a plan's `deferred:` outranks a merged ref is a real decision. It is currently
expressed as operator precedence in a shell conditional, and a second reader
implementing the same precedence differently would not be caught by anything.

**And it is asked constantly.** The scan runs on the board's timer and per
`--next`; `branch_state` is called once per branch per run.

## Design

### Approach

**One derivation in the domain, taking readings as values.** `branchState(readings)`
in `packages/domain/src/rules/`, beside the three rules that already consume its
output — `reap(readings, input)` is the shape (`rules/reapable.ts`), so nothing
awaits and nothing spawns. The scan reads git, the claim ref and the plan
annotation; the rule decides.

**The precedence becomes a stated rule with a test per case.** Plan statement
over git observation, prerequisite over both, `unknown` where a reading is
missing — each one an assertion, rather than the order of branches in an `if`.

**The scan calls it through a bundle, as it already does twice.**
`plot-fleet-scan.sh:3499` and `:3846` pipe readings into `plot-verdicts.mjs`
today. This is a third call at the same call site, not a new mechanism.

### Not chosen: moving `branch_state`'s git archaeology

Its 183 lines are `git log` and `git for-each-ref` reading — an **adapter**, and
it stays in shell where the process is. What moves is the *decision* about what
the readings mean, which is the split `CLAUDE.md` already draws: scripts collect
and report, the domain interprets.

### Not chosen: waiting for the ratchet

`a-lifecycle-is-enforced-by-a-test` adds a gate that makes every enum declare its
kind, and the honest reason to wait would be that this plan is guessing.
It is not: `BranchState` has three consumers in the domain and no producer there,
which is measured rather than classified. The ratchet decides which of the
*other* 30 enums earn rules; this one is already answered.

### Open Questions

- [ ] **Is `deferred` a branch state at all?** It is the plan's statement about a
      slice, not a fact about a ref. It may belong on the Slice — which
      `every-element-is-a-domain-concept` is giving a type — leaving `BranchState`
      to describe only what git can see.
- [ ] **Does `unknown` survive?** Three of the eight states are absences
      (`unknown`, and the two prerequisite states where the prerequisite cannot
      be read). A rule taking readings as values can distinguish *not read* from
      *read as nothing*, which the current shell cannot.

## Branches

### Deciding in one place

- `feature/a-branch-state-is-one-rule` — `branchState(readings)` in the domain,
  with the precedence stated and a test per case: a plan's `deferred:` over a
  merged ref, a prerequisite's state over both, and `unknown` where a reading is
  absent rather than empty. **Asserted: the three existing consumers
  (`eligible.ts`, `waiting.ts`, `verdict.ts`) are unchanged** — they already take
  a `BranchState`, so a correct derivation needs no edit to any of them, and an
  edit would mean the shape was wrong.

### Asking it from the scan

- `feature/the-scan-asks-for-the-state` — `plot-fleet-scan.sh` reads git, the
  claim ref and the plan annotation, and pipes them to the rule through a bundle
  at the call site that already does this twice. `branch_state()`'s git
  archaeology stays; the `if` at `:3411` goes. **Asserted: the scan's `--json`
  output is byte-identical across the whole estate** before and after — the same
  differential sweep the parser change used, and the only proof that a
  reimplementation preserved a precedence nobody had written down.

## Notes

Written 2026-09-04, after the story's first three plans were approved. It is the
fourth, and the first not about vocabulary or enforcement: those give the domain
words and rules, this gives it an answer it currently has to be told.

**The measurement that made it a plan rather than a guess:** three consumers, no
producer. `grep -rn BranchState packages/domain/src` returns `eligible.ts`,
`waiting.ts` and `verdict.ts` — all reading — while the eight states are decided
in four places in a shell script none of them can call.
