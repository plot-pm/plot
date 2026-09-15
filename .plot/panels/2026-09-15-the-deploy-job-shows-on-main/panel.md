# Panel — the-deploy-job-shows-on-main

Subject: `docs/plans/2026-09-15-the-deploy-job-shows-on-main.md` (Draft, uninterrogated)
Lenses: premise, connector, verifiability.
Reconciliation: **divided — amend=connector,verifiability · reject=premise**

## The disagreement, named rather than averaged

Two jurors say amend, one says reject. **This is not "mostly amend."** All three found the same three defects and agree on every fact; they disagree about whether what survives is a plan to fix or a plan to rewrite.

- **`premise` says reject** because the plan's *stated* mechanism — a dependency, an entity, a target row — is wrong in all three parts, and what remains after deleting them is a different plan.
- **`connector` and `verifiability` say amend** because the underlying need (a team's CD state is invisible) is real and untouched by the three errors.

**The panel should be read as: the intuition is sound, the plan is not salvageable as written.** Whether that is "amend" or "reject" is a naming question about one document, and this moderation does not resolve it by counting. It is the caller's call, and the difference is small: nobody on this panel thinks an agent should be dispatched against this text.

## Three defects, each found independently by more than one lens

### 1. The declared dependency is the rejected sibling's false premise, restated

Plan Notes `:99-102`: *"Until `buildPortFor` reaches `buildFor`, no Jenkins reading arrives at the board at all."*

That sentence is the one `the-board-asks-the-build-resolver` was rejected for. `buildPortFor` already reaches `buildFor`, one hop through `buildShell` (`board.ts:232` → `build-resolve.ts:54-65` → `:41-42`).

**The rejection was recorded yesterday and the dependency was carried forward anyway.** That is the finding worth keeping: a plan citing a rejected plan inherited its false sentence rather than its correction.

### 2. "The entity already distinguishes them" — the load-bearing claim, and it is false

The plan rests on `BuildRun` carrying a `pipeline` field. Both `connector` and `verifiability` read the port: `ports/build.ts` returns `readonly BuildRun[]`, `ShaRun | null`, `readonly LimitReading[]` (`:76`, `:105`, `:126`). **`Build` — the entity that has `pipeline` — is returned by no port operation.** It is unreachable from the board.

What actually flows is `BuildRun`, whose only job-identifying field is the free-text `workflow`, documented as *"the workflow's name; `''` where the CI system did not name it"*. So *"two runs on one branch are expressible today without a schema change"* is unsupported by the entity the plan cites.

### 3. There is no target row — the defect that makes it unimplementable

`board.ts:706`:

```ts
return tips.value.filter(
  (tip) => tip.branch !== '' && tip.branch !== defaultBranch,
)
```

**The default branch is explicitly filtered out of the branch list.** And `checks` is a field on `PrRecord` (`fleet.ts:346`), consumed per-PR. Every rendered check state on this board hangs off a pull request; the default branch has no PR.

So the slice — *"render its state on that branch's row beside the CI state"* — names a row that does not exist **and** a CI state that is not rendered there either. An implementer reaching this point must first invent a default-branch row: a new section, a new `classifyGroup` arm for *a branch with no PR that is nonetheless shown*, its own layout. That is a board change with its own plan. The Board-impact comment calls it *"one extra reading on the default branch's row"*.

## What the lenses had in common — and what it cost

All three verified the `plot-host.sh` citations and the `CI: github-actions` declaration, and all three found them true. **The plan's *quotations* are accurate; its *inferences from them* are not.** Every defect above is an inference: that an entity's field is reachable, that a dependency exists, that a row exists. A lens checking quotations would have passed this plan.

That is the same shape as the rejected sibling, where a function was located by its filename rather than by reading it. **Two plans in two days, both from accurate citations and wrong inferences.**

## The cost gate is off by a factor

The plan's strongest gate — *"asked exactly once per refresh, pinned by counting the calls"* — names the wrong unit. `jenkins_build_map()` makes **two** `jen` calls: `jen auth status` (`plot-host.sh:746`) and `jen job list` (`:756`). A second job re-using it costs **+2 per refresh**, against Jenkins' declared budget of 60/hr — the tightest connector on the estate. A test counting `job list` invocations passes while the budget takes double.

## What survives, and it is worth keeping

**A team whose CD runs in a separate job genuinely cannot see it.** No juror disputed this. `premise` confirms there is no path to the default branch's build state, by a different route than the plan claimed.

`connector` names the smaller coherent version: **overlay the deploy job's state onto PR rows targeting main.** No new row, no new section, no `classifyGroup` arm — and it needs a different plan, because this one does not say it.

## What the caller should do

1. **Do not dispatch this.** Unanimous in substance across all three lenses.
2. **Delete the dependency on the rejected plan** — it is false and it is the second document to carry that sentence.
3. **Re-scope to PR rows targeting main**, or write the default-branch row as its own plan first. Decide which; they are different sizes.
4. **Re-count the call cost as +2**, against a 60/hr ceiling.
5. Keep the plan's honest split of what can and cannot be verified here — `verifiability` confirms that part was right.
