# Every element is a domain concept

> Branch, Plan, Slice and Review have design specs and no domain type. They
> travel as strings between shell scripts, and 7,795 lines of shell decide what
> they mean.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-04, Jan Wloka, plan-PR #693 merged
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-05, Jan Wloka, `feature/a-merge-is-a-domain-question`
- **Started:** 2026-09-05, Jan Wloka, `feature/every-pr-question-goes-through-the-adapter`
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
and called from shell. `plot-fleet-scan.sh:3499` pipes readings into one;
`plot-approve.sh:453` and `plot-deliver.sh:336` call another. Nobody
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

## Slices

### Answering the merge question

- `feature/a-merge-is-a-domain-question` — `pr_merged` and `pr_open`
  (`plot-pr-merged.sh`) become domain rules behind a bundle. **The reasoning is
  the deliverable:** an unreachable host answers *not merged* so every caller
  keeps what it was considering removing — *"silence is never permission"* — and
  `pr_open` **can only ever keep a ref, never release one**, so its opposite
  failure direction is safe only because `pr_merged` already refused on the same
  silence. **Asserted: a host that cannot be asked deletes nothing**, and
  **asserted: the rule answers without `gh`**. The shell function survives; only
  its body moves, so all ten sourcing callers are untouched. — PR #706

### Routing every PR question

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
  an earlier count that included them was reading prose as code. — PR #717

### Giving issue tracking its own port

- `feature/issue-tracking-is-its-own-port` — **Issue tracking becomes a domain
  concept with its own port and two adapter implementations.**

  Today it has neither. The `Issue` entity exists (`entities/issue.ts`), but the
  operations hang off the **`host` port**, whose own docstring says it *"Reads
  the git host"*. A tracker is not a git host: `Tracker` is a `## Plot Config`
  key **independent of `Git host`** (`plot-host.sh:1109`), so a Bitbucket repo
  using Jira has two different foreign services answering through one interface.

  **The conflation is already visible in the port's own text.** `issueList`
  returns `unaskable` *"where the host has no tracker at all"* — one interface
  reporting not-my-department for a capability that belongs to a different
  service. That answer disappears when the tracker has its own port: a repo
  either declares a tracker or does not, and the question stops being asked of
  the git host.

  **`ports/tracker.ts`**, an interface and no runtime code, with the two
  operations that exist plus the write that has nowhere to live:

  | op | today | after |
  |---|---|---|
  | `issueList` | `host` port, gh + jira in shell | tracker port |
  | `issueView` | `host` port, gh + jira in shell | tracker port |
  | status write | `plot-update-board.sh`, `gh project`, **no abstraction** | tracker port |

  **Two adapters, and they are connectors.** CLAUDE.md draws the line: a
  connector reaches a *remote service* — account, credentials, rate limit,
  transport choice — where every other adapter reaches the local machine. Jira
  has its own `JIRA_EMAIL`, its own token and its own limits, entirely separate
  from `gh`'s. So `tracker-github` and `tracker-jira` are two connectors rather
  than one adapter with a branch, and each owns its own budget.

  **The write is the design decision this slice settles.** `plot-update-board.sh`
  calls `gh project` four times (`:35`, `:42`, `:49`, `:80`) and **never asks
  which tracker this repo uses** — zero references to `Tracker`, `plot-host.sh`
  or `tracker` in the script. It reads its own `Project board: owner/number` key
  and goes straight to one vendor. CLAUDE.md currently records the opposite
  contract — *"The two issue ops READ and never write"* — so that sentence is
  amended here rather than quietly broken: **Plot writes a status to the tracker
  it was told about, and writes nothing else.** A plan referencing an issue
  stays Plot's record; the status is the one fact the tracker owns a copy of.

  **Asserted: a Jira project's status updates reach Jira**, and **asserted: a
  repo with no `Tracker` declared writes nowhere and says so** — never a silent
  no-op against a tracker somebody configured.

  **Not Plot's board, and the name matters.** `packages/board` — `pnpm board`,
  the Kanban a person reads — is host-agnostic and stays that way: measured
  2026-09-04, `packages/board/src` holds **zero** live `gh` calls and its nine
  textual mentions are all comments. Two earlier drafts of this slice called it
  *the board is a GitHub capability* and *the project tracker is optional*; the
  first asserts the opposite of what is true about Plot's board, and the second
  treats a supported integration as an extra.

### Naming the branch

- `feature/a-branch-is-a-domain-entity` — `Branch` becomes a type, and **the
  type is a home for the rules rather than a wrapper round a string.**

  The wrapper framing does not survive measurement: only **4** fields in the
  whole domain are a bare branch string (`declaration.ts:32`, `fleet.ts:125`,
  `subscription.ts:29`, `ending.ts:75`), none is a plan slug, and this repo has
  **no branded-type precedent** to follow. A `Branch` that only stopped a slug
  being passed where a branch belongs would move no judgement and buy little.

  **What is scattered is the judging.** `SourceBranchSchema` (`fleet.ts:124`)
  already carries `branch`, `state`, `deferred` and the deferral reason — a
  Branch entity in all but name — while the rules that decide anything about a
  branch live in shell: `plot-reap.sh`'s five refusals and
  `plot-release-refs.sh`'s five guards are the same question asked twice, about
  the same thing, in two scripts that must never disagree. This slice renames
  the schema to what it is and moves those rules onto it.

  **Asserted: the reaper's refusals and the ref-deleter's guards are one rule
  with two callers**, which is the property that makes the type worth having —
  and the one a wrapper would not deliver.

  **And it answers what Plot makes of a ref it is handed.** That question has no
  owner today; four components answer it independently:

  | component | what it decides | where |
  |---|---|---|
  | `plot-fleet-scan.sh` | a branch exists only if a plan's `## Branches` names it | the `wave_lines` loop, `:3406` |
  | `fleet.ts` | `idea/*` refs are worth discovering | `for-each-ref`, `:1237` |
  | `ideaPlanFiles` | an `idea/*` branch may carry a plan file | `:1233` |
  | `collectBranchPlans` | **any** configured prefix may carry one | `board.ts:2128` |

  The last two overlap, and `plot-reconcile-scan.sh` has thirteen sections and
  **none for a ref nobody planned** — so a hand-cut branch is not classified as
  anything; it simply does not exist to Plot.

  **The rule states the answer once:** given a ref, Plot recognises **a plan
  under review** (a prefixed branch carrying a plan file the default branch does
  not have), **a slice's branch** (named by an approved plan's `## Branches`), or
  **nothing Plot planned** — and says which rather than rendering what it happens
  to know.

  **Measured 2026-09-04, the cost of having no such rule.** PR #702 rendered on
  the board as a `PLAN` row with CI status and a draft badge, and **no phase, no
  rounds and wrong stats** — because the board had the PR and the ref but no
  parsed plan. `ideaPlanFiles` had even found the plan file's path and kept only
  its name. Every field shown was a PR fact; every missing field was a Plan
  field. The row was not wrong about anything it could see; it had no rule
  telling it what it was looking at.

  **Asserted: a ref carrying a plan file that main does not have is recognised as
  a plan under review**, so its phase and rounds are read rather than omitted.
  **Asserted: a ref no plan names is recognised as unplanned and said to be so**
  — never silently absent, which is today's behaviour and the reason nobody
  notices it.

### Repairing an unresolvable symref

- `bug/the-default-branch-repairs-itself` — **folded in from `a-ref-is-not-a-claim` on 2026-09-04**, because a symref that will not resolve is a Branch question and this is where Branch becomes a type. Twice that day `refs/remotes/origin/HEAD` pointed at `origin/plot-corpus-pin`, a branch that does not exist, and `plot-dispatch.sh` refused every dispatch because it could not resolve the default branch. `git remote set-head origin --auto` repaired it in under a second, both times. A component that needs the default branch repairs an unresolvable symref rather than refusing, **and names what it repaired** — a recurring corruption silently fixed is one nobody investigates. It does not touch a symref that resolves: a deliberate non-default HEAD is somebody's choice. What leaves the pin behind is a lead, not a conclusion; record it rather than assume it.

### Naming the plan and the slice

- `feature/a-plan-is-a-domain-entity` — `Plan` and `Slice` as types, with the
  phase and eligibility rules that `plot-plan-meta.sh` (494 lines of code, **4**
  world calls — almost pure parsing) and `plot-fleet-scan.sh` decide today.
  **The two must not collapse into one, and ownership is what keeps them
  apart.** They are 1:1 — a Slice holds exactly one branch — so the distinction
  has to be argued rather than assumed. It is: **a plan writes the Slice, git
  writes the Branch**, and the two disagree constantly. Measured 2026-09-04, the
  estate carries **33 annotations** stating something about a branch that no ref
  can tell you: 29 `deferred:`, 3 `moved:`, 1 `split-from:`. A deferred slice is
  a plan's decision about work it will not do; the branch it names may not exist,
  may exist unmerged, or may have merged under another plan.

  A Slice therefore has a plan, a wave, an order and an intent; a Branch has a
  ref, a state and merge facts. **Asserted: a deferred Slice keeps its meaning
  when its Branch does not exist** — the case that proves neither is derivable
  from the other.

  That disagreement is what the board renders.

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

**Interrogated 2026-09-04, one round.** It did not change the plan's shape and
it sharpened two claims that would not have survived implementation.

**A type is a home for rules, not a wrapper.** The plan led with
`branch: z.string()`, which measures thinner than it reads: 4 bare branch
fields in the whole domain, 0 plan slugs, and no branded-type precedent here.
`SourceBranchSchema` is already a Branch in all but name. What is actually
scattered is the *judging* — the reaper's five refusals and the ref-deleter's
five guards are one question asked twice in two scripts that must never
disagree — so that is what the entity is for, and what the slice now asserts.

**Ownership is what keeps Slice and Branch apart.** They are 1:1, so the
distinction needed an argument rather than an assertion. It has one: a plan
writes the Slice and git writes the Branch, and the estate carries **33
annotations** — 29 `deferred:`, 3 `moved:`, 1 `split-from:` — saying things
about a branch that no ref can tell you. A deferred Slice whose Branch does not
exist is the case that proves neither derives from the other.

Two citations had drifted onto comments and are corrected;
`bug/the-default-branch-repairs-itself` was examined and kept — resolving the
default branch is a Branch operation, it broke dispatch twice in one day, and
the plan already requires the repair to name itself.

**Amended 2026-09-04, after approval.** `feature/a-branch-is-a-domain-entity`
gains the recognition rule: given a ref, what does Plot make of it?

**The amendment is a scope addition to one slice, not a new decision.** That
slice already existed to be *a home for the rules that judge a branch*, and this
is the rule that had no home at all — four components answer it independently
today, two of them (`ideaPlanFiles` and `collectBranchPlans`) overlapping, and
`plot-reconcile-scan.sh` answers it for a ref nobody planned by having no
section for one.

**It is recorded here rather than folded in silently** because the plan was
already Approved when the gap was found, and an approved plan that grows without
saying so is the drift this story exists to remove. The trigger was PR #702
rendering as a `PLAN` row with CI status, a draft badge, no phase, no rounds and
wrong counts — every field it showed a PR fact, every field it missed a Plan
field, and no rule anywhere saying which it was looking at.
