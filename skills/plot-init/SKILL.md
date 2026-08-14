---
name: plot-init
description: >-
  Adopt Plot in a repository: probe what the repo already is, propose the
  Plot Config from that, create the plan/story skeleton, and offer optional
  extensions only where the repo shows it needs them. Use on /plot-init.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.1.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git; python3 improves
  detection. Works in an empty repo and in one with existing planning
  systems.
---

# Plot: Init

Set Plot up in a repository that does not have it yet.

**The guiding rule: propose, don't interrogate.** Most of what an adoption
needs — git host, quality gates, ticket scheme, commit style, what planning
already exists — is visible in the repo. Ask only about what genuinely cannot
be read, and let the user correct a proposal rather than compose an answer.

**Adoption is additive.** Nothing existing is moved, rewritten, or deleted.
A repo with four overlapping planning systems keeps all four; Plot slots
alongside and the user decides what becomes canonical.

**Input:** `$ARGUMENTS` is optional; `--dry-run` reports what would be created
and changes nothing.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Probe | Small | One script call, JSON out |
| 2. Propose and confirm | Mid | Turning signals into a proposal is judgment |
| 3. Write config and skeleton | Small | File and directory creation |
| 4. Offer extensions | Mid | Deciding what the repo actually needs |
| 5. Verify and summarise | Small | Read back what landed |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

## Steps

### 1. Probe the repo

```bash
../plot/scripts/plot-detect-repo.sh
```

Read-only. It reports the git host, Definition-of-Done candidates from
`package.json`, a ticket prefix (only if one recurs), the commit-subject
style, planning directories that already exist, which hub docs are present,
and whether a `## Plot Config` is already there.

**If `has_plot_config` is true, stop and say so.** Offer to show what is
configured and what could be added, but do not re-run adoption over a working
setup.

### 2. Propose, then confirm

Turn the probe into a **complete proposal** and present it in one block, so
the user corrects rather than composes:

> Detected: GitHub · gates `test`, `lint`, `typecheck` · no ticket scheme ·
> conventional commits · `docs/plans/` and `.omc/` already present · hub
> `CLAUDE.md`.
>
> Proposed Plot Config: plan directory `docs/plans/`, branch prefixes
> `idea/ feature/ bug/ docs/ infra/`, Definition of Done = those three gates,
> tracker `plot`, git host `github`.

Then ask only what the probe **could not** answer:

- **Definition of Done** — the probe finds candidate scripts, not which of
  them gates a merge. Always confirm; this is the one answer worth asking for
  every time.
- **Ticket scheme** — only when the probe found none *and* the repo looks
  like it might have one elsewhere (e.g. a Jira URL in the hub doc).
- **What is canonical** — only when `existing_systems` shows other planning
  systems. Ask which stays authoritative; **never propose moving files.**

Do not ask about anything the probe answered confidently. A user who is asked
to confirm their own git host learns that the tool is not paying attention.

### 3. Write the config and skeleton

**`## Plot Config`** into the hub doc — appended, never replacing content. If
both `CLAUDE.md` and `AGENTS.md` exist, ask which is the hub; if neither
exists, create `CLAUDE.md` with just this section.

```markdown
## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Git host:** <github|bitbucket>
- **Tracker:** plot
```

Add the posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`) only
where the answers are not the default — an adopting repo should not start
with a wall of settings it never chose.

**Skeleton**, each empty index anchored with `.gitkeep` (git does not track
empty directories, so they vanish on clone otherwise):

```bash
mkdir -p docs/plans/active docs/plans/delivered
touch docs/plans/active/.gitkeep docs/plans/delivered/.gitkeep
```

**Plan template** at `.plot/templates/plan.md`, copied from
`skills/plot/templates/plan.md` and adapted: the Definition of Done from step
2, and the repo's own content language if `language_hint` says so.

Sprints and stories are **not** created by default. They are optional lenses;
create them when asked.

### 4. Offer extensions — only what the repo shows it needs

Each is gated on a detected signal. **Offer nothing the probe did not
justify**, and say what triggered the offer:

| Signal | Offer | Why |
|---|---|---|
| `git_host: bitbucket` | A `bb`-not-`gh` note in the hub | Plot's host adapter handles both, but agents reach for `gh` by habit |
| `existing_systems` non-empty | A `docs/plans/README.md` recording what stays frozen and what is canonical now | Several planning systems without a written boundary is where drift starts |
| `commit_style` detected | Record it in the Plot Config | A reviewer agent aligned to the wrong notation flags correct commits |
| `has_settings: false` and Plot is used as a plugin | The `.claude/settings.json` block enabling the plugin | Merge into an existing file, never overwrite |
| Repo has `docs/stories/` | Note that `story-tracking` pairs with it | It is a companion, not a spoke — it works standalone |
| Repo has `docs/sessionlogs/` (or a session-wrap tool is in use) | A `## Session Wrap Up` section in the hub | Session-scoped tools write the log; Plot only supplies the plot-shaped facts |

**The `## Session Wrap Up` section**, when offered, tells whatever writes
session logs which Plot facts belong in one:

```markdown
## Session Wrap Up

When writing a session log, include the Plot context for this session:

    skills/plot/scripts/plot-context.sh

It reports the governing plan (if the current branch belongs to one), its
phase, its wave, and its PRs — as JSON. An empty `plan_slug` means the branch
belongs to no plan; say that rather than guessing, since a durable log
attributed to the wrong plan outlives the session that mis-attributed it.

Record decisions and their **rejected alternatives** in the log, not in the
plan: a plan is frozen on approval and says what will be built, while a log
stays amendable and says why it was built that way.
```

Plot deliberately does **not** write session logs. Tools scoped to a session
(such as a wrap-up skill) reconstruct compacted history, classify session
types, and guard against parallel sessions — none of which a plan-shaped tool
can know. Supplying facts to a better-placed writer beats competing with it.

**On writing `.claude/settings.json`:** if it exists, merge and preserve every
key. If it is malformed or unwritable, **print the block and ask the user to
add it — then continue.** A blocked settings file costs slash-command
convenience, nothing else; the whole lifecycle works with plain git.

### 5. Verify and summarise

```bash
../plot/scripts/plot-config.sh get "Plan directory" "docs/plans/"
```

It should echo the configured value — that proves the config parses, which is
the one thing worth checking mechanically.

Then orient (Principle 11): what exists now, what falls out next, and why.

> Plot is set up. `docs/plans/` is empty and that is the normal starting
> state. `/plot-idea <slug>: <title>` writes the first plan; `/plot` tells
> you where things stand at any point.
>
> Deferred to you: <anything the user must add by hand>.

## Guardrails

- **Never move, rewrite, or delete existing files.** Adoption is additive.
  Existing planning systems get *described*, not migrated.
- **Never overwrite a hub doc.** Append the config section; preserve
  everything else verbatim.
- **Never fail the whole adoption on one blocked step.** Steps are largely
  independent: if a file cannot be written, say exactly what the user should
  add and where, then continue.
- **Never invent a Definition of Done.** The probe finds candidates; only a
  human knows which gate a merge.
- **Never claim a detected value is certain.** Everything from the probe is a
  proposal.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Asking the user to confirm facts the probe read | Reads as inattentive; buries the questions that matter | Ask only what the probe could not answer |
| Creating `docs/sprints/` and `docs/stories/` by default | An adopting repo starts with empty directories nobody asked for | Both are optional; create on request |
| Migrating existing plans into `docs/plans/` | Destroys history and the user's own organisation | Describe what is frozen; move nothing |
| Overwriting `.claude/settings.json` | Silently drops the user's hooks and permissions | Merge, or ask and continue |
| Aborting when the settings file is unwritable | The whole adoption fails over the least important step | Print the block, continue |
| Adding every posture key to the config | A new adopter faces settings they never chose | Defaults stay implicit |
