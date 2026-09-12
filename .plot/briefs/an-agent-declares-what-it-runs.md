## Implementation brief — an-agent-declares-what-it-runs

- **Plan (canonical):** `docs/plans/2026-09-12-an-agent-declares-what-it-runs.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/an-agent-declares-what-it-runs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

The plan has one wave holding one branch, so nothing waits on this and it waits on nothing. The sibling plan [a-charter-bounds-what-an-agent-may-touch](../../docs/plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) is also Approved and edits the same entity file — see **Scope guard**.

### What to build

A charter's `harness`, `model` and `effort` must reach the process that launches an agent, so two agents in one fleet can run different CLIs, models or reasoning efforts.

The concrete failure: **four charter fields are declared and nothing reads them.** Readers of `harness`, `model`, `effort`, `capabilities`: 0, 0, 0, 0. Charters on the estate: 0. Meanwhile `plot-dispatch.sh:749` reads one `Worker command` key and hands the identical command line to every dispatched agent.

Re-verified on this branch's base 2026-09-12. Reproduce it with the *discriminating* query, not a bare word grep — `model` alone returns 102 hits, almost all of them Model Guidance tables:

```
grep -rn 'charter\.\(harness\|model\|effort\|capabilities\)\|\.harness\b\|\.effort\b' \
  packages/domain/src packages/board/src skills/plot/scripts | grep -v entities/charter.ts
grep -rn 'PLOT_HARNESS\|PLOT_MODEL\|PLOT_EFFORT\|PLOT_CAPABILITIES' packages skills
```

Both return nothing. The second is the one to re-run when you think you are done.

The prompt half is already wired and is the shape to copy, not to reinvent: `resolve_prompt_file` (`plot-worker-loop.sh:940`) asks `board/plot-prompt.mjs`, which asks `resolvePrompt`, which reads a `CharterReading`. This slice does the same one field over.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**A charter names a harness; it never carries a command line.** A charter holding `agent --model gemini-3.1-pro --skill natural-language` would put a vendor invocation into a file the domain parses, which is exactly what `RUN_FACTS` (`charter.ts:36`) exists to keep out. The harness names a prompt file and the **prompt file holds the invocation** — the contract `.plot/worker-prompt.sh` already fulfils: *"Plot exports the variables and cannot write the invocation."* Plot exports `PLOT_HARNESS`, `PLOT_MODEL`, `PLOT_EFFORT`; the prompt file interpolates whichever it needs.

**A missing harness refuses; it does not fall back.** The measurement is `resolve_prompt_file`'s own, one field over: a fallback *runs, successfully,* under an invocation the operator did not ask for, and nothing in `.plot-worker.log` says so. A natural-language agent silently launched on the repo's default harness produces work that looks finished and was done by the wrong worker. Refuse **at launch, before the desk is touched**, so the slice stays claimable by an agent that can run it.

**No harness enum, and no vendor list.** `harness` is `z.string()` deliberately. This repo has already paid for the opposite choice once: `ports/host.ts:15` opened `HostBackend = string` while the adapter kept a closed `DRIVES = ['github','bitbucket']` list and threw on anything else, so the port was open and adding a third host still was not an adapter-only change. An enum here is that trap on a newer field.

> **The example has since been repaired and the plan cites it in the present tense.** Measured on this branch's base: `grep -rn DRIVES packages/domain/src packages/board/src` returns nothing — the second slice of `the-build-pipeline-is-its-own-connector` removed the closed list, and `host-shell.ts` moved to `adapters/host/`. The argument is unaffected; do not go looking for a `DRIVES` constant to point at.

**Nothing on the estate changes until a charter exists.** Zero charters exist (`.plot/charters/` is not present on main). An agent with no charter exports none of the three variables and behaves exactly as today. This is the property `resolve_prompt_file` already holds and the one that makes the slice safe to merge.

#### Two findings from the base, measured on this branch — read these before you start

**1. Nothing sets `PLOT_AGENT`.** The plan's step 1 says *"`PLOT_AGENT` names a charter, or it does not"* — but on current main no code assigns it. `grep -rn 'PLOT_AGENT[^_A-Z]' skills packages scripts` returns four comment/usage lines in `plot-worker-loop.sh`, one schema constant in `charter.ts:27`, and **no assignment anywhere**. The variable is read by the worker loop from its own inherited environment, and only an operator setting it by hand supplies it today.

Beware the false positive: a bare `grep -rn PLOT_AGENT` also matches `PLOT_AGENT_MONITOR`, a *different* variable that `start_worker` does export (`plot-dispatch.sh:1023`). That match makes the threading look done when it is not. Use the whole-word grep above.

So `start_worker` cannot resolve a charter until something tells it which agent it is launching. Decide where that comes from and say so in the PR body — plumbing it through `start_worker`'s environment is in scope; inventing a *matcher* that picks an agent for a slice is not (`prompt.ts`: *"RESOLUTION, NEVER MATCHING … choosing is a question declaring makes askable and does not answer"*).

**2. The resolution and the launch are in two different processes.** `resolve_prompt_file` runs inside `plot-worker-loop.sh`, after dispatch, in the worker. `start_worker` is in the dispatcher and runs before the worker exists. The plan asks `start_worker` to resolve the charter *before* it resolves `Worker command`. Both are defensible places for the three exports; they differ in when the refusal fires, and the plan is explicit that it must fire **before the desk is touched**, which points at the dispatcher. If you find the worker-loop side is the only workable seam, that is a plan finding — report it, do not quietly relocate the refusal.

#### Rules carried over unchanged

- **A bundle that cannot be asked is not a refusal.** `plot-prompt.mjs` missing means a broken Plot installation, not a statement about this agent — fall back and *say you could not ask*. `plot-worker-loop.sh:949` is the wording; `plot-dispatch.sh:1502` is the idiom.
- **Absent is not unreadable.** `CharterReading` has four arms for a reason (`charter.ts:169`): `absent` is no charter and means the fallback is right; `unreadable` is a file that exists and cannot be believed and must refuse. Collapsing them reintroduces the silent-wrong-prompt bug.
- **Import through the narrow path, never the package root.** `entry/prompt.ts:6` imports `@plot-pm/domain/entities/charter`, not `@plot-pm/domain`. Measured 2026-09-03: the root import produced a 334 KB artifact against `plot-movable.mjs`'s 1.2 KB — the whole domain on every worker's launch path.
- **Tab-separated out, not JSON.** The caller is bash reading one line; JSON means a `jq` dependency on the launch path (`entry/prompt.ts`).
- **Arrow functions** in `packages/domain/**` and in any function you write or rewrite. The unit is the function, not the file.

### Done when

**The plan carries no `## Done when` section** — its sections are Status, Changelog, Motivation, Design, Slices, Notes. The specification is the slice sentence under `## Slices`, and it is the whole scope:

> Charter resolution in `start_worker` before `Worker command`, the three exports, and the refusal when the declared harness is absent.

Read with the Changelog entry, which is what ships: *"A charter's `harness`, `model` and `effort` reach the launch: an agent may run a different CLI, model or reasoning effort from its siblings in the same fleet."*

**Two Open Questions are deliberately unanswered — leave them that way.** The plan parks whether `effort` belongs on the charter or the slice (charter for now, because nothing reads it either way and moving it later is a schema change with no callers), and whether a charter may override `Worker bound` (out of scope; `bounds` already carries a context ceiling and a second bound belongs with it). Neither is yours to settle in this slice.

Lift these assertions, because a naive implementation passes without them:

- **An agent with no charter exports none of the three, and its command line is byte-identical to today's.** This is the regression lock for the whole estate — zero charters exist, so this is the path every current worker takes. Without it, a green suite proves nothing about the 100% case.
- **A charter naming an absent harness refuses, and the desk is untouched.** Assert both halves: the non-zero outcome *and* that no worktree/claim side effect happened. A test asserting only the refusal passes an implementation that refuses after cutting the desk, which is the thing the plan says not to build.
- **The refusal names what it looked for.** `resolve_prompt_file`'s refusal (`plot-worker-loop.sh:957-962`) prints the charter path and the remedy; a refusal reading only "could not start" sends the operator nowhere. Catches a bare non-zero return.
- **`unreadable` refuses and `absent` falls back.** The two must not collapse. Catches an implementation that treats every failed read alike.
- **A charter declaring only `model` exports `PLOT_MODEL` and leaves the other two empty.** Catches an all-or-nothing resolution that requires `harness` before it exports anything.

Existing tests to extend rather than duplicate: `packages/domain/test/charter.test.ts` for the entity, `test/reconcile/prompt-resolution.test.mjs` for the shell arms. The latter's `sandbox()` helper already writes four charters and sources the loop under `PLOT_WORKER_LOOP_SOURCED` — follow that idiom (exercise the function directly; do not drive a launch).

Plus the repo's gates:

- `nvm use` first — Node 24. **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`.
- `pnpm run test:board` if you touch `packages/board/**` — it rebuilds the artifact. **`plot-prompt.mjs` is a built artifact**: changing `entry/prompt.ts` requires `pnpm build:board` and the regenerated bundle must be committed, or the shell keeps calling the old rule. From `packages/board/` the command is `pnpm build`.
- **Do not run `pnpm run test:e2e`.** It is CI's gate. It dispatches real workers into sandbox repos; measured 2026-08-31, two agents running it produced 53 concurrent `node --test` processes and took an operator's board down.
- A changeset is required. Description **first**, `bumps:` block **last** — a `bumps:` block written first becomes the published release note. Package name must be `plot` or `@plot-pm/board`. Name the plan on a `plan:` line in the same block.

### Bookkeeping

- **Open the PR through the controller:** `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is moving). It takes the title from the plan's wave heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which here is routinely `plot: build the board artifact`.
- **Append `→ #<number>`** to this branch's line in the plan's `## Branches` section as soon as the PR exists.
- **Push the first real commit as soon as it exists.** Measured on this estate: two implemented, green branches whose work was never pushed read as `eligible` to the fleet, because no claim existed.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-dispatch.sh` — `start_worker` and its environment block
- `skills/plot/scripts/plot-worker-loop.sh` — only if the seam proves to be worker-side; say so in the PR
- `packages/board/src/server/entry/prompt.ts` and its rebuilt `skills/plot/scripts/board/plot-prompt.mjs`
- `packages/domain/src/rules/prompt.ts`
- tests in `packages/domain/test/` and `test/reconcile/`

**`packages/domain/src/entities/charter.ts` is shared with an Approved sibling.** [a-charter-bounds-what-an-agent-may-touch](../../docs/plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) wires `capabilities`, the fourth field of the same schema, and its branch `feature/a-charter-bounds-what-an-agent-may-touch` is not yet cut. The four fields already exist in `CharterSchema` — **neither slice needs to add one**, so if you find yourself editing that schema, stop and ask why. Touch `charter.ts` only if a reading the rule needs is genuinely absent, and keep the edit to the function you are writing.

Verified at dispatch: `origin` holds only `main` and `changeset-release/main`. No other slice is in flight, so nothing else is moving under you right now.

If you find something the plan did not anticipate — in particular either finding above — report it rather than improvising outside scope.
