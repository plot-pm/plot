---
"plot": patch
---

board: the test files that take no port and no browser run in parallel

`vitest.config.ts` set `fileParallelism: false` for every vitest file, and its
comment gave the reason honestly: *"The UI layer boots a server and launches
Chromium — generous timeouts, and no cross-file parallelism so server spawns
don't contend."* That reason is real for the files it describes. The ~50 in
`test/unit` spawn no server and launch no browser, and waited on a constraint
that was not about them.

Two projects now carry the parallelism each half needs, so the suite no longer
takes the stricter of the two.

**Split on the contended RESOURCE, not the directory and not the filename.**
There are exactly two things to contend for — a port and a Chromium process —
and a file that takes neither has nothing to fight over. Measured, the directory
name is wrong in both directions: three files named `.browser.test.ts` start no
server, and three not named `.browser.` (`tiny-garden.data|plan|story`) do. An
earlier cut of this branch keyed the split on the `.browser.` suffix and put
those three port-taking files in the parallel group; `PORT=0` makes that safe
today, but it makes the config's grouping depend on a property of a helper rather
than on the reason the comment states.

| | takes | parallelism |
|---|---|---|
| `parallel` project — `test/unit` | neither | parallel |
| `serial` project — `test/integration` | a port, Chromium, or both | serial |

The four Chromium-without-server files are **not** broken out into a third,
port-free project. Chromium is itself contended and nothing here has measured
how many instances this machine tolerates; a third project would need a
concurrency number, and an unmeasured number is the next unfounded figure.

**The premise is now a gate, not a comment.** The split is only safe because the
parallel group takes neither resource, and that is a claim about the contents of
a directory — exactly the kind a comment cannot keep true. Adding `startServer`
to a file in `test/unit` would not fail; it would make the parallel project
contend for ports intermittently and surface weeks later as an unrelated test
flaking on a busy machine. `parallel-project-takes-no-resource.test.ts` asserts
it instead, names the offending file, and says which project it belongs in.
Verified against a planted violation: exactly the port assertion fails, and it
prints the planted filename. Comments are stripped before matching, following
`no-network.test.ts` — a check that fired on prose would push the next author to
delete the reasoning to go green — and the file excludes itself, because both
markers appear in its own assertion messages.

**`fileParallelism` is honoured per project — verified, not read.** The vitest 4
type declarations put it on the *root* config beside `projects`, which reads like
a global a project cannot override; `maxWorkers: 1` would have been the
workaround for a problem that does not exist. Types cannot distinguish *accepted
and ignored* from *accepted and honoured*, so it was measured: two probe projects
of three 1.2 s-sleeping files each, timestamping every file's start. The parallel
project's three all started at +0 ms and ended together at +1202 ms; the serial
project's started 1.3 s apart, at +1296, +2630, +3911. Vitest also runs the
projects one after another, so the serial project never contends with the
parallel one.

`testTimeout: 30_000` is unchanged in both projects. A browser test that boots a
server needs it, and a unit file that needs 30 s is a separate finding.

**What it buys, and the honest shape of the number.** The plan's open point asks
for an idle-machine measurement before the benefit is quoted. This machine was
never idle — 16 CPUs, load average 7.2–8.0, nine sibling vitest processes from
other agents throughout — so that point stays open and no single percentage here
should be lifted as *the* figure. Four A/B pairs of the same project, each leg
run back to back, only `--fileParallelism` differing:

| pair | serial | parallel | |
|---|---|---|---|
| 1 | 91.0 s | 35.5 s | −61 % |
| 2 | 60.2 s | 41.1 s | −32 % |
| 3 | 85.9 s | 53.0 s | −38 % |
| 4 | 141.7 s | 49.6 s | −65 % |

**The spread is the finding, not an error bar to average away.** The serial leg
swings 60 s → 142 s, a 2.4x range on identical work; the parallel leg stays
inside 35–53 s. Serial wall-clock tracks ambient load almost directly, because
one slow file blocks the queue behind it and nothing else proceeds. Parallel
absorbs the same contention across 16 CPUs.

So the defensible claim is not a percentage but a shape: **parallel is faster in
every pair measured, and it is also far more predictable — and the gap widens
exactly when the machine is busy.** That is when a rebase happens, which is the
case this plan was written for. A reader wanting one number should take the
worst-case pair, −32 %, rather than the best.

**The full `vitest run` moves much less: 779 s → 750 s, −3.7 %.** The serial
project is ~700 s of that total, measured alone, so it dominates the suite and
this change deliberately does not touch it. Anyone quoting the plan's −42 % for
the whole suite is quoting a measurement of the unit half in isolation. Where
this lands is the question a rebase actually asks — *did I break anything that is
not the browser* — which is now a ~40 s answer via `vitest run --project=parallel`.

**The plan's open point is answered, and answering it cost one repair.** *Does
any unit file depend on serial execution for a legitimate reason?* No — but ten
parallel runs found one that depended on it ACCIDENTALLY. `continue-route.test.ts`
asserted `PLOT_CONTINUATION` with `actual: ''`, once in ten: its worker writes the
witness with `>`, which creates and truncates the file before `printf` writes into
it, so a poll on `existsSync` could be satisfied by a file that was real and
still empty. Six serial runs at the same load failed zero times.

Parallelism **surfaced** that rather than causing it — the worker is detached, so
nothing in the test was ever synchronised with its write, and the window existed
at any load. The worker now writes a scratch file and renames it into place, so
the witness name appears only when its content is complete, and the poll waits
for content instead of for a filename. Verified falsifiable before landing: with
the worker reporting a deliberately wrong value, the assertion fails and prints
that value rather than an empty string.

That is the same shape as this plan's wave-1 fix, one level up — an assumption
about timing replaced by an assertion about the thing actually meant. It is also
why *ten consecutive runs* was the right bar: nine would have shipped it.

**Two browser files were already failing before this change**, under the
untouched serial config, and the failing set shifts between runs
(`button-claims`, `stuck-rows`, `start-work-refusal` — 1 to 3 files depending on
load). They fail on a config this branch does not alter, in files it does not
touch; the before-measurement is what establishes that, rather than the parallel
switch being blamed for surfacing them.
