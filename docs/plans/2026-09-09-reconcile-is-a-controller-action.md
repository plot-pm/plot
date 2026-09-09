# Reconcile is a controller action

> Nine lifecycle actions are controller endpoints. Reconcile is not: `/plot-reconcile` runs a shell script directly, its reach is whatever that one script enumerates, and it cannot be asked about a plan, a sprint, or the estate as three different questions.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** the-jenkins-team-sees-its-builds
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #860 merged

## Changelog

- `/plot-reconcile` asks a controller instead of running a script, and it takes a scope: one plan, one sprint, or the whole workspace. Desks join the drift the sweep reports, so a finished worktree is a finding rather than something an operator counts by hand.

Board impact: yes. The reconcile action becomes a tenth endpoint beside the nine, reachable through `plot-ask.mjs` like the rest.

## Motivation

**Nine actions are controller endpoints and reconcile is not.** Measured 2026-09-09: `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission` and `continue` are reachable through `skills/plot/scripts/board/plot-ask.mjs`. `/plot-reconcile`'s SKILL.md invokes `plot-reconcile-scan.sh` directly, at three call sites.

`CLAUDE.md:472` states what that is:

> **Where no controller exists, the gap is the finding.**

This plan is that finding, filed rather than worked around.

### The reach was measured wrong twice, and the third reading is smaller

**Measured 2026-09-09 on this estate: 18 worktrees, of which 11 held merged PRs — finished desks nobody removed.** The reaper's dry run reported `kept=3`. Ten were removed by hand, using the reaper's own conditions, because the tool that holds them never looked.

**Three explanations were proposed for that and the first two were wrong, both mine.** It is not slug scoping — `plot-reap.sh:553` enumerates every worktree with no filter. And it is **not** the `/plot-wt-` path match this plan asserted at round 1: `:384` tests `.plot-worker.pid` FIRST and falls back to the path only when that file is absent. Both live desks carry the pid file, and re-measured after the ten removals the reaper examines **3 of 3** remaining dispatch desks correctly.

**So the filter works, and the skipped population was historical.** The fifteen were desks cut before the pid-file convention whose paths also did not match `plot-wt-` — recognised by neither test, refused rather than examined. `:376` names that behaviour and accepts it: *"A dispatch tree whose pid file was deleted and whose path does not match goes unrecognised — which fails by REFUSING, the same safe direction the path test failed in, and for one tree instead of all of them."*

**That is a deliberate design, not a defect — and it is still why nobody saw ten finished desks.** A tree the reaper declines to recognise is silent: not reaped, not kept, not counted, not named. The failure is safe and invisible, and invisibility is exactly what a reconciliation pass exists to remove.

**The finding is therefore reporting, not filtering.** An unrecognised dispatch desk should appear in a sweep as *this tree looks like a desk and I cannot classify it*, so a person decides — which is the sweep's whole contract. Widening the recognition test would trade a safe refusal for a wider blast radius; reporting the refusal costs nothing.

**And the domain already declares the question, unwired.** `reap.ts:27` declares `isDispatchTree: boolean` and `:136` skips any tree where it is false — but nothing computes it. The shell decides in a `case` statement instead, so the typed field is dead and the live decision sits where no test reaches it. That is how a recognition rule can be correct today and drift tomorrow without anyone noticing.

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

### Its own bundle, not a verb on `plot-ask.mjs`

**The estate has two entry patterns and this takes the second.** `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh` — it spawns. `plot-slice-pr.mjs` was given its own bundle for the reason `entry/transition.ts:26` states: *"This bundle spawns nothing and reads nothing."* A script asking an artifact that then calls a script is the loop that argument exists to prevent.

**And the sweep is the worst possible candidate for it, though not for the reason a first count suggested.** Measured 2026-09-09: **~26 executable git call SITES and exactly one host op** (`pr-state`). An earlier draft of this plan said 72 shell and host calls; that number came from counting source lines and included `git rm`, `git push` and `git add` appearing inside the remediation strings the scan PRINTS for a person to run.

**The cost is the multiplier, not the count.** Those 26 sites sit inside **31 loops**, iterated per plan and per branch — 253 plans on this estate. So the sweep's 279.9 s is git re-consulted thousands of times, which is also why no cache helps: the scan re-derives from refs every pass by design, and that is what makes it trustworthy.

So: **`board/plot-reconcile.mjs`, JSON in and findings out, spawning nothing.** The shell keeps its 72 calls, takes the readings it already takes, and passes them in. That is `plot-open-pr.sh`'s shape — *"every reading arrives on stdin from the shell that took it"* — and it also keeps the bundle small: `plot-slice-pr.mjs` is 2.7 KB against `plot-ask.mjs`'s 491 KB, because a caller asking what has drifted should not load the fleet controller.

### The cost target is asserted, not hoped

**Measured: the sweep takes 279.9 s offline** (`--offline`, on this repo, 2026-08-31) and re-reads the whole estate each run. The cost is structural — ~26 git call sites inside 31 loops, over 253 plans — so a scope that narrows the population is the only thing that changes it. A scope that does not change that is a filter applied after the fact, which is precisely what this design says it is not.

| scope | target |
|---|---|
| workspace | ~280 s — today's cost, unchanged |
| plan | **under 5 s** |
| sprint | **under 30 s** |

The plan target is the load-bearing one, because it is what makes the delivery gate affordable. `plot-open-pr.sh` set the precedent for asserting this rather than hoping: 253 plans parsed took 103 s against 0.6 s once candidates were grepped first, and the number is in the plan because a slice that missed it would still have looked correct.

### It replaces `/plot-deliver`'s step 7b rather than sitting beside it

**7b runs the full 279 s estate sweep to ask about ONE plan**, then greps its output for that plan's filename. It is the delivery gate — objective, checkable, and correct — and it is the most expensive step in the delivery skill for a question a plan scope answers directly.

The gate keeps its shape: the same blocking sections (1–6, to the `== blocking sections end ==` marker), the same hard stop, the same *"only an empty result clears it"*. What changes is that it asks about the plan it just delivered rather than about the estate.

**`plot-estate-changed.sh` becomes unnecessary in this path.** That guard exists solely to skip a re-run of the expensive sweep — *"the same question asked twice"* — and a 5 s scoped call has nothing worth guarding. The script stays for its other callers; the delivery gate stops needing it, and the state file it maintains for this purpose stops being written.

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

  **And the slice carries the hang, because whoever renames the suite is already inside it.** `CHANGELOG.md` records this suite cancelling at the job ceiling in **10 of 16 observed runs**, and an underlying intermittent hang it calls **unexplained**. Measured again 2026-09-09: three processes at **0 % CPU for 28 minutes** past a `--test-timeout` of 5 — the parent waiting on children that never exit, under three agents running the suite concurrently.

  **Asserted: the hang is reproduced or the slice says it could not be.** An unexplained defect has already survived several attempts, so the deliverable is a measurement — the condition under which it hangs, or a stated failure to provoke it — never a speculative fix. **Asserted: no test file is edited to make the suite pass.** If contention is the cause, the repair is bounding concurrency, and a green suite bought by weakening an assertion is the one move this repo forbids outright.

  **This is the one slice that may legitimately not finish**, and it is separated from the rename in the PR so the trivial half can land regardless.

### Reconciling

- `feature/reconcile-is-a-controller-action` <!-- builds: the reconcile rule and its controller endpoint, scoped to a plan, a sprint or the workspace --> — the domain rule taking a scope and returning findings, plus the tenth endpoint beside the nine, reachable through `plot-ask.mjs`.

  **Asserted: the three scopes return different finding sets** for one estate — a plan scope reports that plan's drift and not the estate's. **Asserted: it performs nothing** — no write, no removal, no fetch the caller did not ask for; the findings name commands and run none. **Asserted: a scope naming a plan that does not exist is refused**, not answered with an empty sweep, since an empty finding list reads as *nothing has drifted*.

### Sweeping

- `feature/a-finished-desk-is-a-finding` <!-- builds: the dispatch-desk reading and the reconcile finding for a desk whose work has landed --> — **the shell stops deciding, and an unrecognised desk becomes visible.** `plot-reap.sh:384` recognises a dispatch tree by `.plot-worker.pid` or the legacy `plot-wt-` path, and a tree matching neither is silently skipped — safe, deliberate, and invisible, which is how ten finished desks went unnoticed. The shell **supplies `isDispatchTree`**, the field `reap.ts:27` already declares and `:136` already acts on, and the sweep reports what it could not classify. Then desks join the findings, each naming the `git worktree remove` that repairs it. Waits on `feature/reconcile-is-a-controller-action`, which is where a finding is defined.

  **Asserted: an unrecognised tree is REPORTED, never silently skipped** — the failure that hid ten finished desks. It is reported as unclassified, not as reapable: the recognition test stays exactly as strict, and only the silence goes.

  **Asserted: a hand-made worktree is still skipped entirely** — `isDispatchTree: false` is the population boundary `reap.ts:136` states, and a person's tree must not become a finding telling them to remove it. The distinction the slice must hold: *not a desk* is silence, *might be a desk and I cannot tell* is a finding. **Asserted: no `case` statement decides it** — the shell measures and the rule judges, which is the split that keeps a recognition rule testable. **Asserted: the reaper's verdicts are unchanged** — measured 3 of 3 on the current estate before the change, and the same 3 after.

  **Asserted: a dirty desk whose agent died is reported as NEEDS A PERSON, never as free** — the case that strands finished code, measured twice on this estate. **Asserted: a desk with a live worker is not reported at all**, since a finding an operator cannot act on is noise. **Asserted: the conditions come from `reap()`** rather than a second copy. **Asserted: the finding names the desk path**, because the repair is per-directory.

## Notes

Written 2026-09-09 after a session in which the estate reached 18 worktrees, 11 of them finished, and the reaper reported three. Ten were removed by hand using the reaper's own conditions.

**The word means three things in this repo** — the controller action this plan adds, the `plot-reconcile-scan.sh` sweep, and 74 shell contract tests that merely live in a directory called `reconcile`. Two of the three are addressed here; the sweep keeps its name because it is what the action will call.

**Three explanations of the reach problem were proposed and two were wrong**, both of them mine. It is not slug scoping (`plot-reap.sh:553` enumerates every worktree with no filter), and it is not a manifest/branch/claim alignment. It is one `case` statement matching `/plot-wt-` against desks dispatch names `free-<id>` and `<branch-suffix>` — found by reading the loop rather than the summary, after two readings that stopped at the enumeration.

**That is also the argument for the plan.** A one-line filter drifted from its producer's naming, cost 15 of 18 desks, sat in a shell `case` where no test reaches it, and shadowed a domain field declared for the same question. The layering rule this repo already states — scripts collect, rules judge — is what would have caught it, and the Sweeping slice applies it rather than fixing the line in place.

Definition of Done: docs/definition-of-done.md
