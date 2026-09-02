## Implementation brief — a-third-connector-needs-no-domain-edit (wave Proving it)

- **Plan (canonical):** `docs/plans/2026-09-01-a-third-connector-costs-one-adapter.md` on `main`
- **Branch:** `feature/a-third-connector-needs-no-domain-edit` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 2 of two, and the last. **The plan delivers when this lands.**

### What wave 1 already did

`feature/the-domain-forgets-the-vendor-list` merged as PR #664. After it:

- `packages/domain/src/ports/host.ts` declares `export type HostBackend = string` — the `'github' | 'bitbucket'` union is gone.
- `packages/board/src/server/fleet.ts` contains **zero** `backend === ` expressions.
- Vendor names survive in exactly two files, both under `packages/domain/src/adapters/host/`: `host-shell.ts` (which drives the CLIs) and `host-fixture.ts` (line 90, `fixture.backend ?? 'github'` — a default, not a branch).

**So the type no longer refuses an unknown connector.** That is the property this
slice must prove, and then gate.

### What this branch owns

**A test driving a connector the domain has never heard of.** `host-fixture.ts`
already accepts `backend?: HostBackend`, which is now a `string` — so a fixture
can claim any name without a domain edit. Drive it end to end through the `Host`
port and assert the port answers normally. **Name it something Plot ships no
adapter for** — not `gitlab` either, if a future adapter is plausible; a name
with no roadmap makes the point better.

**The CI grep that keeps it true.** Model it on the purity gate at
`.github/workflows/ci.yml:157`, which greps `packages/domain/src/` and excludes
`packages/domain/src/adapters/`. Same shape, different pattern: no vendor name
outside `adapters/`. **The gate is the deliverable** — without it, *"adding a
connector is an adapter change"* is prose the next enum quietly falsifies.

**The refusal still has to happen.** An unknown backend must fail **in the
adapter**, naming what it could not drive. `host-shell.ts` holds that guard.
Removing the type's refusal moved it; it must not have deleted it. If a test
does not already assert this, add one.

### Done when

- `packages/domain/src/` outside `adapters/` names **no vendor**, asserted by the CI grep rather than by review.
- A connector the domain has never heard of works end to end, and the test names no vendor Plot ships an adapter for.
- An unknown backend still fails in the adapter, with a message naming what it could not drive.
- `fleet.ts` has no `backend === ` expression. (Already true — assert it, do not re-do it.)
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — the root typecheck covers the **board only**.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and the `bumps:` block LAST.

### Scope guard

**It owns** the fixture-connector test, the CI grep, and the adapter-refusal
assertion.

**It does not own** the `HostBackend` widening or the `fleet.ts` call sites —
wave 1 did both, and they are on `main`. If either looks undone, check you are
based on a `main` that contains #664 before changing anything.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here
produced 53 concurrent test processes and a board that could not answer in 25
seconds.
