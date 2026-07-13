# Plot board — shipped artifact

`board-server.mjs` is a **built artifact**, not source. Do not edit it by hand.

- **Source:** [`packages/board`](../../../../packages/board) (`@plot-pm/board`) — vite + react + shadcn + zod.
- **Built by:** `pnpm build:board` (vite builds the client, esbuild bundles the
  server with the client HTML inlined, then copies the single self-contained
  file here). The build is deterministic; CI rebuilds and byte-diffs this file
  to catch a stale check-in.
- **Run:** `pnpm board` (from the repo root) → http://localhost:7777, or
  `node skills/plot/scripts/board/board-server.mjs` directly. Node ≥ 20, plus
  `bash` and Plot's sibling helper scripts (`../plot-plan-meta.sh`,
  `../plot-config.sh`), which it uses to read plans — it never parses plan files
  itself.

Regenerate after changing anything under `packages/board`:

```bash
pnpm build:board   # rebuilds and refreshes this file
```
