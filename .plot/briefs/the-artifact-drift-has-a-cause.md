# Implementation brief — the-artifact-builds-the-same-everywhere (Measuring)

- **Plan (canonical):** `docs/plans/2026-08-29-the-artifact-builds-the-same-everywhere.md` on main
- **Branch:** `infra/the-artifact-drift-has-a-cause` (base: `main`)
- **Ends as:** one PR to main
- **The plan's only slice.** Its Fixing branch was withdrawn on 2026-08-29 —
  a remedy needs a mechanism, and this slice may conclude there is nothing to fix.

### What to build

A written finding that names what varies, **or states that nothing does**. Both
close the plan. Only an unmeasured cause leaves it open.

### Four candidates are already eliminated — do not re-run them

| candidate | how it died |
|---|---|
| **the path** | two checkouts at different path lengths, full build, byte-identical (`d8ca6bf7`, three runs) |
| **a stale `dist/client`** | the diff was **two minifier identifiers**; 582 KB of embedded HTML cannot survive as `oj`→`lj` |
| **the platform** | 40 CI runs on 2026-08-30, zero staleness failures. Every committed artifact is built on macOS and verified on Linux — a systematic divergence would fail *every* PR |
| **`node_modules`** | main and a worktree compared 2026-08-30: 265 packages each, **identical listings**, esbuild 0.28.1 both |

**The morning's path result is narrower than it reads**, and the brief says so
because it would otherwise mislead you: that A/B symlinked one tree's modules
into both, so it showed *the path does not matter when the modules are shared*.
The separate `node_modules` comparison above is what closes that gap.

### What is left

**Time.** The same configuration produced different short names on different
days, at the same path, with the same modules. That is the only variable nobody
has held constant.

**A concrete experiment:** build, wait, build again in the same tree without
touching anything. If the hashes diverge, the cause is inside the toolchain and
reproducible on demand. If they do not, the difference lives in something the
worker's environment had and a later shell did not — and `env` diffing between a
worker and an interactive build is the next probe.

### What it cost, so you know what a negative result is worth

**Two round trips in two days.** #533 and #540 were both rejected by CI's
freshness gate for a two-identifier diff, and both were fixed by a hand-committed
rebuild. On 2026-08-30 the artifact rebuilt three times in one worktree gave one
hash every time — so it is stable *at a path*, and unstable *across occasions*.

### Done when

- **the finding names what varied, with the two values it took — or states that
  no reproduction was found and the drift is not currently observable**
- **every command in it carries its control**: a mutation that moves the hash,
  so a reader can tell a real comparison from two builds that never ran

**That second one is not ceremony.** Three A/B runs on 2026-08-30 returned
"identical" and two of them were measuring nothing: one suppressed a failing
`node build.mjs`, the other used `const x = "probe"; void x;` as its mutant —
exactly what a minifier deletes. Only a `console.log` that survives minification
made the negative result mean anything.

**A negative result is a finished slice.** Say so plainly in the PR; do not
invent a cause to have something to fix.

Plus: no code change is expected. If you do change `build.mjs`, the plan's other
done-whens apply — the gate stays unchanged, and any size change is stated with
its number.

### Scope guard

The measurement. **Not the gate** (`Board build + artifact freshness` in CI is
right to reject a stale artifact), and not a remedy — the Fixing branch was
withdrawn deliberately and stays withdrawn until this slice names a mechanism.
