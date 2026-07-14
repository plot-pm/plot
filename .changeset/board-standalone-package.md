---
"@plot-pm/board": patch
---

`@plot-pm/board` is now a self-contained npm package. It vendors Plot's plan-parser scripts (`plot-config.sh`, `plot-plan-meta.sh`) into the published tarball and bundles `zod`, so it declares zero runtime dependencies. You can now install and run the board with `npx @plot-pm/board` or `pnpm dlx @plot-pm/board` in any repository — including one pointed at a private or authenticated registry — instead of only from a Plot checkout.
