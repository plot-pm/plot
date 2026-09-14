# Implementation brief — a-charter-reaches-the-agent-it-declares

- **Plan (canonical):** `docs/plans/2026-09-14-a-charter-reaches-the-agent-it-declares.md` on `main`
- **Approved:** 2026-09-14, jwloka, in-session
- **Branch:** `feature/a-charter-reaches-the-agent-it-declares` (base: `main`, claimed at `249587d53`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention

Sole slice of a one-wave plan. Nothing waits on it and it waits on nothing.

## What to build

`CharterSchema` shipped complete in v2.17.0 and **not one agent has ever been declared.** Measured on this branch's base, 2026-09-14: `.plot/charters/` does not exist; `--agent` appears **0 times** in `plot-dispatch.sh`; the one `PLOT_AGENT=` assignment on the estate is `plot-dispatch.sh:1312`, a pass-through of whatever the operator already exported. The shipped template names `PLOT_CAPABILITIES` twice and `PLOT_HARNESS`, `PLOT_MODEL`, `PLOT_EFFORT` **zero** times. This repository's own `.plot/worker-prompt.sh` is **52 lines against the template's 113** and names none of the four.

So the mechanism is complete and reaches nothing. Close the chain end to end, and prove it: add `--agent <name>` to the dispatch flag parser; interpolate the three variables into the template's invocation; reinstall this repo's prompt file from that template; add a print-only probe to both; declare **one** read-only reviewer charter; and read the four fields back off a printed argv.

The plan is canonical and its Design section carries the full argument. This is orientation.

## The decisions the plan settles — do not re-derive them

**`--agent` is a parser change and nothing more.** `resolve_launch` is already wired: `plot-dispatch.sh:946` calls `resolve_launch "$repo_root" "${PLOT_AGENT:-}"`, and `:1314-1316` already export `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` unconditionally. Do not go looking for where to thread the value and do not add a second resolution path — the flag sets `PLOT_AGENT` in the existing `while`/`case` loop at `:234`, takes its value with `shift` like `--max` at `:273`, and everything downstream already reads it. Join the usage header at lines 2–4 as well: the `-h|--help` arm at `:278` prints `sed -n '2,59p'`, so a flag absent from that block is a flag with no help.

**One charter, and it is a read-only reviewer.** Not a set of speculative kinds — which kinds exist is a later question and a person's. `read-only` is the **one mapped capability** in the template (`worker-prompt.sh:101-102`), denying `Write,Edit,NotebookEdit,Bash,Agent,Task`, so a reviewer exercises the capability bound on the single path that already works without inventing a `case` arm. An unmapped capability **warns and runs UNBOUNDED** (`:103-106`) — which is why the proof reads the deny list off the argv and never off the charter file.

**The charter is `.json`, not `.md`** — `plot-dispatch.sh:761` names `.plot/charters/<name>.json`. The story text says `.plot/roles/<slug>.md`; that design was superseded by the charter while the story sat parked. **`prompt` is required** (`z.string().min(1)`), so a declaration carrying only a model is not a valid charter. `CharterSchema` is `.strict()` (`charter.ts:120`): an unknown key is refused, not ignored, deliberately — a dropped field would accept the exact document the charter exists to refuse.

**Empty is not unset, and the two idioms guard different absences.** The three harness variables are **always exported** — `resolve_launch` initialises all three to `''` and the export block is unconditional — so a charter-less dispatch hands the prompt file three *set-but-empty* variables. Guard those with `[ -n ... ]`. `PLOT_CAPABILITIES` alone is exported **conditionally** (`:1308`), because bash recognises an assignment prefix before it expands parameters, so `${caps:+PLOT_CAPABILITIES="$caps"}` in the prefix position is a word rather than an assignment; that conditional is what keeps it genuinely unset, so the template's existing `${cap_args[@]+"${cap_args[@]}"}` means what it says. **These are not an inconsistency to unify** — unifying them breaks one of the two cases. **Do not change the dispatch exports.** Extending the conditional to all four touches a working v2.17.0 path for no behaviour a `-n` test does not already give.

**The local prompt file is REINSTALLED from the template, then extended — not patched in place.** It is half a template behind: 52 lines, no `cap_args` block at all, and its `claude -p` at `:52` predates the capability work. Patching would leave the two structurally different in ways nobody has compared, which is how it fell behind in the first place, and `plot-install-prompt.sh --check` **cannot report it** — it classifies by what a file PASSES (`PLOT_SESSION_FLAG`), not by comparison, which is correct for its own purpose and means this gap has no reporter. **One line is project-specific and must survive**: the `claude -p "You are implementing the branch $PLOT_BRANCH …"` prompt text, which diffed against the template is the only content the local file holds that the template does not. Carry it across; everything else is the template's. **But carrying it is not a wholesale copy of the old string** — measured 2026-09-14: the local text names this repo's gates (`pnpm install`, `pnpm build:board`, the changeset bumps block, `trash not rm`), which must survive, and it also instructs *"Open a PR to main when done, then append the PR number…"*, which is the pre-`plot-open-pr.sh` wording this estate has since banned. The template's prompt names `plot-open-pr.sh` and why. Graft the repo-specific gates sentence onto the **template's** prompt text; copying the 52-line file's string verbatim regresses the PR instruction to the shape the Bookkeeping section below forbids. The installer refuses to overwrite an existing file deliberately, so this is a hand replacement — the file is tracked, so the diff travels with the branch and is reviewed like code.

**Both files, in that order: template first.** The template is the contract every adopting project installs; this repo's file is one instance. Fixing only the local copy leaves the shipped default unable to honour a charter — the half of the charter that motivated the work.

**`PLOT_PRINT_INVOCATION=1` is a debug hook, not a contract.** It echoes the argv the prompt file assembled and exits 0 **without launching**, immediately before the `claude` line. Nothing in Plot reads it and nothing branches on it; a prompt file that omits it simply cannot be probed. It exists because the Done-when cannot read a live process: the worker launches detached, Plot never composes the command line, and a `ps` reading is timing-sensitive and costs a real agent run — the flake class this repo has measured repeatedly under load.

**Touch no refusal.** The two that exist — an unbelievable charter, and a harness not on `PATH` — are correct and tested. A third is not wanted: a prompt file that ignores a field is a gap in the file, not a reason for dispatch to refuse.

**The invocation stays in the prompt file.** `.plot/worker-prompt.sh` is a per-project file, uninstalled by Plot after the first write, because the harness is a project's choice and its command line is not Plot's to compose. Add no code to Plot that builds a command.

### Carried over unchanged

- **Absent is not false, and unknown is not no.** An unanswerable question is answered `unknown`, never `0` — the direction `plot-worker-state.sh` already takes.
- **Read the exit code, not the emptiness.** An empty result and a failed call are different answers.
- **`${a[@]+"${a[@]}"}` is for bash 3.2**, which is `/bin/bash` on macOS: there a plain `"${a[@]}"` on an empty array expands to one empty argument, and under `set -u` aborts. The loop sources this file through `bash -c`, so the version is not knowable and the portable form is the only correct one. Any new array follows it.

## Done when

The plan's `## Done when` is the specification. Restated with what each assertion catches:

- A read-only reviewer charter exists under `.plot/charters/`, and `--agent reviewer` selects it.
- `PLOT_PRINT_INVOCATION=1` prints an argv carrying the charter's `model` and `effort` and a `--disallowedTools` bearing the read-only deny list — **read from the printed argv, never inferred from the charter file.** *Catches:* a capability that silently failed to map. An unmapped capability warns and runs unbounded, which looks identical to one that applied if you assert on the charter.
- The same probe with **no** `--agent` prints an argv **byte-identical** to today's. *Catches:* the `[ -n ... ]` guards misfiring on set-but-empty variables and injecting stray flags into every undeclared dispatch — the property `plot-dispatch.sh:770` promises. Capture the baseline argv **before** editing anything; afterwards it is unrecoverable.
- Both existing refusals still fire: an unbelievable charter, and a harness not on `PATH`.
- This repo's prompt file matches the template but for its own `claude -p` prompt text, which is preserved.

Plus the repo's gates: `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`. `nvm use` first — **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing. Add a changeset with its `bumps:` block, description **first** and `bumps:` **last**. Do **not** run `test:e2e` — that is CI's gate, not a local one.

`test:contracts` is `test/reconcile/*.test.mjs`. Three files already cover this chain — `launch-resolution.test.mjs`, `capabilities.test.mjs`, `prompt-resolution.test.mjs`. A new test belongs beside them, not in a new location.

**A harness a TEST names must be manufactured, never inherited — and the committed charter makes this live.** `launch-resolution.test.mjs:34-53` records the measurement: `resolve_launch` reads the field with `command -v`, so a charter naming `claude` resolves on a workstation with the CLI installed and does **not** on `ubuntu-latest`, where `test:contracts` runs and `ci.yml` installs none. That fixture was green here and red in CI. Its answer is `binDir()` — write an executable, hand back a directory to prepend — plus `MISSING_HARNESS`, a name nothing can provide, so no case depends on what happens to be installed.

The reviewer charter this slice ships is a **committed file, not a fixture**. So any test or probe that resolves *its* harness reproduces that failure exactly. Decide the charter's `harness` value with that in mind, keep every test's harness manufactured, and state in your closing note which you chose and why.

## Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). It takes the title from the plan's wave heading and refuses a branch a PR already carries. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section on `main`. Check `git branch --show-current` is `main` before that edit.
- Push the first real commit as soon as it exists, and again after any rebase.
- Run every test in the **foreground**: this is a `-p` run with no next turn, so a background job's completion never reaches you and the work strands uncommitted.

## Scope guard

This branch owns:

- `skills/plot/scripts/plot-dispatch.sh` — the flag parser and usage header **only**
- `skills/plot/templates/worker-prompt.sh`
- `.plot/worker-prompt.sh`
- `.plot/charters/` (new)
- `test/reconcile/` — a new or extended contract test

**Observed and deliberately out of scope:** template `worker-prompt.sh:113` expands `${cap_args[@]+"${cap_args[@]}"}` **twice** in one `claude` invocation — once before `-p` and once after — which on a read-only charter emits the `--disallowedTools` pair twice. It sits exactly where the three new interpolations go. **Do not fix it and do not copy the pattern**: interpolate each new variable once. Report it in your closing note so it can be planned.

Nothing else is in flight over these files, and that is verified rather than assumed: at claim time every remote branch was diffed against `main` for `worker-prompt`, `plot-dispatch.sh`, `charters`, `plot-prompt.mjs` and `charter.ts`, and the collision set was **empty**.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
