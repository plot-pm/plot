---
"@plot-pm/board": patch
---

infra: Node 24 everywhere, declared where a tool will read it

The repo pinned nothing: no `.nvmrc`, no `engines` block, and CI validating on
**20** while the release workflow built on **24**. So the gate was not testing
the version that ships, and every fresh shell picked up whatever `nvm` had
last — which on this machine is **26**, where `pnpm` crashes outright.

The failure mode is what makes it worth fixing rather than remembering: a
background job under Node 26 exits having written a zero-byte log, which reads
exactly like a hung test run. Diagnosing that costs more than the version
mismatch ever does.

Now: `.nvmrc` at 24, `engines: { node: ">=24" }` in both `package.json` files
so a wrong interpreter is refused by the tool rather than discovered later, CI
raised 20 → 24, and CLAUDE.md's Testing section leads with `nvm use`.

Verified on 24 before raising CI, running the same steps the workflow does:
`pnpm test`, `pnpm run validate`, `test:reconcile` (606/606), `test:e2e`
(15/15), `typecheck` clean.

<!--
bumps:
  skills:
    plot: patch
-->
