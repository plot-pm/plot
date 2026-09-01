## Implementation brief — a-third-connector-costs-one-adapter (slice: Freeing the type)

- **Plan (canonical):** `docs/plans/2026-09-01-a-third-connector-costs-one-adapter.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/the-domain-forgets-the-vendor-list` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

### DO NOT START THIS YET — it is gated on another plan's slice

**`bug/the-budget-knows-which-bucket-it-spent` must land first.** Verified
2026-09-01: it has no branch and no PR.

The reason is concrete rather than procedural. `.backend()` has **two production
consumers**, `fleet.ts:1899` and `:1933`, both the same expression:

```ts
const resetReader = backend === 'github' ? () => fetchGraphqlResetMs(...) : undefined;
```

**While those exist, the enum is protecting something real.** Removing it now
trades a compile-time check for a runtime one and buys nothing. The budget slice
deletes both branches — a reset comes from the response headers of a call that
was going to happen anyway, which every connector answers for itself.

If you are reading this because a dispatch handed it to you, **check that slice
first**; if it has not merged, report and stop.

### What to build, once it is unblocked

`HostBackend` stops being a closed enum. The domain holds no list of vendor
names; the adapter keeps its guard.

### The decisions the plan settles — do not re-derive them

**The closed enum was a considered decision, not an oversight.**
`packages/domain/test/host-shell.test.ts:104` already asserts `gitlab` is refused,
and says why:

> `backend` is the one operation with a closed vocabulary, and an unrecognised
> word degrades to failed rather than being passed through as a `HostBackend`
> the rest of the domain would branch on.

**That premise expires with the two `fleet.ts` branches, and not before.** Write
the change as *the reason has gone*, never as *this was wrong*.

**The refusal moves; it does not disappear.** `adapters/host/host-shell.ts:111`
throws `plot-host: unrecognised backend`. Keep a refusal — the adapter is the
layer that could actually do something about a backend it cannot drive, and it
must still say which one it could not.

**The model is `CI`, which already works this way.** `ci_backend()` reads
`$PLOT_CI` or the config key, lowercases, and validates nothing. `Tracker`
already names `linear` with no adapter behind it. `Git host` is the outlier.

### Done when

- **No file under `packages/domain/src/` names a vendor**, asserted by a CI grep
  rather than by review. Prose that says "the domain does not know the vendors"
  is what the next enum quietly falsifies.
- `fleet.ts` contains no `backend === ` expression.
- **An unknown backend still fails, in the adapter, naming what it could not
  drive.** Change `host-shell.test.ts:104` from *"gitlab is refused by the
  type"* to *"gitlab is refused by the adapter, and says why"* — the test keeps
  its subject and changes its layer.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm build:board`, changeset (`'@plot-pm/domain': patch`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Prove the CI grep is discriminating.** Add `'gitlab'` to a domain file and
confirm the grep fails, then remove it. A gate that passes against a violation is
testing nothing — three inert mutations were caught in this repo on 2026-09-01.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the
  loose matcher reads it as a claim, the anchored one does not, and
  `parser.test.mjs`'s estate-wide differential fails. It cost a red main on
  2026-09-01.

### Scope guard

**This branch owns:** `ports/host.ts`'s type, `host-shell.ts`'s guard, the two
`fleet.ts` call sites, and `host-shell.test.ts:104`.

**It does not own** the fixture connector or the CI grep — that is
`feature/a-third-connector-needs-no-domain-edit`, the slice that proves the
property. It also does not own anything in `one-account-has-one-budget`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
