# Every element is a domain concept

> Branch, Plan, Slice and Review have design specs and no domain type. They
> travel as strings between shell scripts, and 7,795 lines of shell decide what
> they mean.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- The elements Plot works with are types the domain owns, not strings the shell
  agrees about. A branch, a plan, a slice and a review each become a concept a
  test can hold, and the rules that judge them move out of shell into code —
  starting with the one that decides whether a PR merged, which is what stops
  Plot running on a Bitbucket project today.

<!-- Board impact: the board reads these types rather than raw payload fields.
     No plan-format change; the wire keeps its spellings. -->

## Motivation

**Four of Plot's most-used words have a design spec and no domain type.**
Measured 2026-09-04:

| concept | `DESIGN-*.md` | domain type |
|---|---|---|
| Branch | `DESIGN-branch.md` | **none** |
| Plan | `DESIGN-plan.md` | **none** |
| Slice | `DESIGN-slice.md` | **none** |
| Review | `DESIGN-review.md` | **none** |

`grep "^export \(interface\|type\) Branch\b"` over `packages/domain/src` returns
nothing, and the same for the other three. Twenty-three entities exist —
`agent`, `budget`, `machine`, `worktree`, `pulse` and the rest — and these four
are absent from a list that contains `channel-message` and `subscription`.

**They exist as strings.** `SourceBranchSchema` (`entities/fleet.ts:124`) opens
`branch: z.string()`. A branch is a name on the wire and a set of facts spread
across a payload; nothing in the domain says what a branch IS, so nothing can
answer a question about one without re-deriving it from fields.

### The shell is where the answers live instead

**7,795 lines of code across 36 scripts**, measured 2026-09-04. That is not a
residue: it is where a plan's phase, a branch's state, a slice's eligibility and
a PR's merge are all decided.

**And the pattern that replaces it already exists, five times.**
`plot-verdicts.mjs`, `plot-transition.mjs`, `plot-movable.mjs`,
`plot-monitor.mjs` and `plot-prompt.mjs` are domain rules compiled to bundles
and called from shell. `plot-fleet-scan.sh:3436` pipes readings into one;
`plot-approve.sh:453` and `plot-deliver.sh:320` call another. Nobody
generalised it, so the scripts kept growing beside it.

### What it costs today, in one measured example

`plot-pr-merged.sh` is **12 lines of code carrying 75 lines of reasoning**, and
it is the single answer to *"did the host merge any PR for this branch?"* —
sourced by **eleven** scripts and read by one domain file (re-counted
2026-09-04; the plan first said ten and three).

Both of its functions call `gh` directly. **On a Bitbucket project, `gh` is not
installed**, and the script's own contract says an unreachable host answers *not
merged*. So the fleet would never reap a worktree, never release a ref and never
advance a slice — and nothing would report an error, because failing safe is
exactly what it was designed to do.

**That is the shape of the whole problem.** A rule with no home ends up in a
script, the script reaches one vendor's CLI, and the fail-safe hides it.

## Design

### Approach

**A concept becomes a type, the rules about it become domain rules, and the
script keeps only the reading.** Three moves per concept, and the order across
concepts is by what unblocks the most.

The target is the shape five bundles already have:

```
script  →  node board/plot-<rule>.mjs  →  domain  →  port  ←  adapter  →  git / host
```

### What decides the order

**Not size — consumers.** `plot-pr-merged.sh` is the smallest script in the
estate and the most depended-upon rule in it. `plot-fleet-scan.sh` is the
largest and can wait, because nothing is blocked on it.

### What stays in shell

**A script survives when it IS a process.** Measured 2026-09-04 across all 36:
`plot-worker-loop.sh` alone qualifies — 3 traps, 4 background launches, 4 signal
kills. It is the process bracket, and only its rules leave.

`plot-dispatch.sh` is the near miss: one trap and five background launches, but
those are one detached start the `Performer` port can own rather than a process
it becomes.

**`plot-config.sh` and `plot-host.sh` are pure adapter** — no rule to extract.
They go when their callers are gone, not before.

### Not chosen: a plan per script

Thirty-six plans for one migration, most of them a paragraph. The unit that
matters is the CONCEPT, not the file: `plot-reap.sh`'s five refusals and
`plot-release-refs.sh`'s guards are the same question about a Branch, and moving
them together is what makes the type earn its existence.

### Not chosen: one sweeping conversion

7,795 lines is a diff nobody reviews. The estate's own precedent is a ratchet —
`ci.yml:230` holds direct spawns at `allowed=28`, and the count moved 65 → 54 →
28 → 19 one slice at a time. This plan adds concepts the same way.

### Open Questions

- [ ] **Does `Review` earn a type yet?** `DESIGN-review.md` exists, but the
      three review channels (`pr`, `in-session`, `ballot`) are read from a plan
      field and nothing computes over them. It may be a spec ahead of its need.
- [ ] **Where do Branch and Slice draw their boundary?** A Slice holds one
      branch, so a naive Slice is a Branch with a heading. The distinction is
      the PLAN's intent versus the ref's state, and the types must not collapse.
- [ ] **Does the ratchet count scripts, lines, or rules?** Lines fall for
      reasons unrelated to the migration; a script count moves in jumps of one.

## Branches

### Unblocking Bitbucket

- `feature/a-merge-is-a-domain-question` — `pr_merged` and `pr_open`
  (`plot-pr-merged.sh`) become domain rules behind a bundle. **The reasoning is
  the deliverable:** an unreachable host answers *not merged* so every caller
  keeps what it was considering removing — *"silence is never permission"* — and
  `pr_open` **can only ever keep a ref, never release one**, so its opposite
  failure direction is safe only because `pr_merged` already refused on the same
  silence. **Asserted: a host that cannot be asked deletes nothing**, and
  **asserted: the rule answers without `gh`**. The shell function survives; only
  its body moves, so all ten sourcing callers are untouched.

- `feature/every-pr-question-goes-through-the-adapter` — the other three scripts
  that ask the host directly. **`plot-pr-merged.sh` is the worst of four, not
  the only one**, measured 2026-09-04: `plot-reconcile-scan.sh:291` and `:302`
  (two live `gh pr list` calls on the reconcile path),
  `plot-agent-monitor.sh:239`, and `plot-pr-state.sh:12` each ask *what is this
  PR's state* — a question `plot-host.sh` already answers for both hosts through
  `pr-list`, `pr-state` and `pr-merged`. This is duplication, not capability:
  the routing is mechanical and the adapter needs nothing new.

  It is separated from the slice above because the two fail in opposite
  directions. `plot-pr-merged.sh` answers *not merged* and the fleet quietly
  stops advancing; these three break loudly on a host with no `gh`, which is why
  they are second rather than first. **Asserted: no script outside
  `plot-host.sh` names `gh`** — a grep gate, so the next one cannot arrive
  unnoticed.

  Two scripts are deliberately **not** in this list. `plot-budget.sh` and
  `plot-worker-monitor.sh` mention `gh` only in comments — zero live calls — and
  an earlier count that included them was reading prose as code.

- `infra/the-project-tracker-is-optional` — `plot-update-board.sh` calls
  `gh project` four times (`:35`, `:42`, `:49`, `:80`), and this one **cannot be
  routed**: GitHub Projects has no Bitbucket equivalent, and `plot-host.sh`
  names `project` zero times. So it is a capability question rather than an
  adapter question — the integration becomes optional and reports itself absent
  on a host that has no projects, the way `issue-list` already exits 4 where the
  host cannot be asked at all.

  **This is not Plot's board.** `packages/board` — `pnpm board`, the Kanban a
  person reads — is host-agnostic and stays that way: measured 2026-09-04,
  `packages/board/src` contains **zero** live `gh` calls, and its nine textual
  mentions are all comments. It reaches a host only through `plot-host.sh`,
  which speaks both. What is optional here is the **external project tracker**
  a repo names in `Project board: owner/number`, and the naming matters because
  a slice called *the board is a GitHub capability* would assert the opposite of
  what is true.

  **Asserted: a repo with no project tracker configured dispatches, delivers and
  releases unchanged**, and **asserted: `pnpm board` serves a Bitbucket repo** —
  the second is the property that would otherwise be quietly assumed.

### Naming the branch

- `feature/a-branch-is-a-domain-entity` — `Branch` becomes a type. Today
  `SourceBranchSchema:125` opens `branch: z.string()` and the facts about it are
  spread across a payload. The entity carries what the specs already name and
  the rules that judge one — `plot-reap.sh`'s five refusals and
  `plot-release-refs.sh`'s guards are the same question — move onto it.

- `bug/the-default-branch-repairs-itself` — **folded in from `a-ref-is-not-a-claim` on 2026-09-04**, because a symref that will not resolve is a Branch question and this is where Branch becomes a type. Twice that day `refs/remotes/origin/HEAD` pointed at `origin/plot-corpus-pin`, a branch that does not exist, and `plot-dispatch.sh` refused every dispatch because it could not resolve the default branch. `git remote set-head origin --auto` repaired it in under a second, both times. A component that needs the default branch repairs an unresolvable symref rather than refusing, **and names what it repaired** — a recurring corruption silently fixed is one nobody investigates. It does not touch a symref that resolves: a deliberate non-default HEAD is somebody's choice. What leaves the pin behind is a lead, not a conclusion; record it rather than assume it.

### Naming the plan and the slice

- `feature/a-plan-is-a-domain-entity` — `Plan` and `Slice` as types, with the
  phase and eligibility rules that `plot-plan-meta.sh` (494 lines of code, **4**
  world calls — almost pure parsing) and `plot-fleet-scan.sh` decide today.
  **The two must not collapse into one:** a Slice is the plan's intent about a
  branch, a Branch is the ref's state, and they disagree constantly — that
  disagreement is what the board renders.

## Notes

Written 2026-09-04. Every count measured on `main` that day: 36 scripts, 7,795
lines of code, 23 entities, 26 rules, 5 existing bundles.

**Deliberately excluded, because another plan owns it.**
`plot-worker-state.sh` migrates under `the-domain-owns-the-agent-lifecycle`
(`feature/the-task-state-is-a-domain-rule`, started 2026-09-04). Two plans
converting one script is how the duplication this repo already measured — five
of six states carried twice until 2026-08-18 — comes back.

**Not a rename.** `the-board-says-slice` moved the board's vocabulary; this
gives the vocabulary something to refer to.
