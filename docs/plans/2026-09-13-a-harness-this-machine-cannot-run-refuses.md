# A harness this machine cannot run refuses

> A charter may name any harness, and nothing checks the machine has it. The launch proceeds and the work is done by whatever the prompt file falls back to.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** an-agent-is-declared-and-corrected
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-13, jwloka, in-session
- **Started:** 2026-09-13, jwloka, `bug/a-harness-this-machine-cannot-run-refuses`

## Changelog

- A charter naming a harness this machine cannot run refuses the launch and names what it looked for, instead of exporting the name and letting the prompt file fall back.

<!-- Board impact: none. plot-dispatch.sh only. -->

## Motivation

**The story's Definition of Done names this and eleven delivered plans did not produce it.** Measured 2026-09-13 on main, with a charter reading `"harness": "no-such-harness-xyz"`:

```
$ plot-prompt.mjs --launch <repo> x
declared	no-such-harness-xyz	m		x
$ echo $?
0
```

`declared`, exit 0, no complaint. `plot-dispatch.sh:1284` exports `PLOT_HARNESS="$launch_harness"` and **nothing between the charter and the process checks the machine has it** — not `plot-prompt.mjs`, not `resolve_launch`, not `start_worker`, not the loop.

**`an-agent-declares-what-it-runs` promised exactly this** — *"a harness this machine cannot run refuses rather than falling back"* — and shipped the declaration without the check. The plan was delivered; the sentence was not.

**The failure is the one the charter's own docstrings argue against.** A prompt file interpolating `${PLOT_HARNESS}` into a command that does not exist fails at the shell, late, inside a worker, with the reason in `.plot-worker.log` and nothing on the board. A prompt file that ignores the variable is worse: the agent runs under the repo default, successfully, and the work is done by the wrong agent with nothing saying so. That is the same shape as `resolve_prompt_file`'s refusal — *"the repo prompt would run successfully under instructions nobody asked for"* — one field over.

**It is a typo's blast radius.** `gemini-3.1-pro` in the harness field instead of the model field, or `agnet` for `agent`, is a plausible hand edit in a file a person writes.

## Design

### Approach

`resolve_launch` checks the resolved harness before the launch and refuses through the arm it already has: clear `launch_harness`/`launch_model`/`launch_effort`, set `launch_why`, return 1.

**The reading is `command -v`**, because that is what the prompt file will do with the name. A harness is a command on `PATH`; the check asks the same question the launch asks, at the moment a person can still fix it.

### An unnamed harness is not an unrunnable one

A charter declaring no harness — the estate's whole population today — resolves to an empty string and **must keep launching exactly as it does now**. The check applies only to a NAME, so `harness: ""` skips it entirely.

That distinction is the same one `plot-prompt.mjs` already draws between `fallback` and `declared`, and getting it wrong would refuse every dispatch on the estate.

### The refusal names what it looked for

*"charter 'nl' names harness 'agnet', which is not on PATH"* — the name, so a typo is visible without opening the file, and the reason, so nobody re-derives it. The DoD's words are *"names what it looked for"*.

### It refuses at dispatch, not in the bundle

`plot-prompt.mjs` answers what a charter DECLARES; whether this machine can run it is a machine fact, and the bundle reaches no machine. That split is the layering rule: the domain decides, the adapter reads the world. So the check lives in the shell that is about to spawn, beside the `node` and `launchd` probes `plot-fleetctl.sh` already performs.

### Open Questions

- [ ] Should a `--force` exist? Every other refusal in dispatch has a named escape. Leaning no: a harness that is not installed cannot be forced into existence, so the escape would only skip the message.
- [ ] Does the supervisor need the same check before it hands a slice to a declared agent? It matches on capability, not harness, so a machine without the harness could still be handed the slice. Out of scope here; file it if the fleet ever runs mixed machines.

## Slices

### A harness this machine cannot run refuses (Branch: bug/a-harness-this-machine-cannot-run-refuses)

The `command -v` check in `resolve_launch`, the refusal text, and a test covering all three cases: no harness declared (launches), a harness that exists (launches), a harness that does not (refuses, naming it).

## Notes

This closes the last open criterion in the story's Definition of Done. The other four were verified on main 2026-09-13: bounded retries before a marker, every marker naming its writer, a panel verdict as a file, and zero new `Wave`-for-`Slice` in the domain.
