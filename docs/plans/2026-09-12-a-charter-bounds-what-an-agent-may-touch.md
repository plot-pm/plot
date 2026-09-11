# A charter bounds what an agent may touch

> `capabilities` becomes a tool scope the harness enforces, so a reviewing agent cannot edit what it reviews.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** an-agent-is-declared-and-corrected
- **Review:** pr
- **Impl:** own branches

## Changelog

- A charter's `capabilities` list bounds the tools its agent may use. An agent declared read-only cannot write, whatever its prompt says.

<!-- Board impact: none. The charter is committed and the board reads manifests. -->

## Motivation

**Every differentiation Plot can express today is a rule.** A charter names a prompt, and a prompt is text an agent reads and can reason past. CLAUDE.md's own test: *"Can you answer 'Did I complete this?' without actually doing the work? If yes, it's a rule."* An agent asked in prose not to edit the code it is reviewing can answer yes without it being true.

**The measured case is a reviewer that fixes in place.** CLAUDE.md already draws this line for a different actor: *"a dispatched worker's changes are reviewed as code and a master agent's hand edits are not. Every mistake above was invisible to review: no diff of a script, no test, no PR."* A review agent with write access is a master agent with a nicer name.

**A tool scope is a gate.** The harness refuses the call. There is no prompt wording that reaches around it, and no way to report the work as done without it having been done.

## Design

### Approach

`capabilities` is a list of names; the charter maps each to a tool set the harness understands, and `start_worker` passes the resolved set to the launch.

The mapping lives in the **charter**, not in Plot. Plot has no opinion about what an agent may do — Principle 5, *"Plot contains zero hardcoded project names, paths, or configuration"* — so it carries the list and the adopting project says what the names mean.

A charter declaring no capabilities gets no scope, which is the estate today and stays the default.

### The scope is named per harness, because the flag is

Different harnesses spell a tool restriction differently, and Plot must not learn any of the spellings. The charter names the capability; the **prompt file** turns it into the flag, the same division [an-agent-declares-what-it-runs](2026-09-12-an-agent-declares-what-it-runs.md) draws for the model.

So `PLOT_CAPABILITIES` is exported as a list and the prompt file decides what to do with it. A prompt that ignores it produces today's behaviour — an unbounded agent — which is the honest failure mode: **no scope is not a silent scope.**

### A capability is not a routing key

This slice makes `capabilities` *bound* an agent. It does not make a slice *ask* for one.

Those are two features and the second is larger: a slice must gain a field, the plan format must carry it, and `matchQueue` must gain a predicate. `matchQueue` is *"the assignment lock and there is only one"*, so a change there is a change to the one place that guarantees one slice to one agent.

Keeping them apart means this slice ships a gate with no routing, which is useful on its own: an operator dispatching a reviewer by hand gets the bound.

### Open Questions

- [ ] Where does the capability-to-tools mapping live in the charter — a map on the charter itself, or a convention the prompt file owns? A map is more declarative; a convention keeps the schema from learning harness vocabulary.
- [ ] Should an unbounded agent warn? An agent with capabilities declared and a prompt that ignores them is silently unbounded. A warning at launch costs nothing and names the gap.

## Slices

### A charter bounds its agent's tools (Branch: feature/a-charter-bounds-what-an-agent-may-touch)

The `PLOT_CAPABILITIES` export, the shipped prompt template's handling of it, and the warning an agent gets when it declares capabilities its prompt ignores.

## Notes

This is the slice that makes a reviewing agent safe to add. Until a tool scope is enforced, *"the reviewer must not edit"* is a sentence in a prompt, and this estate has measured what happens to sentences in prompts.
