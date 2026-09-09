# Reconcile is a controller action

> Nine lifecycle actions are controller endpoints. Reconcile is not: `/plot-reconcile` runs a shell script directly, its reach is whatever that one script enumerates, and it cannot be asked about a plan, a sprint, or the estate as three different questions.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `/plot-reconcile` asks a controller instead of running a script, and it takes a scope: one plan, one sprint, or the whole workspace. Desks join the drift the sweep reports, so a finished worktree is a finding rather than something an operator counts by hand.

Board impact: yes. The reconcile action becomes a tenth endpoint beside the nine, reachable through `plot-ask.mjs` like the rest.

## Motivation

**Nine actions are controller endpoints and reconcile is not.** Measured 2026-09-09: `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission` and `continue` are reachable through `skills/plot/scripts/board/plot-ask.mjs`. `/plot-reconcile`'s SKILL.md invokes `plot-reconcile-scan.sh` directly, at three call sites.

`CLAUDE.md:472` states what that is:

> **Where no controller exists, the gap is the finding.**

This plan is that finding, filed rather than worked around.

### The reach is a naming disagreement, and it is one line

**Measured 2026-09-09 on this estate: 18 worktrees, of which 11 held merged PRs — finished desks nobody removed.** The reaper's dry run reported `kept=3`.

The cause is a **path-name filter that no longer matches what dispatch cuts**:

```sh
# plot-reap.sh, inside the worktree loop
case "$wt" in *"/plot-wt-"*) ;; *) continue ;; esac
```

Against `plot-dispatch.sh`, which names desks two other ways:

| site | name it cuts |
|---|---|
| `:1576` | `${wt_prefix}free-<session-id>` |
| `:3068` | `${wt_prefix}<branch-suffix>` |

**Neither contains `/plot-wt-`.** So 15 of 18 desks were skipped before a single refusal ran — not refused, not reported, not counted. The producer and the consumer disagree about what a dispatch desk is called, and nothing tests the pair.

**The reaper is NOT slug-scoped**, and two earlier readings of this said otherwise. `plot-reap.sh:553` enumerates every worktree with no filter; the loop then discards most of them on the line above.

**And the domain already holds the same question, unwired.** `reap.ts:27` declares `isDispatchTree: boolean` and `:136` skips any tree where it is false — but nothing computes it. The shell never supplies it, so the field is dead and the `case` statement is the real decision. Two filters for one question, one of them unreachable by any test, which is exactly how it drifted from dispatch's naming unnoticed.

Ten of those desks were removed **by hand** after checking three facts per desk: a merged PR, no live pid, a clean tree. Those are the reaper's own conditions, applied by an operator because the tool that holds them never looked.

**The sweep does not ask about desks at all.** Its eighteen sections cover plans, branches, refs and sprints; section 18 reports a branch whose PR merged and whose *ref* survives, and there is no section for one whose *desk* survives. The two are the same shape and only one is reported.

### Three scopes, one of which is the only one that exists

`/plot-reconcile` today answers one question: *what has drifted across the whole estate?* The other two are asked constantly and answered by hand:

- **A plan.** After a delivery: did this plan's slices land, are its desks free, are its refs gone? Section 7's `/plot-reslice` hint and the delivery gate both work per-plan already.
- **A sprint.** Before a release: are the sprint's plans delivered, its items checked, its desks reaped? `plot-sprint-release.sh` answers the first, nothing answers the rest together.
- **The workspace.** Today's behaviour, unchanged.

**A scope is not a filter over one output.** A plan-scoped reconcile can ask the host about that plan's PRs and afford to; an estate-scoped one cannot ask 253 times, which is why the current sweep bundles a single `pr-list`. The scope changes what is cheap, so it belongs in the rule rather than in a `grep` after it.

### `test:reconcile` is a third thing wearing the word

**Measured: 74 files under `test/reconcile/`, of which 6 mention `plot-reconcile-scan`.** The rest are contract tests for `approve`, `deliver`, `dispatch`, `host`, `board`, `reap` — the whole helper estate. The directory presumably began as the scan's tests and became the home for all shell contracts.

`CLAUDE.md:530` and `AGENTS.md:115` both describe it as:

```
pnpm run test:reconcile   # plan-format contract tests (plot-plan-meta.sh)
```

That names **one** of the 74 files. A contributor reading either doc has no way to learn that this is the estate-wide shell suite, and this session lost a conversation to exactly that ambiguity.

**It also hangs.** `CHANGELOG.md` records the suite cancelling at the job ceiling in 10 of 16 observed runs and an unexplained intermittent hang; measured again 2026-09-09, three processes sat at 0% CPU for 28 minutes past a `--test-timeout` of 5. That is not this plan's subject, but it is why the rename must not be *"reconcile means the tests"*.

## Design

### The action, and what it decides

`reconcile(readings, input)` in the domain, reached by a tenth endpoint. Input carries the scope — `{ kind: 'plan', slug }`, `{ kind: 'sprint', slug }`, or `{ kind: 'workspace' }` — and the readings carry what the shell measured. The rule returns **findings**, each naming its subject, its evidence and the command that repairs it.

**It decides nothing and performs nothing — strictly, with no `--yes`**, which is the property `/plot-reconcile` already has and must keep:

> It is **read-only**: it prints the exact remediating command for every finding but never runs it. The judgment — is this branch still relevant, should this plan be delivered or rejected — stays yours.

That sentence is the contract. A controller that reaped on its own would be a different tool with a different blast radius, and the reaper's `--dry-run` default exists for the same reason.

**`reap()` returns `writes: Write[]` and reconcile discards them.** That is deliberate rather than wasteful: the same rule serves `/plot-reap --yes`, which performs them, and reconcile, which reports what they would have been. Taking the decision without taking the writes is what keeps one condition set serving two blast radii — and it is why reconcile can afford to sweep the whole estate while the reaper stays per-invocation.

**No `--yes`, at any scope.** A gated apply was considered and refused: the value of a sweep an operator runs casually is that running it cannot cost anything, and a flag that sometimes acts turns every invocation into a decision. Acting stays with the tools that already own each repair — `/plot-reap --yes`, `/plot-deliver`, `/plot-reslice` — each of which the findings name.

### Reconcile composes existing rules and adds none

**`packages/domain/src/workflows/reap.ts` already answers the desk half.** `reap(readings, input): Decision<ReapDetail>` holds the refusals, the kept-reasons and the writes; `rules/reapable.ts` states the conditions. So the reconcile rule **calls it** and contributes zero new conditions of its own.

What reconcile adds is the **scope** and the **composition**: it gathers findings from `reap()` for desks and from the sweep's sections for plans, branches, refs and sprints, and answers as one list for one scope. A condition that exists in two places is the drift this estate has already paid for twice — `ci_backend` matched four ways, and `isDispatchTree` declared once and decided somewhere else.

**Its own value is therefore small and specific**, which is the argument for building it: one question (*what has drifted, here?*), one answer, three scopes, and no rule that is not already written and tested.

### Desks become a finding, not a separate tool

A desk is reported when it is **finished**: a merged PR, no live worker, a clean tree and no `PLOT-BLOCKED` marker. Those come from `reap()` unchanged.

**A dirty desk whose agent died is NOT free, and that is the case the rule must keep separate.** `uncommitted-changes` is its own refusal (`plot-reap.sh:77` — *"work that exists nowhere else"*), and it outranks the absence of a worker: a dead agent with unpushed work is the shape that strands finished code. Measured twice on 2026-09-09 — one desk held 75 lines of correct tests with no PR, and a second held 324 finished lines earlier in the estate's history. **Both were rescued by a person reading the tree.** So the finding for that desk says *needs a person*, never *free*.

### Where the boundary is, and why merged rather than pushed

A desk is authoritative while it may hold work the remote has not seen; the remote is authoritative once it holds everything the desk does. The question is where that flips.

**Measured 2026-09-09 across the last eight merged PRs on this repo: every one carried 2–7 commits, and PRs stayed open 14–202 minutes (median ~60).** So a PR is opened early and pushed to afterwards — freeing a desk at PR-open would take it out from under a worker still committing. The cost of waiting for the merge is about an hour of idleness per desk; the cost of not waiting is a reset desk mid-work.

**Merge is also the only unforgeable half.** *Pushed* and *PR open* are both readable locally and both ambiguous about whether the work is done. `plot-pr-merged.sh` already answers *did this land* from `mergedAt` — never `state`, never ancestry — so the boundary reuses the estate's one answer rather than inventing a second.

### Not chosen: making the scan take a `--plan` flag

It is the smaller change and it puts the scope in the wrong place. The eighteen sections each decide what to fetch and how much; a flag threaded through them is eighteen conditionals, and the third scope (sprint) needs sections the estate-wide sweep does not run at all. The rule is where a scope belongs, for the reason `proposeStack` holds the thresholds `plot-detect-repo.sh` used to.

### Not chosen: reaping from the controller

Tempting, and refused for the reason quoted above. The sweep's value is that it can be run at any time without consequence; a reconcile that removed things would need the reaper's five refusals re-argued at a new blast radius, and an operator would stop running it casually — which is the one property that makes drift visible at all.

### Open Questions

- [ ] **Does the sprint scope need its own findings, or is it the union of its plans'?** A sprint has facts no plan has — an unchecked item whose plan is delivered, a `Release:` already tagged — and sections 11 and 15 already report both. Likely a union plus those two, but the slice should measure rather than assume.
- [ ] **What renames `test:reconcile` to?** `test:contracts` matches what the 74 files are. The rename touches two docs and one script name; whether CI job names follow is the slice's call.

## Slices

### Naming

- `infra/the-test-suite-says-what-it-tests` <!-- builds: the test:reconcile script name and the two docs describing it --> — rename the estate-wide shell suite so it stops colliding with the reconcile action, and correct `CLAUDE.md:530` and `AGENTS.md:115`, which describe 74 files as one file's tests.

  **Asserted: no doc describes the suite as plan-format tests** — both lines name what it covers. **Asserted: every caller moves together** — `package.json`, both docs, and any CI reference, so a stale name cannot survive in one place. **Asserted: the old name is gone rather than aliased** — an alias leaves the collision this slice exists to remove.

### Reconciling

- `feature/reconcile-is-a-controller-action` <!-- builds: the reconcile rule and its controller endpoint, scoped to a plan, a sprint or the workspace --> — the domain rule taking a scope and returning findings, plus the tenth endpoint beside the nine, reachable through `plot-ask.mjs`.

  **Asserted: the three scopes return different finding sets** for one estate — a plan scope reports that plan's drift and not the estate's. **Asserted: it performs nothing** — no write, no removal, no fetch the caller did not ask for; the findings name commands and run none. **Asserted: a scope naming a plan that does not exist is refused**, not answered with an empty sweep, since an empty finding list reads as *nothing has drifted*.

### Sweeping

- `feature/a-finished-desk-is-a-finding` <!-- builds: the dispatch-desk reading and the reconcile finding for a desk whose work has landed --> — **first the filter, then the finding.** `plot-reap.sh`'s `case "$wt" in *"/plot-wt-"*` skips 15 of 18 desks on this estate because dispatch names them `free-<id>` and `<branch-suffix>`; the shell stops deciding and instead **supplies `isDispatchTree`**, the field `reap.ts:27` already declares and `:136` already acts on. Then desks join the sweep, each finding naming the `git worktree remove` that repairs it. Waits on `feature/reconcile-is-a-controller-action`, which is where a finding is defined.

  **Asserted: the filter fix is measured before the finding is built** — re-run the reaper after the shell reports the field and count what it now examines. If 18 of 18 reach a refusal, the finding is reporting a population the reaper already handles, and the slice says so rather than adding a section nobody needs.

  **Asserted: a desk dispatch cut under EVERY naming reaches a refusal** — `free-<id>`, `<branch-suffix>` and the legacy `plot-wt-<suffix>` alike, since the bug is precisely that one of three was privileged. **Asserted: a hand-made worktree is still skipped** — `isDispatchTree: false` is the population boundary `reap.ts:136` states, and widening the filter must not widen the blast radius to trees a person made. **Asserted: no `case` statement decides it** — the shell measures and the rule judges, which is the split that would have caught this drift.

  **Asserted: a dirty desk whose agent died is reported as NEEDS A PERSON, never as free** — the case that strands finished code, measured twice on this estate. **Asserted: a desk with a live worker is not reported at all**, since a finding an operator cannot act on is noise. **Asserted: the conditions come from `reap()`** rather than a second copy. **Asserted: the finding names the desk path**, because the repair is per-directory.

## Notes

Written 2026-09-09 after a session in which the estate reached 18 worktrees, 11 of them finished, and the reaper reported three. Ten were removed by hand using the reaper's own conditions.

**The word means three things in this repo** — the controller action this plan adds, the `plot-reconcile-scan.sh` sweep, and 74 shell contract tests that merely live in a directory called `reconcile`. Two of the three are addressed here; the sweep keeps its name because it is what the action will call.

**Three explanations of the reach problem were proposed and two were wrong**, both of them mine. It is not slug scoping (`plot-reap.sh:553` enumerates every worktree with no filter), and it is not a manifest/branch/claim alignment. It is one `case` statement matching `/plot-wt-` against desks dispatch names `free-<id>` and `<branch-suffix>` — found by reading the loop rather than the summary, after two readings that stopped at the enumeration.

**That is also the argument for the plan.** A one-line filter drifted from its producer's naming, cost 15 of 18 desks, sat in a shell `case` where no test reaches it, and shadowed a domain field declared for the same question. The layering rule this repo already states — scripts collect, rules judge — is what would have caught it, and the Sweeping slice applies it rather than fixing the line in place.

Definition of Done: docs/definition-of-done.md
