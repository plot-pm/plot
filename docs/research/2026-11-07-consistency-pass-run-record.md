# Consistency pass: run record

One section per run of [the step](2026-11-07-consistency-pass-step.md). Append a section after each run; fill the `Outcome` column after the build.

## Runs

No run is recorded yet. No plan was available to run the pass on when this record was written, so the trial's first run is still open. The replay that motivated the trial (17.5 minutes, 101 tool calls, 24 flags: 5 confirmed, 3 refuted, 16 untested) ran on a plan from a private workspace after its build and is not a run of this trial.

## Template

Copy this block for each run.

```markdown
### <plan slug>

- **Plan slug:** <slug>
- **Commit read:** <sha; for `Review: pr`, the plan PR head at the run>
- **Run on:** <date>
- **Wall time:** <minutes>
- **Tool calls:** <count>
- **Fit of the severity scale:** <where `blocks`, `misleads` or `cosmetic` fitted badly, or "no issue">

#### Flags

| # | Plan line | Source line (path at commit) | Severity | Outcome |
|---|---|---|---|---|
| 1 | <quoted> | <quoted, `path:line`> | blocks / misleads / cosmetic | confirmed / refuted / untested |

#### Claims found consistent

- <claim> — <source checked, `path:line`>

#### Marked `live check`

- <claim> — <what only a live system answers>

#### Tally (fill after the build)

- Flags: <n>; confirmed: <n>; refuted: <n>; untested: <n>
- Claims found consistent: <n>
```

Keep untested flags out of both the confirmed and the refuted count.
