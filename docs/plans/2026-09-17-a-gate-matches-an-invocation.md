# A gate matches an invocation

> The controller gate scans every token of a command, so a script name inside a commit message, a `grep` argument or a heredoc body is refused as though it were a call.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #935
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-controller-gate.sh` fires on a script in command position rather than anywhere in the command line. A commit message naming the script that performed a write, a `grep` reading that script, and an issue reporting this behaviour were each refused while invoking nothing.

<!-- Board impact: none. A PreToolUse hook's matching rule. No plan format,
     no template, no layout. -->

## Design

**The loop takes any token:**

```sh
for tok in $CMD; do
  base="${tok##*/}"
  [ -n "$(gated_action "$base")" ] || continue
  named_script="$base"
  break
done
```

**Position is never consulted.** A name in a heredoc line, a quoted string or a
`grep` argument is a token like any other.

**The comment states the intent the code does not reach**: *"a command
MENTIONING the script inside a longer word does not fire."* That holds for
`foo-plot-approve.sh-bar` — the basename must stand alone — and it does not hold
for a standalone token that is not in command position.

### The measured cost is a commit message, and it is the one that matters

Four refusals in one session, reported:

| what was refused | what it invoked |
|---|---|
| a heredoc commit message naming the script that wrote a field | nothing |
| a `for` loop running `grep -c` over three lifecycle scripts | nothing |
| a `grep` for a symbol inside the dispatcher | nothing |
| the `gh issue create` filing this report | nothing |

**Renaming the script to "the approval" in the prose let the identical commit
through.** That is the real loss: **the gate taught a caller to write a vaguer
commit message**, trading traceability for nothing. The reporter names it, and
this estate's own commit messages are where a measurement survives.

**Cases 2–4 push a caller toward obfuscating its own commands** — splitting the
name, building it from a variable — which produces commands nobody can grep for
later, the gate's authors included.

### The gate is right and only the match moves

**Its rationale is measured and stands**: *"five dispatches in one session went
to this script directly, by the agent that had read the rule."* It fired
correctly on every real invocation in the reported session, and each refusal was
accepted.

**So nothing about which actions are gated changes.** `gated_action`, the
read/write split, the desk exemption and every refusal message stay as they are.

### Command position, and why not the alternatives

**The fix is to match the script in COMMAND position** — the reporter's first
suggestion and the one closest to the gate's own intent. An invocation has the
script as the command word; everything after it is an argument.

**A read-only allow-list was weighed and refused.** Exempting `grep`, `cat`,
`sed`, `git commit`, `gh issue` by name is a list that must grow forever and is
wrong the first time somebody uses a reader this plan did not think of. It also
still fires on `echo skills/plot/scripts/plot-approve.sh`.

**A heredoc-only exemption was weighed and refused as insufficient.** It fixes
case 1 and leaves 2–4, and it needs the gate to parse shell quoting — which is
the thing a token loop exists to avoid.

**Command position is not free of bounds, and the bound is already accepted.**
`env FOO=1 plot-approve.sh`, `bash plot-approve.sh` and a call through a
variable each put the script somewhere a first-token test would miss. The gate's
own comment already accepts this class: *"a script reached through a variable or
a wrapper is not visible here… the gate catches the shape that was measured,
not every shape."* **So the slice states which wrappers it follows and which it
does not**, rather than implying completeness.

### What this does not do

**It does not narrow what is gated.** Every action that fires today on a real
invocation fires after, which is the property to pin hardest — a matching fix
that quietly stops catching a dispatch would be worse than the false positives.

**It does not touch `plot-state-gate.sh` or `plot-phase-gate.sh`.** They match on
different things and neither was reported.

**It does not make the gate parse shell.** A token's position is readable
without quoting rules; a heredoc body's extent is not.

## Slices

### A gate matches an invocation (Branch: bug/a-gate-matches-an-invocation)

- `bug/a-gate-matches-an-invocation` — match a gated script in command position rather than at any token, following the wrapper forms the slice names, and state the bound in the script

**Done when** a `git commit` whose heredoc body names a gated script **passes**,
pinned by a fixture holding the reporter's own message; a `grep`, `cat` or
`sed -n` reading a gated script passes; a `gh issue` body naming one passes; and
**every real invocation still refuses** — `plot-approve.sh <slug>`,
`./skills/plot/scripts/plot-approve.sh <slug>`, an absolute path, and
`bash skills/plot/scripts/plot-approve.sh <slug>` — each pinned separately,
since a matching fix that stops catching a dispatch is worse than the false
positives it removes; `env` and `bash`/`sh` wrappers are followed and the script
says so; a form that is **not** followed is named in the script rather than left
implied; `--status`, `--dry-run` and the other reporting modes still pass; the
desk exemption is unchanged; and `pnpm run test:contracts` passes.

## Notes

**Reported 2026-09-17, and the report could not be filed until its own text was
written to a file by another route** — the `gh issue create` carrying it was
refused for quoting the script names it is about.

**The reporter argues for the gate while reporting it**, which is why this plan
changes only the match. A gate people route around by obfuscating their commands
has stopped being a gate; a gate that blocks a commit message has started
costing something it was never meant to.

**This estate has one measurement of what such a message is worth.**
`CLAUDE.md` records that a reasoning belongs *"in the commit that introduced the
guard, so `git log -S` finds it"*. A gate that refuses the script's name in that
commit refuses the thing the rule asks for.
