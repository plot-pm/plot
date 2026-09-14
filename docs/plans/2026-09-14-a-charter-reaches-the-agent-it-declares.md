# A charter reaches the agent it declares

> The charter mechanism is complete and reaches nothing: zero charters exist, nothing selects one, and the prompt file honours none of the fields it would export.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-agent-identity
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

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

**The first charter is a READ-ONLY REVIEWER**, chosen 2026-09-14, and the
capability is why. `read-only` is the **one mapped capability** in the shipped
template (`worker-prompt.sh:101`), denying
`Write,Edit,NotebookEdit,Bash,Agent,Task` — so a reviewer exercises the
capability bound on the single path that already works, without inventing a case
arm. It is also the story's own example of what a declaration is for: *"a
reviewing agent that edits what it reviews, with nothing recording that it did"*.

**An unmapped capability warns and runs UNBOUNDED** — the template says so at
`:103`. So the Done-when must observe the deny list on the command line rather
than the charter's field: a capability that silently failed to apply looks
identical to one that applied.

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

### This repository's prompt file is half a template behind

**Measured 2026-09-14: `.plot/worker-prompt.sh` is 52 lines against the
template's 113, and carries no `cap_args` block at all.** Its `claude -p` at
`:52` is an older shape, predating the capability work entirely. So *"interpolate
into both files"* is not the symmetric edit it sounds like: the template gains
three variables, and this repository's file needs the capability block **and**
the three.

**The file is REINSTALLED from the template first, then extended.** Patching the
52-line file in place would leave the two structurally different in ways nobody
has compared, which is how it fell a template behind in the first place — and
`plot-install-prompt.sh --check` cannot report it, because it classifies by what
a file passes rather than by comparison.

**One line is project-specific and must survive**: the `claude -p "You are
implementing the branch $PLOT_BRANCH …"` prompt text. Diffed against the
template, it is the ONLY content the local file holds that the template does
not. Carry it across; everything else is the template's.

**The installer refuses to overwrite an existing file**, deliberately — *"a
repository may run one for its own reasons"*. So this is a hand replacement the
worker makes and a person reviews. The file is **tracked**, so the diff travels
with the branch and is reviewable like any code.

### Empty is not unset, and the two guards differ for a reason

**`PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` are ALWAYS exported** —
`resolve_launch` initialises all three to `""` and `plot-dispatch.sh:1314-1316`
exports them unconditionally. So a charter-less dispatch hands the prompt file
three *set-but-empty* variables, not absent ones.

**`PLOT_CAPABILITIES` alone is exported conditionally**, and its comment says
why: bash recognises an assignment prefix before it expands parameters, so
`${caps:+PLOT_CAPABILITIES="$caps"}` in the prefix is a WORD rather than an
assignment. The conditional `export` keeps it genuinely unset, so a prompt
file's `[ -n "$PLOT_CAPABILITIES" ]` probe means what it says.

**So the prompt file guards the three with `[ -n ... ]`**, which is correct for
a variable that is set and empty, and the template's existing
`${cap_args[@]+"${cap_args[@]}"}` stays as it is, which is correct for an array
that may be unset. The two idioms are not an inconsistency: they guard different
absences, and a plan that unified them would break one of the two cases.

**Dispatch is not changed.** Extending the conditional export to all four would
be more uniform and would touch a shipped v2.17.0 code path that works today,
for no behaviour a `-n` test in the prompt file does not already give.

### Proving it, without launching an agent

**The Done-when cannot read a live process.** The worker launches detached, Plot
never composes the command line, and a `ps` reading is timing-sensitive and
costs a real agent run — the flake class this repo has measured repeatedly under
load.

**So the prompt file prints what it built, on request.** `PLOT_PRINT_INVOCATION=1`
makes `.plot/worker-prompt.sh` echo the argv it assembled and exit 0 **without
launching**, immediately before its `claude` line (`worker-prompt.sh:113`). One
guard, and the whole chain is observable in one deterministic command:

```
PLOT_PRINT_INVOCATION=1 plot-dispatch.sh --agent reviewer <slug> --dry-run
```

**It goes in the template as well as this repo's copy**, for the same reason the
interpolation does: an adopting project cannot verify its own charter otherwise.

**It is a debug hook and not a contract.** Nothing in Plot reads it, nothing
branches on it, and a prompt file that omits it simply cannot be probed this way.

### Why the prompt file is where the invocation lives, and stays there

`.plot/worker-prompt.sh` is a per-project file, uninstalled by Plot after the
first write. That is deliberate — *"Plot exports the variables and cannot write
the invocation"* — because the harness is a project's choice and its command
line is not Plot's to compose. So this plan writes the interpolation into the
template and this repo's file, and adds no code to Plot that builds a command.

## Slices

### A charter reaches the agent it declares (Branch: feature/a-charter-reaches-the-agent-it-declares)

- `feature/a-charter-reaches-the-agent-it-declares` — add `--agent <name>` to `plot-dispatch.sh` setting `PLOT_AGENT`; interpolate `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` into the invocation in `skills/plot/templates/worker-prompt.sh`, each guarded by `[ -n ... ]`; reinstall `.plot/worker-prompt.sh` from that template, carrying its project-specific `claude -p` prompt text across; add the `PLOT_PRINT_INVOCATION=1` probe to both; declare one read-only reviewer charter under `.plot/charters/`; and prove the four fields reach the argv

**Done when** a read-only reviewer charter exists under `.plot/charters/`;
`plot-dispatch.sh --agent reviewer` selects it; `PLOT_PRINT_INVOCATION=1` prints
an argv carrying the charter's `model` and `effort` and a `--disallowedTools`
bearing the read-only deny list — **read from the printed argv, never inferred
from the charter file**; the same probe with no `--agent` prints an argv
**byte-identical** to today's, which is the property `plot-dispatch.sh:770`
promises and the case the `[ -n ... ]` guards exist for; both existing refusals
still fire (an unbelievable charter, and a harness not on `PATH`); this repo's prompt
file matches the template but for its own `claude -p` prompt text, which is
preserved; and `pnpm run test:contracts` passes.

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
