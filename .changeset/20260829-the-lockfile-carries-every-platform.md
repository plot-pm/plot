---
'plot': patch
---

Restore the native platform bindings to `pnpm-lock.yaml`, and stop them being
dropped again.

`363f706d` removed 731 lines from the lockfile — all 90 platform entries for
esbuild, rolldown, tailwindcss and lightningcss, plus their WASM fallback
runtimes. Every Linux runner then failed at install:

    Cannot find module '@rolldown/binding-linux-x64-gnu'

`main`, three open PRs and the release job went red together, and nothing in
any of them was wrong: the lockfile simply no longer described their runner.

These packages ship one OPTIONAL dependency per platform, and pnpm locks only
the platforms it resolves. Left implicit, that is whichever machine ran the
install — so a lockfile written on a Mac cannot serve CI on linux-x64.

`pnpm-workspace.yaml` now names the architectures explicitly, which keeps every
platform's binary in the lockfile whatever machine writes it.

The lockfile itself is restored to its state before that commit rather than
regenerated: regenerating needs credentials for a private registry, and a fresh
resolution could differ in ways unrelated to the defect. The package set is
identical to the last known-good lockfile, verified name by name.
