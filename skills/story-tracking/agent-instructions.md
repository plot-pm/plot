# Story Tracking — CLAUDE.md Snippet

Paste this section into your project's `CLAUDE.md` to enable always-on story tracking rules.

---

```markdown
## Story Tracking

Stories are **folders**: `docs/stories/{slug}/STORY-{slug}.md`

- Say "continue on {slug}" to resume work
- Say "create a story for {topic}" to start new tracked work
- See the `story-tracking` skill for full workflow

**Commit story updates frequently**: After completing each iterative task, commit and push the story file immediately. This prevents context loss across sessions and long-running tasks. Do not batch story updates — treat them as checkpoints.

Checkpoint after:
- Test run completed (record results)
- Config change made (record what and why)
- Failure triaged (record findings)
- Decision made (record rationale)
- Blocker hit or resolved (record status)
```

---

## Why This Is Needed

The `story-tracking` skill tells agents **how** to work with stories (structure, creating, resuming, updating). But skills are only active when triggered — they are not always-on.

Project-level rules in `CLAUDE.md` are always loaded. Without the checkpoint discipline rule above, agents tend to batch story updates at the end of a session or skip them entirely during long-running tasks (CI runs, multi-hour validations). This causes context loss when resuming across sessions.
