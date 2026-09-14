---
'plot': minor
---

A charter now reaches the agent it declares. The mechanism shipped in v2.17.0 and reached nothing: measured 2026-09-14, `harness` had 16 readers, `model` and `effort` 14 each, and the estate held zero charters. The gap was three layers deep. `.plot/charters/` was empty; `PLOT_AGENT` had one assignment on the estate, `PLOT_AGENT="${PLOT_AGENT:-}"`, a pass-through of whatever an operator had already exported, so nothing chose a charter; and the shipped prompt template named `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` zero times. The third layer is the one that made this look finished and change nothing — a charter declared before this exported three variables into a prompt file that read none of them, so the agent launched exactly as before, and silently, because Plot never composes the command line and nothing downstream can report that a declaration was dropped. `plot-dispatch.sh` gains `--agent <name>`, which sets the input that already existed, in one place, and overrides an inherited value because a flag on this run is the more specific answer. Its value is required and always consumed, unlike `--stop`/`--restart`/`--start`: those take a branch or a count, each recognisable on sight, while an agent name is a bare word and so is a plan slug, so an unconsumed value would let the `*)` arm take the agent name as the plan and report "no such plan". The template interpolates the harness as the command and the model and effort as flags, each guarded by `[ -n ... ]` rather than `${VAR+set}` — dispatch exports the three unconditionally, so a charter-less run hands the file three set-but-empty variables and a `+set` test would pass `--model ""` on every dispatch. `PLOT_CAPABILITIES` keeps the opposite idiom because dispatch exports it conditionally; the two guard different absences. `PLOT_PRINT_INVOCATION=1` prints the assembled argv and exits 0 without launching, immediately before the invocation, so the chain is observable without a live process — a debug hook and not a contract, read by nothing in Plot. One read-only reviewer charter is declared, `read-only` being the one mapped capability in the shipped template. It names no harness deliberately: `resolve_launch` refuses a harness not on `PATH`, and CI installs no Claude CLI, so a charter naming one would be green on a workstation and red in CI. A charter-less launch stays byte-identical, which is the whole estate today.

<!--
plan: docs/plans/2026-09-14-a-charter-reaches-the-agent-it-declares.md
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->
