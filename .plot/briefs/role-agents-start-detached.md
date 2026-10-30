## Implementation brief — fleet-roles-are-declared-agents (wave 4: Detached role start)

- **Plan (canonical):** [docs/plans/2026-10-29-fleet-roles-are-declared-agents.md](../../docs/plans/2026-10-29-fleet-roles-are-declared-agents.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2908 merged
- **Branch:** `feature/role-agents-start-detached` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review GitHub App (required on `main` since 2026-10-15)

This branch waits on `feature/role-agent-definitions` (wave 3, issue #2946): the
four `.claude/agents/*.md` files and their per-role settings files must exist
on `main` before this slice's command builder can point at them. As of this
brief, neither `feature/role-agent-definitions` nor its own predecessor
`feature/role-agents-are-probed` has a remote ref yet — `git ls-remote
--heads origin` shows neither branch. Do not claim this branch until wave 3
has merged; `/plot-pulse` or `plot-fleet-scan.sh --next` will not offer it
before then.

### What to build

Three things, read together as one seam: the command a role run issues, a
way to tell whether that run is still alive, and the second runner adapter
catching up to the first.

1. **A domain command builder beside `reviewerCommand`** (`packages/domain/src/rules/review-verdict.ts:157`) that, given a declared role name, adds `--agent <role>`, `--agents <file>` and `--settings <file>` to the shell fragment `agentRunCommand` runs. `agentRunCommand` itself (`packages/domain/src/adapters/agent-run/agent-run-command.ts`) stays fragment-agnostic — it does not interpret `request.model`/`request.effort` today and must not grow a case for `--agent` either; the new flags belong in the fragment a role's command builder *constructs*, not in the generic runner.
2. **A liveness reading for a role run** — something that answers "is the process behind this role run still alive," in the shape of the plan's four roles: reviewer and main-repair run detached in their own worktree, fixer runs on the PR's own branch, unblocker runs read-only with no worktree.
3. **Both runner adapters accept the role-command path.** `agentRunCommand` (the `command` adapter) runs whatever fragment it's given, so once the command builder emits `--agent`/`--agents`/`--settings`, that adapter needs no further change — verify this holds rather than assuming it. `agentRunSdk` (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts`) maps the same role reading to its own SDK options (`agentDefinitions`, `settingSources`, etc.), or refuses a role it cannot load from the default branch — it must not silently fall back to running the role as a plain prompt.

### Decisions already settled — do not re-derive them

**The role goes in a dedicated request field, never `AgentRunRequest.role`.** `role` already exists and is load-bearing elsewhere: `agentRunSdk`'s `handBackProtocolFor(request.role)` (`agent-run-sdk.ts:150-151`) switches hand-back parsing on it — `'worker'` gets the `{ next, summary }` shape, every other value gets the board role's written/outcome shape (`boardHandBackKind`). A role agent (reviewer, fixer, unblocker, main-repair) is not a board role in that sense and must not be forced through `boardHandBackKind`'s schema. The plan's Design section says this explicitly: "a declared role name in a dedicated request field, not `role`." Add a new field; do not repurpose the existing one.

**`--agents <file>` takes a JSON object, not a `.claude/agents/*.md` frontmatter file — confirmed by probe, not assumed.** Slice 1's probe (plan § "Probe result", point 1) measured `claude --agents <file>` against the SDK's actual contract: it wants JSON with keys `description`, `prompt`, `tools`, `disallowedTools`, `model`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `autoCompactWindow`, `skills`, `memory`, `effort`, `background`, `omitClaudeMd`, `isolation`, `initialPrompt`. There is no `.md`-with-frontmatter form for this flag; `.claude/agents/<name>.md` (the file wave 3 writes, per D5) is a *source* document this builder's caller reads and translates into that JSON shape before passing `--agents <file>` — it is not passed through verbatim. If wave 3 already does that translation and hands this slice a ready-made JSON path, say so in your own notes; if not, this slice owns writing it.

**`maxTurns` in the `--agents` JSON does NOT bound a `--agent`-selected top-level run — refuted by the probe, twice.** Slice 1's probe point 3: a `probe-maxturns` definition with `"maxTurns": 1` ran to 4 and 6 turns respectively, completing its full task both times. The SDK's per-agent `maxTurns` bounds a *subagent* a running session spawns, not the session's own top-level identity selected via `--agent`. The plan leaves this **open for this slice** to resolve: either use the session-level `--max-turns <n>` CLI flag (confirmed to exist, separate from the per-agent field), or dispatch the role as a subagent of a thin wrapper session. Pick one and say which, with the measurement that drove the choice — do not assume the frontmatter's `maxTurns` field does the bounding, because the probe already showed it does not.

**`memory: local` writes INSIDE the run's own tree, not outside it — also refuted by the probe.** Slice 1's probe point 4: `memory: local` wrote to `<cwd>/.claude/agent-memory-local/<agent-name>/MEMORY.md` — inside the run's own working directory. For fixer or main-repair, whose tree is the PR's own checkout, that means `memory: local` would write into the reviewed/fixed tree itself, which is backwards from what the design wants (gates deny edits to `.claude/**`, and a memory write there would collide with that denial or leak into the diff). The plan leaves this **open for this slice**: either confirm `memory: user` (`~/.claude/agent-memory/<name>/`, outside every run's tree, cross-run) is what the four definitions should declare instead of `local`, or confirm the definitions declare no `memory` field at all until a tree-external option is verified. This is wave 3's file content to fix, but this slice's runner-adapter work is what will surface the problem if wave 3 shipped `memory: local` unchanged — check it.

**No role calls `merge` or `restart`.** The plan's Role definitions table gives fixer commit rights on the PR's branch, main-repair a fix-PR, and unblocker only an answer handed to `continue` by fleetd — never by the role itself. This slice's liveness reading and command builder carry no path to those two controllers; if the design tempts you to wire a role's hand-back directly into `restart` or `merge` for convenience, stop — that is explicitly fleetd's job, done in-process with `caller: 'fleetd'` (wave 2, `feature/unattended-callers-are-refused`), not this slice's.

**"The start does not hold fleetd's tick."** Starting a role run must be async/non-blocking from fleetd's scan loop's perspective — the same shape `detachedNode` (`packages/domain/src/adapters/detached/detached-node.ts`) already uses for a fire-and-forget spawn with `detached: true` and `child.unref()`. The liveness reading is what lets a later tick check on a role run without having awaited its completion on this tick. Follow `desk-loop-alive.ts`'s existing shape for the asymmetric-risk read: there, a wrong "not alive" starts a second worker beside a live one (the harm this rule exists to prevent), so an unanswerable pid check reads as alive, not as not-alive. Work out which direction the error should bias for a role run specifically — the roles have different blast radii (reviewer writes nothing; fixer commits to the PR branch; main-repair can open a fix PR) — and say which bias you chose and why.

### Done when

The plan's `## Done when` is not written as a separate section in this plan — read the Design section (§ "Role start") and the Decisions list (D1, D5) as the specification; this slice builds the command builder, the liveness reading, and both runner adapters' handling of a role-command request.

Assertions a naive implementation would pass without:
- A test proving the new command builder emits `--agent`, `--agents` and `--settings` for a role request, and that it does **not** touch `agentRunCommand`'s own fragment-agnostic contract (no new case keyed on a flag name inside the generic runner).
- A test proving `handBackProtocolFor` is unaffected — i.e. a role request does not go through `request.role`, so existing worker/board-role hand-back parsing has zero behavioural change. A corpus or unit test that fails if someone later "simplifies" by reusing `role` would catch the regression this brief specifically warns against.
- A test proving the liveness reading's pid-unanswerable case takes the bias you chose, not the opposite one by accident (`desk-loop-alive.test.ts` is the nearest existing pattern for this shape of test).
- A test proving `agentRunSdk` refuses — rather than silently degrading — a role it cannot load a definition file for.

Plus: the repo's gates — build artifacts (no committed bundle), a changeset naming `plot` or `@plot-pm/board` per `scripts/check-changeset-packages.sh`, and the usual TypeScript purity gate if any new file lands under `packages/domain/src/adapters/` (the domain may import `zod` and nothing else outside `adapters/`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites named in `CI suites` run in CI, not locally; running `pnpm run test:e2e` yourself is not expected and not wanted (it dispatches real workers and starves the shared machine).

Name the shell gate too, even though this slice is unlikely to touch `.sh` files: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. If you do end up touching a `.sh` file, pay for the growth in the same change.

### Bookkeeping

Open the PR through the controller once real work exists: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Never `gh pr create` by hand. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the "Detached role start" slice), in the same commit style the three earlier slices used (`→ #2919`, `→ #2937`, `→ #2946`).

Push the first real commit as soon as it exists — do not wait for the full three-part seam to be done before the branch shows anything.

### Scope guard

This branch owns:
- `packages/domain/src/rules/review-verdict.ts` (or a sibling file next to it) — the new role-command builder
- A new liveness-reading rule, wherever it best sits beside `desk-loop-alive.ts` / `agent-state.ts`
- `packages/domain/src/adapters/agent-run/agent-run-command.ts` and `agent-run-sdk.ts` — only the role-dispatch path, not a rewrite
- `packages/domain/src/ports/agent-run.ts` — only if a new request field is genuinely needed (the plan says "a dedicated request field, not `role`")

Out of scope, owned by siblings already named in the plan's Notes:
- The fixer's in-flight mark and attempts record — #2903 (`feature/the-fixer-attempts-record`); this slice supplies only the liveness reading, not fixer bookkeeping.
- Where the fixer works while a dead desk's worktree still holds the PR branch — #2903 and #2906.
- The per-question prompt fleetd passes to the unblocker — #2901; this plan (all its slices) owns only the four definition files' existence, not their call sites.
- Starting the fixer/unblocker/main-repair in fleetd's own tick loop — #2901, #2903, #2904, #2906 all wait on this branch merging first; do not reach ahead into their territory by wiring an actual fleetd call site here. This slice builds the *capability* (command builder + liveness reading + runner support); it does not make fleetd call it yet.

If you find something the plan did not anticipate — particularly around the two refuted probe assumptions (`maxTurns`, `memory: local`) — report it rather than improvising a fix that contradicts the measured probe result.
