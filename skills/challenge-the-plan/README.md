# challenge-the-plan

Development notes for the deep plan interrogation skill.

> **Provenance:** adopted 2026-07-03 from
> [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills).
> Moved here because it interrogates *plans* — the design-phase companion to
> the plot lifecycle (idea → **challenge** → optional tracer → approve).
> Works on any PLAN/SPEC/STORY file; no plot conventions required.

## Implementation Notes

- **Question history tracking**: Prevents re-asking substantially similar questions across rounds
- **Deferred items**: "I don't know" / "discuss with team" responses collected in the Open Points section and re-asked in final review round
- **Adaptive depth**: Starts with gaps/assumptions, digs deeper based on user engagement
- **Many rounds expected**: ~5-10 rounds for comprehensive coverage due to 4-question limit per round
- **Tool compatibility**: Uses `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for structured multi-choice questions
- **Plain text state**: Open Points section in the plan file replaces JSON metadata for better collaboration and readability

## Consistency pass

An opt-in mode, `/challenge-the-plan consistency <plan>`, added after one replay and no recorded trial run (the run record holds none). One agent lists the claims a plan takes from outside itself, checks each at a commit with `git show <commit>:<path>`, and writes each contradiction into the plan's `### Open Questions` with the quoted source line, the plan line and a severity (`blocks`, `misleads`, `cosmetic`; a working draft).

- **Why a mode of this skill:** it is a design-phase step and needs no new spoke or helper script. The alternatives were a `plot-consistency` spoke and a `/plot-panel` lens with file access.
- **Opt-in is per invocation.** No `## Plot Config` key exists.
- **The commit read is recorded** in a closing line of the Open Questions section; for `Review: pr` it is the plan PR head at the run.
- **It writes only into the plan's `### Open Questions`.** It adds no plan field, so the board's parser is untouched.
- **Source of the text:** `docs/research/2026-11-07-consistency-pass-step.md`; runs are logged in `docs/research/2026-11-07-consistency-pass-run-record.md`.
