# Round 1 — moderation

Panel: skeptic, operator, domain. Positions: amend, amend, amend (unanimous).

## What each juror looked at

- **Skeptic:** measured `CLAUDE.md` and its history, the skill listing's budget, and the first-request attachments of 12 worker transcripts (connector list, agent listing, plugin skills).
- **Operator:** counted `Skill`, slash, `Agent` and MCP use in 243 worker transcripts since 2026-09-28, checked which plugins reach a worker through `--settings`, and read `plot-deliverable-search.sh`'s corpus.
- **Domain:** read every reader of the table (skills, scripts, tests, `AGENTS.md`), counted scripts and bundles without a row, and traced how panel jurors and the reviewer charter are started.

All three read files and transcripts. None ran a worker with a changed configuration, so every saving in the plan is still a prediction.

## Agreements

1. Slice 1's numbers hold, and nothing reads the table from `CLAUDE.md`.
2. `AGENTS.md:38` holds a stale copy the plan missed.
3. Nothing stops the table from growing back; the 56k target had about 900–1,400 chars of slack after a week that added 36.5k. A CI gate is needed.
4. The measurement was neither repeatable nor decisive: the usage script is outside the repository, and the worker baseline varies by about 10k tokens on one day.
5. Slice 3 is a rule with no check after it lands.
6. Slice 4 compared Opus and Sonnet once, with no control and no definition of a match.

## Findings by one or two jurors

- **The deliverable search would match the new README** (operator): `plot-deliverable-search.sh:115` searches `skills/plot/scripts`.
- **The connector list is the largest removable item** (skeptic): 47,385 chars in 10 of 12 workers; the eight candidate plugins cost about 1.1k chars of an already capped skill listing.
- **"Used" must count subagents, MCP tools and hooks** (operator): 0 `Skill` calls and 0 slash commands in 243 transcripts, but workers spawned superpowers' and oh-my-claudecode's `code-reviewer` and called oh-my-claudecode's MCP tools. The user-level `CLAUDE.md` names superpowers' skills.
- **The row rule is already broken** (domain): 14 of 59 scripts and 19 of 36 bundles have no row, so a row check must be a ratchet.
- **Only slice 1 ships in Plot** (domain): slices 2 and 3 change this repository's configuration and publish no changelog entry.
- **No charter governs panel jurors** (domain): `reviewer.json` reaches an agent only through an `agent: reviewer` annotation, which no plan on main uses.
- **`--strict-mcp-config` may also remove plugin MCP servers** (domain).

## Decisions (operator, 2026-10-02)

- Slice 2 starts with the connector list and keeps superpowers and oh-my-claudecode.
- Slice 4 is dropped.
- The usage script stays outside the repository; Notes records its sha256 and raw output with each figure.

## Shared blind spot

No juror started a worker with the changed configuration. The controlled pair the amended plan requires is the first measurement of any saving.
