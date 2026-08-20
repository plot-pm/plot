---
"plot": patch
---

board: the 51 non-browser test files run in parallel, and the 20 browser files still do not

`vitest.config.ts` set `fileParallelism: false` for all 71 files, and its comment
gave the reason honestly: *"The UI layer boots a server and launches Chromium —
generous timeouts, and no cross-file parallelism so server spawns don't
contend."* That reason is real and it applies to 20 files. The other 51 spawned
no browser and waited on a constraint that was not about them.

Two projects now carry the parallelism each half needs, so the suite no longer
takes the stricter of the two.

**The split is by browser, not by directory.** The plan proposed splitting
`test/unit` from `test/integration`; measured, that is the wrong seam. The 20
files that launch Chromium are marked by a `.browser.test.ts` suffix and all
live *inside* `test/integration/`, alongside three `tiny-garden.*.test.ts`
data-layer files that spawn the built artifact and no browser. Splitting by
directory would have serialised those three for a cost they do not carry.

**The three server-spawning files are safe on the parallel side, and the config
comment is why.** It named two costs — booting a server *and* launching Chromium
— and only the second one contends. `test/helpers.mjs` starts every board with
`PORT=0`, so the OS assigns during the server's own `listen()`; there is no
window where a port is known-free but unbound, and concurrent spawns cannot
collide. That is a property the helper documents at length, having been written
to fix exactly this.

| | files | parallelism |
|---|---|---|
| `unit` project | 51 | parallel |
| `browser` project | 20 | serial |

**`fileParallelism` is honoured per project — verified, not read.** The vitest 4
type declarations put it on the *root* config next to `projects`, which reads
like a global that a project cannot override; `maxWorkers: 1` would have been
the workaround. Types cannot distinguish *accepted and ignored* from *accepted
and honoured*, so it was measured instead: two probe projects of three
1.2 s-sleeping files each, timestamping every file's start. The parallel
project's three files all started at +0 ms and ended together at +1202 ms; the
serial project's started 1.3 s apart, at +1296, +2630, +3911. Vitest also runs
the projects one after another, so the browser project never contends with the
parallel one — the isolation is stronger than a shared pool would give.

`testTimeout: 30_000` is unchanged in both projects. A browser test that boots a
server needs it, and a unit file that needs 30 s is a separate finding.

**What it buys, measured on one machine at one commit.** The 51 files, run as
their own project, with only `--fileParallelism` differing:

| the 51 non-browser files | duration | vitest's own accounting |
|---|---|---|
| serial (the old behaviour) | **91.0 s** | `tests 84.7 s` |
| parallel (this change) | **35.5 s** | `tests 191.4 s` inside `Duration 35.5 s` |

**−61 %, and a 5.4x compression** of test time into wall clock. That is better
than the 42 % the plan projected off its 43 s/25 s measurement.

**The full suite moves far less, and the reason is worth recording: 779 s to
750 s, −3.7 %.** The 55 s this saves is real, but it is spent against a serial
browser tail that dominates the total — the 20 Chromium files are the overwhelming
majority of `vitest run`'s wall clock, and this change deliberately does not touch
them. Anyone reading the plan's *−42 %* and expecting the whole suite to drop by
that much should read it as what it measured: the unit half in isolation.

So the win lands where rebases actually pay it. `vitest run --project=unit` is
now a 35 s answer to *did I break anything that is not the browser*, which is the
question a rebase asks; the 8-minute figure that motivated the plan is a browser
cost, and reducing it is not this branch.

**Two browser files were already failing before this change**, under the
untouched serial config: `button-claims.browser.test.ts` and
`stuck-rows.browser.test.ts` (4 tests). They fail for reasons this branch does
not touch — it changes one config file and no source — and the before-measurement
is what establishes that, rather than the parallel switch being blamed for
finding them.
