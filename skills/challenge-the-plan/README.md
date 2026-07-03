# challenge-the-plan

Development notes for the deep plan interrogation skill.

> **Provenance:** adopted 2026-07-03 from
> [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills).
> Moved here because it interrogates *plans* — the design-phase companion to
> the plot lifecycle (idea → **challenge** → optional tracer → approve).
> Works on any PLAN/SPEC/STORY file; no plot conventions required.

## Implementation Notes

- **Question history tracking**: Prevents re-asking substantially similar questions across rounds
- **Deferred items**: "I don't know" / "discuss with team" responses collected in Open Questions section and re-asked in final review round
- **Adaptive depth**: Starts with gaps/assumptions, digs deeper based on user engagement
- **Many rounds expected**: ~5-10 rounds for comprehensive coverage due to 4-question limit per round
- **Tool compatibility**: Uses `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for structured multi-choice questions
- **Plain text state**: Open Questions section in the plan file replaces JSON metadata for better collaboration and readability
