# A charter reaches the agent it declares

> The charter mechanism is complete and reaches nothing: zero charters exist, nothing selects one, and the prompt file honours none of the fields it would export.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-agent-identity
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A dispatched agent can be declared: a charter names its harness, model, effort and capabilities, a dispatch selects it by name, and the prompt file builds the invocation from what Plot exports.

<!-- Board impact: none to the plan format or the board's readers. This adds a
     `.plot/charters/` file, a selector on dispatch, and lines in the prompt
     template. -->

## Design

**THE MECHANISM IS COMPLETE AND ITS ADOPTION IS NIL.** `CharterSchema` carries
`name`, `prompt`, `harness`, `model`, `effort`, `capabilities` and `bounds`;
`plot-dispatch.sh` reads them — measured 2026-09-14, **16 readers for
`harness`**, 14 each for `model` and `effort`, 7 for `capabilities`. It shipped
in v2.17.0 and **not one agent has ever been declared.**

That is the defect class `CLAUDE.md` names: *"Where a rule exists and nothing
calls it, that is a defect to report."*

### The gap is three layers deep, and only the first is obvious

Measured 2026-09-14, in this repository:

| layer | state |
|---|---|
| `.plot/charters/` | **zero files** |
| `PLOT_AGENT`, the selector | **one assignment on the estate** — `plot-dispatch.sh:1312`, `PLOT_AGENT="${PLOT_AGENT:-}"`, a pass-through of whatever the operator already exported. **Nothing chooses a charter.** |
| `.plot/worker-prompt.sh` | honours **none** of `PLOT_HARNESS`, `PLOT_MODEL`, `PLOT_EFFORT`, `PLOT_CAPABILITIES` |

**The third layer is the one that would make this look finished and change
nothing.** A charter declared today exports three variables into a prompt file
that reads none of them, so the agent launches exactly as before — and, by
design, silently: *"Plot exports the three names and the PROMPT FILE holds the
invocation"* (`plot-dispatch.sh:764`). Plot cannot write the invocation, so
nothing downstream can report that the declaration was ignored.

**And the installer says the file is fine.** `plot-install-prompt.sh --check`
reports `current`, because it classifies by what a file PASSES —
`PLOT_SESSION_FLAG` — rather than by comparison with the template. That is
correct behaviour for its own purpose (*"a project that rewrote every word is
not out of date"*) and it means the prompt-file gap has no reporter at all.

**The shipped template is also short, which is why this is not just a repo-local
fix.** `skills/plot/templates/worker-prompt.sh` references `PLOT_CAPABILITIES`
twice and `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` **zero times**. So an
adopting project that installs the template today gets capability bounds and no
harness selection — the half of the charter that motivated it.

### What this plan does, and what it deliberately does not

**It declares ONE charter and proves it reaches the launch.** One is the whole
point: the first declaration is what turns an untested path into a measured one,
and a set of speculative agent kinds would be inventing roles this estate has
not asked for. Which kinds exist is a later question and a person's.

**The selector is explicit and not inferred.** `PLOT_AGENT` stays the input;
this plan adds a `--agent <name>` flag to `plot-dispatch.sh` that sets it, so an
operator chooses a kind per dispatch. **A slice naming the kind it needs is the
sprint's second Must and is NOT in this plan** — that changes the plan format
and wants its own interrogation.

**It fills the template, not just this repo's copy.** Both, in that order: the
template is the contract every adopting project installs, and this repository's
file is one instance of it. Fixing only the local copy would leave the shipped
default unable to honour a charter.

**It touches no refusal.** The two that exist — an unbelievable charter, and a
harness this machine cannot run — are correct and tested. A third refusal is not
wanted: a prompt file that ignores a field is a gap in the file, not a reason for
dispatch to refuse.

### Why the prompt file is where the invocation lives, and stays there

`.plot/worker-prompt.sh` is a per-project file, uninstalled by Plot after the
first write. That is deliberate — *"Plot exports the variables and cannot write
the invocation"* — because the harness is a project's choice and its command
line is not Plot's to compose. So this plan writes the interpolation into the
template and this repo's file, and adds no code to Plot that builds a command.

## Slices

### A charter reaches the agent it declares (Branch: feature/a-charter-reaches-the-agent-it-declares)

- `feature/a-charter-reaches-the-agent-it-declares` — add `--agent <name>` to `plot-dispatch.sh` setting `PLOT_AGENT`; interpolate `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` into the invocation in `skills/plot/templates/worker-prompt.sh` and in `.plot/worker-prompt.sh`; declare one charter under `.plot/charters/`; and prove end to end that its four fields reach the launch

**Done when** a charter exists under `.plot/charters/`; `plot-dispatch.sh --agent
<name>` selects it; the launched command line carries the charter's `harness`,
`model` and `effort` and its `capabilities` reach `--disallowedTools`; a dispatch
with no `--agent` produces a command line **byte-identical** to today's, which is
the property `plot-dispatch.sh:770` promises; both existing refusals still fire
(an unbelievable charter, and a harness not on `PATH`); and `pnpm run
test:contracts` passes.

## Notes

**Found while planning sprint W41**, from the story `plot-agent-identity`, whose
own text still describes `.plot/roles/<slug>.md` — the design that was superseded
by the charter while the story sat parked. The story carries an amendment dated
2026-09-14 saying so.

**The charter is `.json`, not `.md`.** Worth stating because the story and the
sprint's first draft both said otherwise: `plot-dispatch.sh:761` names
`.plot/charters/<name>.json`.

**`prompt` is required on a charter** (`z.string().min(1)`), so a declaration is
not metadata alone — it carries the agent's system prompt. A charter declaring
only a model is not a valid charter.
