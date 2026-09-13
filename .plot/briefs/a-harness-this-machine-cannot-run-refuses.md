# Brief: bug/a-harness-this-machine-cannot-run-refuses

- **Plan (canonical):** `docs/plans/2026-09-13-a-harness-this-machine-cannot-run-refuses.md` on `main`
- **Approved:** 2026-09-13, jwloka, in-session
- **Branch:** `bug/a-harness-this-machine-cannot-run-refuses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention
- **Sprint:** `an-agent-is-declared-and-corrected` (a Must)

Sole slice of a single-wave plan. Nothing waits on it and it waits on nothing. It closes the last open criterion in the story's Definition of Done.

## What to build

A charter may name any harness and nothing checks this machine has it. Measured on main 2026-09-13, with a charter reading `"harness": "no-such-harness-xyz"`:

```
$ plot-prompt.mjs --launch <repo> x
declared	no-such-harness-xyz	m		x
$ echo $?
0
```

`declared`, exit 0, no complaint. The launch proceeds and the work is done by whatever the prompt file falls back to — under the repo default, successfully, with nothing on the board saying the wrong agent ran.

Add a `command -v` check on the resolved harness in `resolve_launch` (`skills/plot/scripts/plot-dispatch.sh:787`), refusing through the arm that function already has. The plan is canonical; this is orientation.

## The decisions the plan settles — do not re-derive them

**The reading is `command -v`, not a config lookup or an allow-list.** A harness is a command on `PATH`, and `command -v` asks the same question the prompt file will ask when it interpolates the name. The check has to match what the launch does, or it refuses launches that would have worked and passes ones that will not.

**An unnamed harness is not an unrunnable one.** A charter declaring no harness resolves to `""` and must launch exactly as it does today. The estate holds zero charters that name one, so a check that fires on the empty string refuses *every dispatch on the estate*. Guard on a non-empty name first. This is the same distinction `plot-prompt.mjs` already draws between `fallback` and `declared`.

**It refuses at dispatch, not in the bundle.** `plot-prompt.mjs` answers what a charter *declares*; whether this machine can run it is a machine fact and the bundle reaches no machine. That is the layering rule — the domain decides, the adapter reads the world — so the check lives in the shell that is about to spawn, beside the `node` and `launchd` probes `plot-fleetctl.sh` performs.

**No `--force`.** The plan's own open question, and it leans no: a harness that is not installed cannot be forced into existence, so the escape would skip the message and change nothing else.

### Where the check goes, exactly

`resolve_launch` at `plot-dispatch.sh:787`. The refusal arm already exists at lines 811–817 — clear `launch_harness`/`launch_model`/`launch_effort`, set `launch_why`, `return 1`. Reuse that shape; do not add a second refusal mechanism.

**The ordering is load-bearing.** The check belongs on the `declared` arm of the `case` at line 819, after the `status -eq 3 || verb = refused` test at line 811. Two reasons, both of which a check placed earlier gets wrong:

- The `refused` arm has already blanked the three fields, so a check above it reads an empty harness and is a no-op.
- The `*)` fallback arm *also* blanks them (lines 827–829), so a check between the parse and the `case` reads a value the resolution is about to discard, and refuses a fallback that was going to launch fine.

Only `declared` carries a harness the launch will actually export.

**The refusal names what it looked for.** *"charter 'nl' names harness 'agnet', which is not on PATH"* — the charter name so a typo is visible without opening the file, and the reason so nobody re-derives it. The DoD's words are *"names what it looked for"*. The existing sibling refusal (test at line 275) asserts the charter, its path and the remedy are all named; match that bar.

**This is a typo's blast radius.** `gemini-3.1-pro` in the harness field instead of the model field, or `agnet` for `agent`, is a plausible hand edit in a file a person writes.

## Done when

The plan's `## Done when` is the specification: the `command -v` check, the refusal text, and a test covering all three cases — no harness declared (launches), a harness that exists (launches), one that does not (refuses, naming it).

### The assertion that exists because a naive implementation passes without it

**`test/reconcile/launch-resolution.test.mjs:130` will start depending on the test runner's `PATH`, and it will pass here and fail in CI.**

That test asserts `resolve(root, 'reviewer')` returns `['claude', 'opus', 'high', 'reviewer']`, and `sandbox()` writes that charter with `harness: 'claude'` (line 44). Today no code reads the field, so the value is inert. The moment `command -v` reads it, the test's outcome becomes a fact about the machine:

- On this workstation `claude` resolves (a `cmux-cli-shims` entry), so the suite is green locally.
- CI runs `test:contracts` — `node --test test/reconcile/*.test.mjs` — on `ubuntu-latest`, and `ci.yml` installs no `claude`. The charter's harness is not on `PATH`, the new check refuses, and a test that asserts a successful launch fails.

An implementer who adds three new tests and runs them locally sees green and pushes a red CI.

**Fix the fixture rather than the assertion.** Make the "exists" case name a harness the test *manufactures* — write an executable into a temp dir and prepend it to `PATH` for that run — so the test controls its own answer instead of inheriting one from the machine. The "does not exist" case needs the mirror: a name nothing could provide. Neither case may depend on what happens to be installed.

Check the same way for any other fixture that names a real binary: the point is that no assertion about launching is allowed to be a statement about the runner.

### The other two cases

- **No harness declared** — the regression lock for the whole estate, and the one that matters most. Line 105's existing test (`PLOT_AGENT` unset → four empty strings) already covers the shape; make sure it still passes rather than replacing it.
- **A harness that does not exist** — refuses, and the message names the charter and the harness. Assert on the text, not just the non-zero return: a bare refusal sends the operator nowhere.

Reach the function with `PLOT_DISPATCH_SOURCED=1` and the `resolve()` helper the file already has (line 63) — that flag exists for exactly this, and it sits after both function definitions on purpose. Do not slice the script into /tmp: `script_dir` derives from `BASH_SOURCE` and a copy resolves every helper to /tmp.

### Repo gates

```bash
nvm use                     # Node 24 — pnpm crashes on 26
pnpm test                   # skills parse
pnpm run test:contracts     # this suite
```

Plus a changeset naming the plan. `test:e2e` is **CI's gate, not a local one** — do not run it.

## Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading; `gh pr create` takes it from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

## Scope guard

This branch owns:

- `skills/plot/scripts/plot-dispatch.sh` — `resolve_launch` only
- `test/reconcile/launch-resolution.test.mjs`
- one `.changeset/*.md`

Nothing else. Specifically:

- **`plot-prompt.mjs` and the domain are out of scope.** The bundle answers what a charter declares and must keep doing exactly that; the machine question is the shell's. Changing the bundle is the design error the plan names.
- **Do not fix the brief-path disagreement you may notice.** `plot-dispatch.sh:442` derives `.plot/briefs/%s.md` from `${1##*/}` (strip the prefix) while `packages/domain/src/workflows/implement.ts:192` uses `branch.replace(/\//g,'-')` (flatten). For a `bug/`-prefixed branch these give different filenames. It is a real latent defect and it is not this plan's — file it, leave it.
- **The supervisor is deliberately unchanged.** It matches on capability, not harness, so a machine lacking the harness could still be handed a slice. The plan calls that out and puts it out of scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
