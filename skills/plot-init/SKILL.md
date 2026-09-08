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
  version: 0.4.0
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
| 3. Write config and skeleton | Small | File and directory creation; the worker prompt is one script call. Appending the `.gitignore` line is mechanical — WHICH line was decided in step 2 |
| 4. Offer extensions | Mid | Deciding what the repo actually needs |
| 5. Verify and summarise | Small | Read back what landed |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

## Steps

### 1. Probe the repo

```bash
../plot/scripts/plot-detect-repo.sh
```

Read-only. It reports the git host, Definition-of-Done candidates from
`package.json`, a ticket prefix (only if one recurs), the commit-subject
style, the CI system it found evidence for, planning directories that already
exist, which hub docs are present, and whether a `## Plot Config` is already
there.

**`ticket_prefix` and `ci_system` are the stack's two signals**, and step 2
turns each into a config key. They are readings, not answers: a recurring
prefix says a ticket scheme is in use, and a `Jenkinsfile` says a Jenkins
pipeline is described here. Neither says which system a team actually uses,
which is why both are proposed and neither is written unconfirmed.

**If `has_plot_config` is true, stop and say so.** Offer to show what is
configured and what could be added, but do not re-run adoption over a working
setup.

### 2. Propose, then confirm

Turn the probe into a **complete proposal** and present it in one block, so
the user corrects rather than composes:

> Detected: GitHub · gates `test`, `lint`, `typecheck` · `QUACDS` in 38 of 80
> commit subjects · conventional commits · a `Jenkinsfile` · `docs/plans/` and
> `.omc/` already present · hub `CLAUDE.md`.
>
> Proposed Plot Config: plan directory `docs/plans/`, branch prefixes
> `idea/ feature/ bug/ docs/ infra/`, Definition of Done = those three gates,
> tracker `jira` (from `QUACDS` in 38 of 80 subjects), CI `jenkins` (from the
> `Jenkinsfile`), git host `github`, worktree root `.worktrees` (with the
> matching `.gitignore` line).

Then ask only what the probe **could not** answer:

- **Definition of Done** — the probe finds candidate scripts, not which of
  them gates a merge. Always confirm; this is the one answer worth asking for
  every time.
- **The tracker's base URL** — and only that. A recurring prefix says the
  scheme is Jira; **the base URL is nowhere in git history**, and
  `tracker-jira.ts` takes one. So adoption proposes `Tracker: jira` from what
  it measured and asks for the single thing it has no way to read. See *The
  tracker* below.

- **Which CI runs the PRs** — only when both signals are present. See *The CI
  system* below; one signal proposes and never asks.

- **Ticket scheme** — only when the probe found none *and* the repo looks
  like it might have one elsewhere (e.g. a Jira URL in the hub doc).
- **What is canonical** — only when `existing_systems` shows other planning
  systems. Ask which stays authoritative; **never propose moving files.**
- **The worktree root** — where `/plot-dispatch` puts a dispatched agent's
  desk. Propose `.worktrees` and say that the `.gitignore` line comes with it.
  Confirm both together: they are one decision, and the config key without the
  ignore rule is the defect this proposal exists to prevent.

  **A repository with its own convention keeps it.** Read what is already
  there before proposing:

  ```bash
  git worktree list
  ```

  Where worktrees already sit somewhere — beside the checkout as `plot-wt-*`
  siblings, or under a directory of their own — say how many were found and
  where, and propose **that** location rather than `.worktrees`. The ignore
  line then follows whatever the repo chose. Moving existing worktrees is
  `/plot-dispatch --migrate`'s job on a person's say, never adoption's.

  **The absent-key default is not `.worktrees`.** With no key, dispatch uses
  the repository's PARENT with a `plot-wt-` prefix — so this proposal changes
  where desks go, and that is the reason to make it rather than leave the
  default implicit. A relative value resolves inside the repo and the prefix is
  dropped.

  **This question declares no unattended shape of its own.** Step 2 already
  stops and writes nothing when `PLOT_UNATTENDED=1` is set, and its existing
  `PLOT-UNASKED` line covers the whole proposal — this key is named in what is
  printed, and no file is touched, the `.gitignore` write least of all. A
  second declaration here would be a second disclosure for one stop.

#### The tracker

**A recurring ticket prefix proposes `Tracker: jira`, and the evidence travels
with it.** When `ticket_prefix` is non-empty, say what was found and what it
proposes in one line:

> Found `QUACDS` in 38 of 80 commit subjects → propose `Tracker: jira`.

A bare `jira` teaches nothing; the count is what lets a reader confirm or
reject in one read. `/plot-init` already prints the ticket scheme this way.

**The prefix is one-directional.** `ABC-123` is Jira's convention, and Linear
and GitHub issues carry prefixed keys too — so it proposes and a person
confirms. **Absence proves nothing:** an empty `ticket_prefix` is not evidence
against a tracker, so it falls to the *Ticket scheme* question above and
**never proposes `Tracker: none` from silence**.

**Then ask for the base URL, and nothing else.** `tracker-jira.ts` takes a base
URL, and no commit subject carries one. That question is the only one this
proposal adds:

> Which Jira instance? (e.g. `https://acme.atlassian.net`)

**Write it beside the key**, as `plot-config.sh` documents (`Tracker: jira
(+ URL)`):

```markdown
- **Tracker:** jira https://acme.atlassian.net
```

> **Unattended (`PLOT_UNATTENDED=1`):** the *proposal* survives and the
> *question* does not. A measured prefix is a structural signal, so propose
> `Tracker: jira` with the URL unset — and **say the URL is missing**. A
> half-configured tracker that announces its gap beats `trackerNone` answering
> `unaskable` for a reason nobody can see.
> `PLOT-UNASKED: Which Jira base URL? — default — proposed Tracker: jira from QUACDS in 38 of 80 subjects, URL unset; issue operations stay unavailable until it is added`
>
> The refusal is for the *absence* of a signal, never for its presence. With no
> `ticket_prefix` there is nothing to propose, and step 2's own stop covers it.

#### The CI system

**`ci_system` proposes `CI:`, with its evidence.** The probe reports which
signals it found; adoption turns one signal into a key:

| `ci_system` | Proposal | Evidence to print |
|---|---|---|
| `jenkins` | `CI: jenkins` | a `Jenkinsfile` |
| `github-actions` | `CI: github-actions` | `.github/workflows/` |
| `both` | **ask** | both were found |
| `none` | write no key | no CI evidence in the tree |

**One signal proposes, two signals ask.** Where the probe reports both, do
**not** tie-break on the git host — a team on GitHub running Jenkins is common,
and a silently wrong `CI:` sends every build-status lookup to the wrong system:

> Found a `Jenkinsfile` and `.github/workflows/`. Which runs your PRs?

**`none` is a reading, not a key.** The probe says `none` where it found no
evidence, and adoption writes nothing rather than recording a `CI: none` the
repo never chose. Say what was read.

**It reads files and asks nothing about credentials.** Whether `jen`
authenticates is `/plot-board-setup`'s question, and it already asks it.

**An absent `ci_system` writes no key and says so.** The field is a proposal
like every other, so a probe that does not report it leaves adoption with
nothing to propose — which is not the same as `none`. Say the CI system was not
read, and continue; every other step is independent of it.

> **Unattended (`PLOT_UNATTENDED=1`):** a single signal still proposes; two
> signals refuse rather than guess, for the reason above.
> `PLOT-UNASKED: Which CI runs the PRs? — refused — both signals found, no CI key written`

Do not ask about anything the probe answered confidently. A user who is asked
to confirm their own git host learns that the tool is not paying attention.

> **Unattended (`PLOT_UNATTENDED=1`):** stop, and create nothing. Adoption is
> the one command whose entire output is a set of answers a team has to live
> with — and the Definition of Done question above says it is *always* worth
> asking, because the probe finds candidate scripts but cannot see which one
> gates a merge. Print the proposal in full so a person can accept it in one
> pass, and write no files.
> `PLOT-UNASKED: Confirm the proposed Plot Config (Definition of Done, ticket scheme, what stays canonical)? — stopped — proposal printed; no files created`
>
> **The tracker and CI disclosures above are part of what that stop prints**,
> not a second stop. The proposal a person accepts must carry its own gaps, so
> a `Tracker: jira` with no base URL and a refused `CI:` are named in the block
> rather than discovered when an issue operation answers `unaskable`.

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
- **Worktree root:** .worktrees
```

**Write the confirmed `Tracker:` and `CI:` values**, not the defaults shown
here. `Tracker: plot` is the fallback for a repo whose plans *are* its tracker;
a confirmed `jira` replaces it and carries its base URL. A `CI:` line appears
only where a signal was found and confirmed — the probe's `none` writes no key.

Add the posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`) only
where the answers are not the default — an adopting repo should not start
with a wall of settings it never chose.

**The `.gitignore` line**, matching the `Worktree root` just written — the
half of that decision that cannot be skipped. Append it; never rewrite the
file:

```
# The dispatch worktrees, gathered here by the `Worktree root` key rather than
# scattered beside the checkout. They are CHECKOUTS — every one is re-creatable
# with `git worktree add`, and none of them is content this repo carries.
.worktrees/
```

**Write the path that was confirmed**, not the literal `.worktrees` — a repo
that kept its own convention gets its own line. An absolute root lies outside
the repository and needs no ignore rule at all; say so rather than writing a
line that matches nothing.

**THIS IS A FILE ADOPTION HAS NEVER TOUCHED**, and it is worth pausing on.
Everything else in this step lands in Plot's own territory — a config section,
`docs/plans/`, `.plot/`. `.gitignore` is read by every tool the team uses, so
it is written only on the confirmation step 2 already took, and only appended
to. Where no `.gitignore` exists, create one holding just this block.

**Do not print it for the user to paste.** A configured root with no ignore
rule turns every dispatched desk into untracked files in `git status`, and the
operator's next `git add -A` stages a whole checkout. That outcome is the
defect this slice exists to remove, and leaving the line to a human is the
most likely way to arrive at it. A directory and a plan skeleton are larger
commitments, and adoption writes both.

**The desk's own exclusion is separate and is not written here.**
`plot-dispatch.sh` adds its marker to `.git/info/exclude` inside each desk,
because a rule living in branch content is invisible to a worktree cut from an
older branch. That one is per-clone and belongs to dispatch; this line is the
repository's.

**Skeleton**, each empty index anchored with `.gitkeep` (git does not track
empty directories, so they vanish on clone otherwise):

```bash
mkdir -p docs/plans/active docs/plans/delivered
touch docs/plans/active/.gitkeep docs/plans/delivered/.gitkeep
```

**Plan template** at `.plot/templates/plan.md`, copied from
`skills/plot/templates/plan.md` and adapted: the Definition of Done from step
2, and the repo's own content language if `language_hint` says so.

**Worker prompt** at `.plot/worker-prompt.sh`, written by the script rather
than by hand:

```bash
../plot/scripts/plot-install-prompt.sh
```

It writes the shipped template where no file exists and **never overwrites
one**. The file is what `plot-worker-loop.sh` sources on every prompt of every
agent, and until 2026-09-05 Plot shipped no template for it at all — every
adopting project wrote it from a comment inside the loop, and this repo's own
copy hardcoded `--session-id` until three agents failed their second slices
simultaneously.

**Say what landed, and that the wording is theirs.** The template's
instructions are short on purpose: only the session handling is Plot's, and
what an agent is *told* belongs to the project. Point at the file and say it is
meant to be rewritten.

**An existing file is OFFERED the update, never given it.** The script reports
`stale` when the file hardcodes a session flag and `present` when it passes
none — both exit 3, and both are answers rather than faults. Show what it said,
show the template, and let the operator decide; a project's prompt wording is
the project's, and a rewritten one is not out of date.

> `.plot/worker-prompt.sh` already exists and hardcodes `--session-id`. The
> loop decides that flag now — `--session-id` on an agent's first prompt,
> `--resume` on every one after — so an agent handed a second slice cannot
> start. The one line to change is the `session_args=(...)` assignment; the
> shipped template at `skills/plot/templates/worker-prompt.sh` shows it, and
> your wording stays yours.

> **Unattended (`PLOT_UNATTENDED=1`):** the write is mechanical and needs no
> answer, so it happens. An existing file is reported and not touched.
> `PLOT-UNASKED: Update the existing .plot/worker-prompt.sh from the template? — refused — the wording is the project's to keep; reported as <stale|present> and the file is untouched`

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
| Repo has a plan directory with plans in it | `/plot-board-setup` — a local Kanban view of those plans | The board is first-class and gated in the Definition of Done, but nothing else in adoption mentions it |
| Repo dispatches agents (a `Worktree root` key, or `.plot/agents/`) | The `post-commit` commit record | Several writers to one plan estate is where a commit silently reverts a file it never edited; the record is what makes the next one diagnosable |

**The commit record**, when offered, is installed by the script and never by
hand:

```bash
../plot/scripts/plot-install-commit-record.sh
```

**It is a `post-commit` hook, so it can never block or slow a commit**, and it
is silent on ordinary work: it writes only when a commit sets a file to content
that path already held. That is the signature of a defect measured three times
on this estate — a commit reverting a plan annotation its author never looked
at — whose cause is still unknown after three explanations were proposed and
disproved. The record exists so the next occurrence arrives with evidence
rather than a reconstruction.

**Ask before installing, and say why it is a question.** A git hook is a change
to every contributor's machine, and git deliberately ships none on clone. An
existing `post-commit` is reported and never touched — show the one line to add
and let the operator decide.

> **Unattended (`PLOT_UNATTENDED=1`):** a git hook changes the operator's
> machine, so it is NOT installed without an answer.
> `PLOT-UNASKED: Install the post-commit commit record? — refused — a git hook is a change to every contributor's machine; run skills/plot/scripts/plot-install-commit-record.sh to add it`

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

**Then name the two long-lived processes.** Plot runs a board and a supervisor,
each started by its own command. Read which prerequisite is missing:

```bash
../plot/scripts/plot-board-probe.sh
```

`artifact_source` answers where `@plot-pm/board` lives — `plugin`, `npm`,
`checkout`, or `none`. Print the block either way; the probe's answer changes
the sentence after the dash, never whether there is a line:

> Next, when you have work in flight:
>
> ```
> /plot-board --start   — the local board; <prerequisite>
> /plot-fleet --start   — supervises the agents you dispatch; <prerequisite>
> ```
>
> `/plot-board-setup` adopts the board properly — it verifies that it serves.

Fill `<prerequisite>` from `artifact_source`: on `none`, *needs
`@plot-pm/board` — `pnpm build:board` in a checkout, or install the package*;
otherwise *ready, from the <source> artifact*. Both commands read the same
package, so both lines carry the same answer.

**Name both commands whether or not the artifact is present.** `/plot-init`
runs in repositories that have neither, and offering only what works there says
nothing at all — which is how the supervisor came to be invisible. A missing
prerequisite is a fact a reader can act on; silence is not.

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
- **Never drop `/plot-board --start` or `/plot-fleet --start` from the summary
  because the artifact is absent.** The probe fills in what each command needs;
  it does not decide whether the command is mentioned.
- **Never claim a detected value is certain.** Everything from the probe is a
  proposal.
- **Never propose `Tracker` or `CI` without the evidence behind it.** A bare
  `jira` teaches nothing and cannot be checked; `jira (QUACDS in 38 of 80
  subjects)` is confirmable in one read.
- **Never write `Tracker: none` from silence.** An absent `ticket_prefix` is
  not evidence against a tracker — half of repositories carry no prefix. Ask,
  or leave the default.
- **Never tie-break the CI system on the git host.** A team on GitHub running
  Jenkins is common, and a wrong `CI:` key sends every build-status lookup to
  the wrong system. Two signals ask.
- **Never guess the Jira base URL.** It is nowhere in git history. Ask for it,
  or — unattended — write the key without it and say the URL is missing.
- **Never install a git hook without an answer.** `post-commit` runs on every
  commit on the operator's machine, and git ships no hooks on clone for that
  reason. The record is offered; it is never a side effect of adoption.
- **Never overwrite `.plot/worker-prompt.sh`.** The installer refuses to; do
  not work around it by hand. A project's prompt wording is the project's, and
  an out-of-date invocation is one line inside it.
- **Never write `.gitignore` without the confirmation from step 2**, and never
  rewrite it — append. Every tool the team uses reads that file.
- **Never write the `Worktree root` key without the matching ignore line**, or
  the other way round. They are one decision, and a key on its own is what
  turns a desk into untracked work in the repository root.
- **Never move existing worktrees.** A repo with its own convention keeps it
  and the ignore line follows it; relocating is `/plot-dispatch --migrate`'s
  job, on a person's say.
- **Never touch a desk's `.git/info/exclude`.** That rule is per-clone and
  belongs to `plot-dispatch.sh`; adoption writes the repository's line only.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Asking the user to confirm facts the probe read | Reads as inattentive; buries the questions that matter | Ask only what the probe could not answer |
| Creating `docs/sprints/` and `docs/stories/` by default | An adopting repo starts with empty directories nobody asked for | Both are optional; create on request |
| Migrating existing plans into `docs/plans/` | Destroys history and the user's own organisation | Describe what is frozen; move nothing |
| Overwriting `.claude/settings.json` | Silently drops the user's hooks and permissions | Merge, or ask and continue |
| Aborting when the settings file is unwritable | The whole adoption fails over the least important step | Print the block, continue |
| Adding every posture key to the config | A new adopter faces settings they never chose | Defaults stay implicit |
| Rewriting an existing `.plot/worker-prompt.sh` to match the template | Destroys instructions the project wrote for its own agents | Report what the script said and offer the one line |
| Installing the `post-commit` record because adoption ran | A git hook changes every contributor's machine, and nothing in the probe asked for it | Offer it on the dispatch signal, and let the operator answer |
| Treating `stale` or `present` as a failed adoption | An adoption stops over a file that runs correctly today | Both are reports; step 3 continues |
| Writing `Worktree root` and printing the ignore line to paste | Every dispatched desk becomes untracked work; the next `git add -A` stages a whole checkout | Adoption writes both, on one confirmation |
| Proposing `.worktrees` to a repo whose worktrees already live elsewhere | Adoption relocates a working arrangement nobody asked it to touch | Read `git worktree list` first; propose what is there |
| Rewriting `.gitignore` rather than appending | Silently drops rules the team depends on | Append a block; create the file only when absent |
| Writing an ignore line for an absolute worktree root | The line matches nothing — the desks are outside the repository | Say no rule is needed and write none |
| Naming the board and the supervisor only where the artifact is present | The two processes a user must start stay invisible in exactly the fresh repository this command runs in | Print both lines always; the probe writes the prerequisite, not the line |
| Leaving `Tracker` at the default when a prefix recurs | The team gets `trackerNone`, which answers `unaskable` on every issue operation and reads the same as having no tracker | Propose `Tracker: jira` from the measured prefix, with its count |
| Proposing `Tracker: jira` as a bare word | A reader cannot tell a measurement from a guess, so the whole proposal loses trust | Print the evidence: `jira (QUACDS in 38 of 80 subjects)` |
| Asking which tracker when the prefix already recurs | Interrogates the user about something the probe read | Propose from the signal; ask only for the base URL |
| Guessing the Jira base URL from the git remote | A wrong URL fails later saying nothing about adoption | Ask; unattended, write the key and name the gap |
| Choosing a CI system when both signals are present | A wrong `CI:` key sends every build-status lookup to the wrong system | Ask, naming both; refuse the key unattended |
| Writing `CI: none` because the probe said `none` | Records a choice the repo never made | `none` is a reading; write no key and say what was read |
