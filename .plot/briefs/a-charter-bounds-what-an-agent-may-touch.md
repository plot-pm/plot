## Implementation brief — a-charter-bounds-what-an-agent-may-touch (wave 1: A charter bounds its agent's tools)

- **Plan (canonical):** `docs/plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-charter-bounds-what-an-agent-may-touch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

This is the plan's only slice, so it waits on nothing and nothing waits on it. Its sibling `feature/an-agent-declares-what-it-runs` is claimed and, measured 2026-09-12, carries **zero diff against main** — see Scope guard.

### What to build

`CharterSchema` already carries `capabilities: z.array(z.string()).default([])`, with the interface field, the TSDoc and the `.strict()` refusal all in place (`packages/domain/src/entities/charter.ts`). Measured 2026-09-12: `grep -rn PLOT_CAPABILITIES` over `skills/plot/scripts` and `skills/plot/templates` returns **nothing**. The field is declared and no reader exists.

Build the reader. Three parts:

1. **The export.** `start_worker()` in `skills/plot/scripts/plot-dispatch.sh` resolves the charter and exports `PLOT_CAPABILITIES` alongside the env block that already carries `PLOT_BRANCH`, `PLOT_SLUG`, `PLOT_SESSION_ID` and the three monitor paths (the `( cd "$wt" && PLOT_BRANCH=... )` block, currently around line 1018). An agent with no charter, or a charter naming no capabilities, exports nothing and behaves exactly as today.
2. **The prompt template's handling of it.** `skills/plot/templates/worker-prompt.sh` turns the capability list into the harness's flag. Plot exports the list; the prompt file owns the spelling — the same division `an-agent-declares-what-it-runs` draws for `harness`/`model`/`effort`.
3. **The warning.** An agent whose charter declares capabilities and whose prompt file ignores them is silently unbounded. Name it at launch.

The failure this fixes is a reviewing agent that edits what it reviews. CLAUDE.md has already measured the general case: *"a dispatched worker's changes are reviewed as code and a master agent's hand edits are not."*

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The mapping lives in the charter, not in Plot.** Principle 5 — *"Plot contains zero hardcoded project names, paths, or configuration."* Plot carries the list of names and has no opinion about what they mean. Do not add a capability enum, a built-in `read-only` definition, or a tool table to `packages/domain/`.

**This slice bounds an agent; it does not route to one.** `capabilities` does not become a slice field, the plan format gains nothing, and **`matchQueue` is not touched**. It is *"the assignment lock and there is only one"* — one slice to one agent, held by the shape of the pass. A gate with no routing is useful on its own: an operator dispatching a reviewer by hand gets the bound.

**No scope is not a silent scope.** A prompt file that ignores `PLOT_CAPABILITIES` produces today's unbounded agent, which is the honest failure mode. Do not invent a fallback bound.

**A capability list is a DENY-list over tools, and it must cover code execution.** This is the measurement that most changes the work, taken 2026-09-12 against the installed `claude` CLI in `/tmp` sandboxes:

| what was passed | what the agent's tool list held |
|---|---|
| `--allowedTools "Read" "Grep"` alone | the **full** list — `Write`, `Edit`, `Bash` all present |
| `--allowedTools "Read" "Grep" --permission-mode bypassPermissions` | the **full** list, unchanged |
| `--disallowedTools "Write" "Edit" "Bash" --permission-mode bypassPermissions` | `Write: no`, `Edit: no`, `Bash: no` |

So: **`--allowedTools` does not remove tools** — it shapes permission to call, and `bypassPermissions` grants that permission anyway. **`--disallowedTools` removes them from the list, and survives `bypassPermissions`.** The shipped template ends in `--permission-mode bypassPermissions`, so an allow-list implementation would ship a gate that does not gate. Use the deny form.

**And a deny-list over built-in tools alone is NOT a capability bound.** Measured in the same sandbox: with `Write`, `Edit`, `Bash` and `NotebookEdit` all denied under `bypassPermissions`, the agent overwrote the target file anyway — through an MCP plugin's `python_repl`, reporting *"Python's `open(p, 'w')` is a filesystem write like any other."* Disabling `Write` removes one named interface to the filesystem; it does not remove the filesystem. Any tool that executes code — a Python REPL, a shell behind an MCP server, `browser_run_code_unsafe` — reaches the same syscalls under a different name.

The consequence for this slice: a `read-only` capability that denies only `Write Edit Bash NotebookEdit` produces a reviewer that can still edit the code it reviews, on this estate, today. Whatever the shipped template documents as an example mapping must deny code execution too, and say why. If covering every MCP tool is not expressible in one flag, **say so in the warning** rather than shipping a bound that reads stronger than it is — the plan's own rule, one field over: no scope is not a silent scope.

**The refusal style is `resolve_prompt_file`'s, carried over unchanged.** A charter that cannot be read is a person's typo and must not be answered with a silent fallback. `CharterReading` already distinguishes four outcomes — `declared`, `unnamed`, `absent`, `unreadable` — and the last two are deliberately not one. An absent capability list is today's estate; an unreadable charter is a refusal.

**Two invariants this repo keeps re-learning:** absent is not false — a charter naming no capabilities is unstated, not "deny nothing" expressed as a decision. And read the exit code, not the emptiness.

### Done when

The plan's `## Done when` list is the specification. The plan ships none, so the Slices section is it: the `PLOT_CAPABILITIES` export, the shipped prompt template's handling of it, and the warning an agent gets when it declares capabilities its prompt ignores.

Lift these assertions, each because a naive implementation passes without them:

- **An agent with no charter exports no `PLOT_CAPABILITIES` at all** — not an empty string. An implementation that always exports it makes every prompt file's `[ -n "$PLOT_CAPABILITIES" ]` probe meaningless, and "nothing on the estate changes until a charter exists" stops holding.
- **A charter declaring capabilities whose prompt ignores them warns.** This is the slice's third deliverable and the one with no natural test — an implementation that exports the variable and stops is indistinguishable from a complete one until a reviewer silently runs unbounded.
- **The template's example mapping denies code execution, not just `Write`/`Edit`.** Catches the measured hole above; a test asserting only that `Write` is absent passes on an unsound bound.
- **`matchQueue` is unchanged.** Catches scope creep into the assignment lock.

Plus the repo's gates: `nvm use` (Node 24 — `pnpm` crashes on 26), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` if anything under `packages/` changes. **Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one. Add a changeset with its `bumps:` block, description FIRST and the block LAST, naming package `plot`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` — never `gh pr create`, which takes its title from the last commit subject.

**This plan annotates the PR INSIDE the wave heading**, not as a trailing arrow. The line to edit on `main` is:

```
### A charter bounds its agent's tools (Branch: feature/a-charter-bounds-what-an-agent-may-touch)
```

which becomes `(Branch: feature/a-charter-bounds-what-an-agent-may-touch, PR: #N)`. A trailing `→ #N` on this form parses as `prs=[]`.

Push your first real commit as soon as it exists, and again after any rebase.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-dispatch.sh` — the env-export block inside `start_worker()` only
- `skills/plot/templates/worker-prompt.sh` — the capability handling and its example mapping
- a changeset

It does **not** own `packages/domain/src/entities/charter.ts`: `capabilities` is already declared there, complete with defaults and TSDoc. Read it; do not rewrite it.

**The one collision, measured 2026-09-12.** `feature/an-agent-declares-what-it-runs` is approved, claimed, and edits the **same function** — it makes `start_worker()` resolve the charter before `Worker command` and export `PLOT_HARNESS`, `PLOT_MODEL`, `PLOT_EFFORT` from it. Its branch exists on `origin` and `git diff --stat origin/main...origin/feature/an-agent-declares-what-it-runs` returns **empty**: nothing has landed, so there is no charter resolution in `start_worker` to build on yet.

That is a fact, not a prediction, and it has a consequence: **you may need to add the charter resolution this slice depends on.** Write it so the sibling's three exports drop in beside yours rather than replacing your block — one resolution, four exports. If the sibling lands first, rebase onto it and add only `PLOT_CAPABILITIES`. Do not take its three fields as part of your scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
