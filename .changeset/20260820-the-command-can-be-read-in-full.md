---
"@plot-pm/board": minor
---

board: the agent panel's COMMAND expands to the whole command and offers Copy

The panel rendered the worker command on one clipped line ending `Read .p…`.
The full value is ~1,400 characters — the entire brief the agent was handed,
which is the single most useful fact on the panel when an agent misbehaves,
because it is the specification it was given. Measured, the truncation stopped
inside the word `.plot/briefs/`, so the reader could not even see which brief
was named. There was no expand, no wrap, no copy: the information was present in
the DOM and unreachable in the UI.

**One field, one dedicated control.** The plain `Fact` truncates to a single
line, which is right for a pid or a model name and wrong only here. So `command`
alone gets `CommandFact`: collapsed it shows a one-line preview, **Show more**
opens the whole command wrapped and readable in place, and **Copy** puts the
command on the clipboard. Every other field keeps the plain `Fact` and its
truncation.

**Copy yields the launched command, not the render of it.** The collapsed
preview replaces the command's newlines and whitespace runs with single spaces
so it reads as one line — but it is a preview, never the source. Expand renders
the ORIGINAL string, and Copy writes the ORIGINAL string, byte for byte
including the newlines the preview removed. A collapse that dropped characters
would make Copy yield the truncated render, which is the exact defect this
removes; `commandFirstLine` is therefore lossless by construction (whitespace
only) and asserted so without a page in `command-fact.test.ts`.

**The omission rule is kept.** A `command` of `""` — the shape a fleet with no
`Worker command` configured takes — renders nothing at all: no preview, no Show
more, no Copy, the same structural absence `Fact` already guarantees. There is
nothing to expand or copy, so the field simply is not there.

**Copy degrades rather than throws.** `navigator.clipboard` is absent over plain
http and in older browsers — the caveat `PlanModal` already names — so a failed
write is swallowed. The command is in the DOM either way, so a reader on an
insecure origin can still select the text they can see; the button is the
convenience path, not the only one.

The behaviour that only a browser can show — collapsed is one line, Show more
reveals the brief path the truncation buried, Copy yields the exact string — is
asserted in `command-copy.browser.test.ts` against the shipped artifact.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side rendering change only. No `.sh`
helper and no `SKILL.md` is touched — the `/api/agent-panel` payload is unchanged
and already carried `command`; what changes is how the panel renders the value
it was already given.
