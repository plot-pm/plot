# Implementation brief — production-calls (Spawning the tools)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/one-place-reaches-a-process` (base: `main`)
- **Ends as:** one PR to main
- **Gated with the plan**, and **depends on `one-place-reaches-a-script`** —
  same files, and the script calls should be gone before the tool calls move.

### What to build

The remaining direct calls — `git`, `ps`, and **one `tailscale`** — move behind
the `Refs`, `Processes` and `Machine` adapters.

**The tailscale call is at `server/index.ts:800`:**

```ts
const tsIp = execFileSync('tailscale', ['ip', '-4'], …)
```

A foreign process invoked straight from a route handler — the clearest single
breach of the layering rule in the codebase.

### Why this is split from the script slice

**Measured 2026-08-30: 51 call sites across 22 files, with 54 test files
touching spawning.** That is larger than the Deciding slice the sandbox plan
split for the same reason, and **this story exists because agents stall on
branches that size** — seven hit their bound in one day.

**And the two halves adopt different contracts.** `runScript()` maps exit codes
for scripts Plot owns; `Refs` and `Processes` wrap tools that answer to nobody
here. Mixing them in one branch means a reviewer cannot tell which contract a
call site now follows.

### Done when

- **no `spawn`/`execFile` remains in `packages/board/src`** outside what the
  adapters own — 65 lines across 23 files today
- `git` goes through `Refs` or `Trees`, `ps` through `Processes`, `tailscale`
  through `Machine`
- the board and browser suites pass **unedited**

**Expect this to be the slowest slice in the plan.** 54 test files touch
spawning; many stub a command by name and will need the adapter's seam instead.
**If a test cannot be moved without changing what it asserts, that is a finding**
— report it rather than weakening the assertion.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`,
`pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`), artifact rebuilt, changeset.

### Scope guard

`git`, `ps`, `tailscale`. Not `plot-*.sh` (previous slice), not the rules.

**`Machine` already has an adapter** — `machine-system.ts` times forks with
`git rev-parse`. The `tailscale` call is a **hostname/address question**, which
is `Machine`'s territory but not an operation it declares today. **Adding one
operation is in scope; redesigning the port is not.**
