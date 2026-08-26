---
"@plot-pm/board": patch
---

The Master Agent row names the branch the board is serving again. `fleet.ts`
reached for `child_process` with a dynamic `require` inside the ESM board
bundle, where the bundler's shim throws `Dynamic require of "node:child_process"
is not supported` on every call. `mainCheckoutPath` threw first and returned
`null`, so `readMasterAgentBranch` never ran its own `require` and returned `''`
— indistinguishable from a detached HEAD, which the renderer shows as no row.

Both call sites now use the static `execFileSync` import the rest of the module
already carries, and the two bare `catch { branch = '' }` blocks are narrowed:
git *failing to run* is logged before it collapses to `''`, so it can no longer
masquerade as a legitimate empty branch the way it did here.
