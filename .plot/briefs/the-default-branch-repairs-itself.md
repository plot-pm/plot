## Implementation brief — the-default-branch-repairs-itself (slice Repairing the symref)

- **Plan (canonical):** `docs/plans/2026-09-04-a-ref-is-not-a-claim.md` on `main`
- **Approved:** 2026-09-04, Jan Wloka, in-session
- **Branch:** `bug/the-default-branch-repairs-itself` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 3 of three. The smallest of the three, and the one that stopped work outright.

### The measurement

**Twice on 2026-09-04, hours apart**, `refs/remotes/origin/HEAD` pointed at `origin/plot-corpus-pin` — a branch that does not exist on the remote. `plot-dispatch.sh` could not resolve the default branch and refused every dispatch:

```
plot-dispatch: cannot resolve 'origin/plot-corpus-pin' — refusing to dispatch.
```

`git remote set-head origin --auto` fixed it both times, in under a second.

**`plot-corpus-pin` is the corpus suite's ref.** That is a lead, not a conclusion — the slice should say what it found rather than assume.

### What this branch owns

**A component needing the default branch repairs an unresolvable symref rather than refusing.** `set-head --auto` is the repair and it is cheap.

**It NAMES what it repaired.** A recurring corruption that is silently fixed is one nobody investigates. The line should say what the symref pointed at and what it now points at, so a second occurrence is visible in a log rather than invisible in a working system.

**It does not repair a symref that resolves.** Only an unresolvable one is broken; a deliberate non-default HEAD is somebody's choice.

### What it does NOT own

**Whatever leaves the pin behind.** Finding that is worth doing and is not this slice — record the lead in the PR so it can be picked up.

**The refusal itself.** `plot-dispatch.sh` refusing on an unreadable default branch is correct and stays; it should simply have less to refuse over.

### Done when

- An unresolvable `origin/HEAD` is repaired, and the repair is reported in words naming both refs.
- A resolvable one is left alone, with a test.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.
