# A third connector costs one adapter

> `HostBackend` is a closed enum in the domain, so adding GitLab edits the layer
> that is supposed not to know which vendor it is talking to.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 0
- **Approved:** 2026-09-01, Jan Wloka, in-session
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-02, Jan Wloka, `feature/the-domain-forgets-the-vendor-list`
- **Started:** 2026-09-02, Jan Wloka, `feature/a-third-connector-needs-no-domain-edit`
-->

## Changelog

- Adding a git host is an adapter change: the domain stops holding a list of
  vendor names, and the one place that branched on it asks the connector instead.

Board impact: `fleet.ts` loses two `backend === 'github'` branches. The plan
format, the template and `docs/plans` layout are untouched.

> **Design spec:** [Ports § A connector is a kind of adapter](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md)
> and [Budget](../stories/the-master-agent-holds-the-fleet/DESIGN-budget.md),
> which record the adapter-only property as a **target rather than a
> description** — this plan is what makes it a description.

## Motivation

### The domain knows the vendors, and the spec says it should not

```ts
export type HostBackend = 'github' | 'bitbucket';   // ports/host.ts:6
```

`adapters/host/host-shell.ts:111` throws on anything else, and
`packages/domain/test/host-shell.test.ts:104` **already asserts that `gitlab` is
refused** — deliberately:

> `backend` is the one operation with a closed vocabulary, and an unrecognised
> word degrades to failed rather than being passed through as a `HostBackend`
> the rest of the domain would branch on.

**So this is a considered decision, not an oversight**, and the plan's job is to
show that its premise has expired rather than to call it a mistake.

### The premise is "the rest of the domain would branch on it" — and two places do

**Measured 2026-09-01.** `.backend()` is consulted in exactly two production
sites, both in `fleet.ts` (`:1899`, `:1933`), both the same expression:

```ts
const resetReader = backend === 'github' ? () => fetchGraphqlResetMs(...) : undefined;
```

**And both call the endpoint this repo has already disproved.**
`fetchGraphqlResetMs` runs `gh api rate_limit`, measured 2026-09-01 in a quiet
moment reporting `graphql 5000/5000, used 0` while a real call's header on the
same account read `Remaining 4854, Used 146`.

**So the enum protects two branches whose behaviour is wrong**, and
[`one-account-has-one-budget`](2026-09-01-one-account-has-one-budget.md) removes
them: a reset comes from the response headers of a call that was going to happen
anyway, which every connector can answer for itself.

**That is what makes this plan possible now and not before.** The type safety was
buying something real — a discrimination the code performed — right up until the
budget work made the discrimination unnecessary.

## Design

### The connector answers; the domain stops asking which one it is

**`backend` becomes a string the domain does not validate**, the way `CI` already
is: `ci_backend()` reads `$PLOT_CI` or the config key, lowercases, and validates
nothing. `Tracker` already names `linear`, for which no adapter exists.

**The adapter still refuses what it cannot drive.** Removing the domain's enum
does not remove the guard — `plot-host.sh` dispatches on the backend it resolved
and fails on a word it has no implementation for. **The refusal moves from the
type to the place that could actually do something about it.**

### What replaces the two branches

Nothing conditional. The reset reader becomes an operation every connector
implements — `actual` where headers carry it, `predicted` where they do not —
which is [Budget § 4](../stories/the-master-agent-holds-the-fleet/DESIGN-budget.md).
**A caller that asks the connector never has to know which connector it is.**

### Not chosen: widen the enum per connector

`'github' | 'bitbucket' | 'gitlab'` is one line and keeps the compiler's help.
Rejected because it keeps the domain holding a list it has no reason to know, and
the list grows with every vendor — trello, linear, whatever follows. **The edit
is cheap; the shape is what costs.**

### Not chosen: do this before the budget lands

The two `fleet.ts` branches are real consumers today. Removing the enum while
they still exist would replace a compile-time check with a runtime one for no
gain. **This plan waits on `bug/the-budget-knows-which-bucket-it-spent`.**

## Branches

### Freeing the type

- `feature/the-domain-forgets-the-vendor-list` → #664 <!-- waits: bug/the-budget-knows-which-bucket-it-spent --> — `HostBackend` becomes a string; the adapter keeps its guard and refuses a backend it cannot drive; `host-shell.test.ts:104`'s assertion changes from *"gitlab is refused by the type"* to *"gitlab is refused by the adapter, and says why"*. **Gated on the budget slice that removes the two `fleet.ts` branches** — until then the enum is protecting something real. The gate is now the annotation rather than this sentence: dispatched on 2026-09-02 while the prerequisite was open, this branch hit its own gate and wrote a `PLOT-BLOCKED` marker.

### Proving it

- `feature/a-third-connector-needs-no-domain-edit` — a fixture connector with a name the domain has never seen, driven end to end through the `Host` port, asserting that **no file under `packages/domain/src/` names it**. The gate the spec's claim needs: without it, *"adding a connector is an adapter change"* is prose that the next enum quietly falsifies.

## Done when

- `packages/domain/src/` contains **no list of vendor names**, asserted by a grep
  in CI rather than by review.
- A connector the domain has never heard of works end to end, and the test names
  no vendor Plot ships an adapter for.
- **An unknown backend still fails**, in the adapter, with a message naming what
  it could not drive — the refusal moves, it does not disappear.
- `fleet.ts` has no `backend === ` expression.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm build:board`, changeset.

## Notes

**Found by challenging the Budget spec 2026-09-01.** The spec claimed adding
GitLab is *"an adapter change rather than a domain change"*; the code said
otherwise, and the correction — recording it as a target — left the target
unowned. This plan owns it.

**The gate held, and the wait is long. Measured 2026-09-01, then again 2026-09-02.**
A dispatched worker on `feature/the-domain-forgets-the-vendor-list` verified the
gate, confirmed the condition it protects still holds, committed nothing, and
reported. `bug/the-budget-knows-which-bucket-it-spent` is **slice 7 of 9** in
`2026-09-01-one-account-has-one-budget.md`, and that plan had reached slice 2 —
so this branch waits behind most of a nine-slice plan rather than behind one
nearly-finished PR. The two expressions the gate exists for are still present,
at `fleet.ts:1905` and `fleet.ts:1939`.

The desk was un-dispatched rather than left claimed: the branch returns to `open`
and is dispatched again once slice 7 merges. Keeping a claim on a branch no
worker can advance costs a slot and invites a second worker to re-derive the same
report — one dispatch already warned the fleet was over its cap because of it.
Narrowing the gate to the two `fleet.ts` expressions, or reordering them into
their own slice ahead of the budget work, were both considered and rejected as
plan-level rewrites nobody had asked for.
