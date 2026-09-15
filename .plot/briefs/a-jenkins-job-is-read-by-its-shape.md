## Implementation brief — a-jenkins-job-is-read-by-its-shape

- **Plan (canonical):** `docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `bug/a-jenkins-job-is-read-by-its-shape` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

A plain Jenkins pipeline reports `failed` today, and `failed` is the word for an unreachable host. Measured live 2026-09-15 on `Quatico.Webseite/quaweb-website`: `jen job list quaweb/continuous-deploy --json` returns **`null`**, while `jen job view quaweb/continuous-deploy --json` returns `color blue`, `lastBuild #938 SUCCESS`, `duration 453365ms`. The job is healthy, signed in, and correctly declared — and the board says the connector cannot be asked.

The cause is one verb. `job list` enumerates a **container's children**: a `WorkflowMultiBranchProject` has one child per branch, so the call yields the branch→colour map Plot renders today; a plain `WorkflowJob` has no children, so the same call yields `null`. `jenkins_build_map` at `plot-host.sh:756` makes that one call and `:757` refuses anything that is not a JSON array. `plot-host.sh` never calls `job view` — zero occurrences.

Decide the configured job's shape, then read a `WorkflowJob` through `jen job view` while leaving the multibranch path byte-identical. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The shape is NOT read from `job list`'s entries.** This is the sentence that sank an earlier draft of this very plan, and it is the one way to ship a green suite over a broken reader. `job list <container>` returns children, and a child's `_class` describes *the child*: measured live, every child of the multibranch `quaweb/continuous-build` carries `...job.WorkflowJob`, and this repository's own fixture agrees — `test/reconcile/host.test.mjs:1504-1509` gives all five children of a multibranch container `_class: ...job.WorkflowJob`. **Reading `.[0]._class` therefore reads a healthy multibranch job as plain**, routes it to `job view`, and breaks the CI half that works today. The deciding `_class` is the **configured job's own**, and it lives one level up — reachable by a `job list` on the parent path (`Jenkins instance` already carries `<slug>/<job-path>`, so the parent is that path minus its last segment), or by `job view` on the job itself, which returns the job's own `_class` directly. `job view` answers shape and state in one call.

**The jen stub is verb-blind, and that is the trap.** `makeJenStub()` at `test/reconcile/host.test.mjs:1447-1466` branches on `group == "job"` and never inspects the subcommand, so today `job list` and `job view` return the same array. An implementation calling neither verb is indistinguishable from one calling both. **Teach the stub the difference before trusting any assertion about which verb ran.**

**Assert the verb on `jen.calls`, never with `grep -c 'job view'` over the source.** A grep on source is satisfied by a comment. The stub already appends every invocation to `jen.calls`; that file is the behavioural record.

**Assert the call count on TOTAL `jen` invocations, not on `'job list'`.** Five existing assertions filter on the literal string `'job list'` — `host.test.mjs:1617`, `:1630`, `:1691`, `:1733`, `:1813` — and every one is blind to a `job view` call. **All five are yours to edit.** Left as they are, a per-branch `job view` storm against Jenkins' declared limit of 60 passes them all. The one-call-per-refresh property exists so the 5s pulse pays Jenkins once per refresh rather than once per branch (`host.test.mjs:1609-1618` states it).

**`unknown` is not `failed`, and the distinction is the whole point.** A job whose `_class` is neither recognised shape reports **`unknown`** — *a shape nobody measured*. `failed` claims the host did not answer, which is the exact lie this plan removes. Exactly two shapes are read: `WorkflowMultiBranchProject` and `WorkflowJob`. A `FreeStyleProject` has a `color` and would be readable; it still reports `unknown` rather than being guessed at.

**`run-for-sha` is deliberately out of scope.** `plot-host.sh:3124` faces the same multibranch-or-plain question and solves it by trying the multibranch URL first and falling back to the plain one, costing one 404 on a plain job. It reaches Jenkins by `curl` against REST with a keychain credential, not through `jen`, and answers *per sha* where this answers *per branch*. After this lands the file holds two mechanisms for one question — a real cost the plan states rather than hides. Unifying them is an improvement to a working path, not a fix to a broken one, and would put a REST caller and a `jen` caller in one change. **Do not touch it.**

**Rules carried over unchanged.** `jen` exits 0 even when Jenkins is unreachable, so the exit code is worthless and the `Jenkins auth:` line is the only witness (`plot-host.sh:735-750`); `NOT reachable` is tested before `reachable` because it contains it; an unrecognised auth line degrades to `unknown`, never to `ok`. Absent is not false: `disabled` and absent both map to `none`, not to a failure.

### Done when

The plan's `## Done when` list is the specification — read it in full at `docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md`. These exist because a naive implementation passes without them:

- **A multibranch container whose children all carry `...job.WorkflowJob` is still read as multibranch.** Catches the shape read off the wrong object — the single most likely defect, and invisible to every other gate.
- **The stub tells `job list` from `job view`.** Catches an implementation that calls the wrong verb, or neither, while the suite stays green.
- **The call count is asserted on total `jen` invocations.** Catches a per-branch `job view` storm that the five `'job list'` filters cannot see.
- **The `runs` op emits a line for a plain job rather than exiting 4.** `plot-host.sh:3027` reads `.map[$branch]` and a plain job has no branch key — without this gate every other gate passes while the port still answers `unaskable`. Exit 4 becomes `unaskable` with `refusal: null` at `packages/domain/src/adapters/build/build-shell.ts:130-145` (note: one directory deeper than the plan's path), which deliberately discards the retry signal.
- **The multibranch branch→checks map is byte-identical**, pinned by capturing `jenkins_build_map`'s stdout on `origin/main` as a **golden string**. "Byte-identical" is a claim about bytes, so compare bytes rather than fixtures.
- **The plain-job fixture holds raw `--json` stdout captured verbatim**, annotated with instance and date — the habit `plot-host.sh:741` already models. Not a two-field summary: `color` and `lastBuild.result` are not structurally consistent.
- An unreachable Jenkins still reports `failed`; an unrecognised auth line still reports `unknown`.

Plus the repo gates: `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`, and a changeset. Run `nvm use` first — Node 24 per `.nvmrc`; pnpm crashes on Node 26. **Do not run `pnpm run test:e2e`** — that is CI's gate, not a local one.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

A changeset is required — this changes `skills/plot/scripts/plot-host.sh`, so it names the `plot` package with a `bumps:` block for the `plot` skill. Description first, `bumps:` block last: a `bumps:` block written first becomes the published release note.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (the `jenkins_build_map` function and the `runs` op's Jenkins arm) and `test/reconcile/host.test.mjs`.

Three commits landed on `plot-host.sh` since this plan was written — `33969cb2c`, `697572666`, `f608528c0` — all in backend resolution upstream of `jenkins_build_map`. Verified 2026-09-15: every line number the plan cites still resolves (756, 2718, 3024, 3124). Rebase before assuming otherwise.

Do not touch `run-for-sha` (`plot-host.sh:3124+`), the colour table, the branch-name URL-decoding, any board rendering, or any config key. **This plan makes a reading possible; it does not decide where that reading appears, and it adds no key naming a deploy job.** A plan that did both carried the destination problem that sank its predecessor.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
