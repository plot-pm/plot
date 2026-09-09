## Implementation brief — the-ci-key-carries-its-instance (slice 2: Asking the scheme)

- **Plan (canonical):** `docs/plans/2026-09-09-the-ci-key-carries-its-instance.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #852 merged
- **Branch:** `bug/the-ci-callers-match-the-scheme` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention

**IT WAITS FOR `bug/the-ci-key-splits-into-scheme-and-instance`.** That slice
writes `ci_scheme()`; this one moves every caller onto it and deletes
`ci_backend()`. Rebase onto `main` once slice 1 has merged. If `ci_scheme()` is
not on `main` yet, write `PLOT-BLOCKED.md` naming what is missing and stop —
do not write the function yourself.

### What to build

The four call sites in `skills/plot/scripts/plot-host.sh` compare
`ci_scheme()` instead of `ci_backend()`, and `ci_backend()` is **deleted**:

| line | current shape |
|---|---|
| `:2417` | `[ "$ci" = "jenkins" ]` |
| `:2692` | `case` with a bare `github-actions)` arm |
| `:2794` | `case` with a bare `jenkins)` arm |
| `:3336` | `case` with a bare `jenkins)` arm — the `ci-limit` arm |

Plus the `ci-limit` payload: report the **scheme** as `connector`, not the whole
prose value.

**All four have the bug, not three.** `:2692` matches a bare `github-actions)`
and misses `github-actions (see .github/workflows/ci.yml)` exactly as the
Jenkins arms miss theirs. This repo escapes only because it writes the word
alone. The GitHub arm moves with the other three rather than being left as the
one that appeared to work.

The `case` arms and the `=` test keep their current shape — only the value they
compare moves. That is what makes this a small diff.

### The decisions the plan settles — do not re-derive them

**The payload is a SECOND defect, not a rendering nicety.** Measured
2026-09-09 by running the arm:

```
PLOT_CI='Jenkins at `jenkins-ci-ewz…`' ci-limit
  -> {"connector":"jenkins at `jenkins-ci-ewz…`","limit":null,"basis":"unknown"}
```

`build-shell.ts:180` then filters by **equality**:

```ts
readings.value.filter((reading) => reading.connector === shell.system)
```

`shell.system` is the connector's bare word, so a prose value never matches and
`limit()` answers `[]`. The port defines that answer as *"a connector that
meters nothing."* **A Jenkins with a `predicted` ceiling of 60 reports as
metering nothing**, and no caller can tell the two apart. So the missing split
costs two things: the wrong `basis`, then the reading discarded before anyone
sees it.

**This is why one assertion must come from the DOMAIN side.** A shell-only
assertion on the payload string passes while the connector still answers
*meters nothing*.

**`ci_backend()` is deleted, not kept.** After this slice it has zero callers,
and a function retained for a hypothetical reader invites the next caller to
match on the prose value again — which is the bug being fixed.

**`budget.ts:15` cites it BY NAME and moves with it.** The domain documents
`connector` as an open `z.string()` partly because *"`ci_backend()` validates
nothing at all"*. The argument survives the rename unchanged — `ci_scheme()`
validates nothing either, it only splits — so update the citation rather than
leaving it pointing at a deleted function. This is the one file outside
`plot-host.sh` this slice touches.

**Not chosen: `case "$_ci" in jenkins*)`.** A glob would fix `ci-limit` in one
character. It also matches `jenkins-ci-ewz.internal.quatico.dev` as a *scheme*,
so a repo that wrote only the host would read as configured Jenkins with no
instance — and it leaves `:2417`'s `=` test broken, since a glob is not an
equality.

**Rules carried over:** an unreachable connector is not an empty one. `ci-limit`'s
`*)` arm answers `unknown` for **a connector nobody wrote an estimate for** —
keep that arm; the fix is that Jenkins stops falling into it.

### Done when

The plan's slice-2 assertions are the specification:

- `ci-limit` reports `basis: predicted` for **all three** real Jenkins
  spellings. This is the defect the plan was opened for.
- `github-actions` with a trailing note still matches its arm.
- `ci-limit`'s payload reports the scheme: `{"connector":"github-actions"}`,
  not `{"connector":"github-actions (see …)"}`.
- **From the domain side: `limit()` returns a NON-EMPTY list for a prose `CI:`
  value.** This is the assertion that catches the second defect.
- No `ci_backend` reference survives — `grep -c ci_backend` returns 0 across
  `skills/plot/scripts/` **and** `packages/domain/src`.

**The regression surface already exists and is NOT to be edited.**
`test/reconcile/host.test.mjs` sets `PLOT_CI` in **11 places**;
`packages/domain/test/host-shell.test.ts` and `build-shell.test.ts` cover the
same ops. They pin the bare-word contract — every spelling that works today
must keep working. **A slice that has to rewrite them has changed the contract
rather than the parsing: stop and report.**

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then
`corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`,
`corepack pnpm run test:board`, `corepack pnpm run typecheck`. Add a changeset
(`'plot': patch`, description FIRST, `bumps:` block LAST).
**Do not run `pnpm run test:e2e`** — that is CI's gate.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section on `main`. Push the first real commit as soon as it
exists.

### Scope guard

This branch owns the four call sites in `skills/plot/scripts/plot-host.sh`, the
`ci_backend()` deletion, and the one citation in
`packages/domain/src/entities/budget.ts`.

**Slice 1 owns `ci_scheme()` and `ci_instance()` themselves** — if their
behaviour is wrong, report it rather than editing them here.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
