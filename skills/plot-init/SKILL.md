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
| 3. Write config and skeleton | Small | Two script calls: `plot-write-config.sh` owns the config section and the `.gitignore` line, `plot-install-prompt.sh` owns the worker prompt. Composing the answers file from step 2 is transcription; every decision inside the write is `composeAdoption`'s |
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
`package.json`, the most frequent ticket prefix and how often it occurred, how
many subjects match each commit notation, the CI system it found evidence for,
planning directories that already exist, which hub docs are present, whether a
`## Plot Config` is already there, and how many German words the hub docs
carry.

**Every count is a measurement and none is an answer.** The probe reports a
prefix seen once as a prefix seen once; whether that is a scheme is a rule's
decision, not a collector's.

**Then ask the domain what the readings propose:**

```bash
../plot/scripts/plot-detect-repo.sh | ../plot/scripts/board/plot-propose-stack.mjs
```

It answers four questions, each carrying its evidence: `commitStyle` (the
notation and how many of how many subjects carried it), `ticket` (the prefix or
`null`, with the same two numbers), `language`, and `node`. **The thresholds
live in `packages/domain/src/rules/stack.ts` and must not be recomputed here**
— *two matching subjects make a style*, *two occurrences make a scheme*, *three
German words make a German repository* were prose an agent was asked to follow
until 2026-09-08, and a rule an agent is asked to follow is eventually
violated. A missing bundle names its repair (`pnpm build:board`); all fifteen
are tracked in git, so it can only be missing from a broken install.

**`ticket` and `ci_system` are the stack's two signals**, and step 2 turns each
into a config key. They are readings, not answers: a recurring prefix says a
ticket scheme is in use, and a `Jenkinsfile` says a Jenkins pipeline is
described here. Neither says which system a team actually uses, which is why
both are proposed and neither is written unconfirmed.

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
with it.** When the proposal carries a `ticket.prefix`, say what was found and
what it proposes in one line:

> Found `QUACDS` in 38 of 80 commit subjects → propose `Tracker: jira`.

A bare `jira` teaches nothing; the count is what lets a reader confirm or
reject in one read. `/plot-init` already prints the ticket scheme this way.

**Read `ticket.prefix`, never the probe's `ticket_prefix`.** The probe reports
every prefix it saw, a lone `ONEOFF-1` included, with the count beside it;
`ticket.prefix` is `null` where no count cleared the bar, and `ticket.matched` /
`ticket.outOf` are the two numbers to print.

**The prefix is one-directional.** `ABC-123` is Jira's convention, and Linear
and GitHub issues carry prefixed keys too — so it proposes and a person
confirms. **Absence proves nothing:** a `null` `ticket.prefix` is not evidence
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
> The refusal is for the *absence* of a signal, never for its presence. With a
> `null` `ticket.prefix` there is nothing to propose, and step 2's own stop
> covers it.

#### The ticket prefixes

**The same measured prefix seeds `Ticket prefixes`, and the seed is one
element of a list a person completes.** `Ticket prefixes` is what
`plot-host.sh issue-list` puts in the Jira query's `project IN (…)`, so a
repository that declares it gets an inbox holding its own tickets and one that
declares nothing keeps the instance-wide query. Ask for the whole list:

> Found `QUACDS` in 38 of 80 commit subjects. Which Jira projects hold this
> repository's tickets? (`QUACDS`, or `QUACDS, QUAWEB, QUAPI`)

**Ask for the rest, because the probe knows of one.** `plot-detect-repo.sh`
counts every prefix and reports the most frequent, so the seed is complete only
where the repository maps to a single project. Measured on the repository issue
#850 reports: scoping to the measured prefix alone shows 3 of 12 issues and
hides two other projects' work under a heading claiming nobody planned it —
which is the same lie the instance-wide inbox tells with the projects reversed.
`composeAdoption` names that gap on a one-element list; the question is what
lets a person close it before it is written.

**Declining writes no key, and that is an answer.** The inbox stays
instance-wide, which is what every repository had before the key existed. Put
the confirmed list in the answers file's `ticketPrefixes`; an empty list is the
decline, and the rule omits the key rather than writing it blank.

**This key is not `Branch prefixes`.** They will sit near each other in the
adopted repository's config and they are unrelated: `Branch prefixes` holds
`idea/, feature/, bug/` and shapes branch names; `Ticket prefixes` holds Jira
project keys and shapes one query.

> **Unattended (`PLOT_UNATTENDED=1`):** the *proposal* survives and the
> *question* does not — as for the tracker. Put the measured prefix in
> `ticketPrefixes` alone and let the rule announce its gap:
> `PLOT-UNASKED: Which Jira projects hold this repository's tickets? — default — seeded Ticket prefixes from QUACDS in 38 of 80 subjects; the inbox hides every issue in this repository's other projects until the rest are added`
>
> With a `null` `ticket.prefix` there is nothing to seed, so `ticketPrefixes`
> stays empty and no key is written — the inbox is instance-wide, which is
> today's behaviour and needs no disclosure.

#### The CI system

**`ci_system` proposes `CI:`, with its evidence — and `proposeCi` decides
which.** The probe reports which signals it found; the domain turns them into
one of three answers, and adoption reads `ci` from the proposal rather than
re-deriving it:

| `ci.answer` | Proposal | Evidence to print |
|---|---|---|
| `propose`, `proposed: 'jenkins'` | `CI: jenkins` | a `Jenkinsfile` |
| `propose`, `proposed: 'github-actions'` | `CI: github-actions` | `.github/workflows/` |
| `ask` | **ask**, naming every string in `ci.found` | both were found |
| `silent` | write no key | no CI evidence in the tree |

**One signal proposes, two signals ask, and the rule holds it.** Where both
signals are present, do **not** tie-break on the git host — a team on GitHub
running Jenkins is common, and a silently wrong `CI:` sends every build-status
lookup to the wrong system:

> Found a `Jenkinsfile` and `.github/workflows/`. Which runs your PRs?

**A question carries no proposed word.** An `ask` has no `proposed` field, so
there is nothing to read past the question — which is why the rule is a value
rather than a `jenkins` beside an `uncertain: true`. The thresholds and this
rule both live in `packages/domain/src/rules/stack.ts` and must not be
recomputed here.

**`none` is a reading, not a key.** The rule answers `silent` where it found no
evidence, and adoption writes nothing rather than recording a `CI: none` the
repo never chose. Say what was read.

**It reads files and asks nothing about credentials.** Whether `jen`
authenticates is `/plot-board-setup`'s question, and it already asks it.

**An absent `ci_system` writes no key and says so.** Where the probe reports no
`ci_signals` at all, `ci` is `null` — a fourth answer, and not the `silent` the
rule gives for a tree that shows neither signal. A probe that did not look
leaves adoption with nothing to propose — which is not the same as `none`. Say
the CI system was not read, and continue; every other step is independent of
it.

> **Unattended (`PLOT_UNATTENDED=1`):** a single signal still proposes; two
> signals refuse rather than guess, for the reason above.
> `PLOT-UNASKED: Which CI runs the PRs? — refused — both signals found, no CI key written`

#### The Jenkins instance

**Where `CI: jenkins` is proposed, propose `Jenkins instance` too.** Without
this key the connector refuses: `plot-host.sh:677` exits 3 naming three
repairs, which is right behaviour and not the outcome the goal describes — *a
teammate clones a repository, runs `/plot-init`, and sees real build status,
without being told which keys to set*. A green adoption and a blank board is the
failure this question prevents, so it belongs beside the `CI:` proposal rather
than in `/plot-board-setup`.

**Read `ciInstance.slug` and `ciInstance.ask`, never the probe's
`jenkins_host`.** The probe reports the host a self-describing doc names; the
rule decides what that proposes and what is left to ask. **The rule names no
vendor** — `packages/domain/src/rules/stack.ts` calls it a CI instance because a
connector belongs in `adapters/`, and CI's *"The domain names no vendor"* gate
refuses the other spelling. The probe is a shell script and says `jenkins_host`,
because grepping for a Jenkins hostname is exactly a vendor's business.

| `ciInstance.ask` | What to do |
|---|---|
| `path` | propose the slug with its evidence, ask the container path only |
| `both` | ask for the instance and the job, naming why |
| `none` | nothing to ask — the CI is not Jenkins, or is still undecided |

**The value is `<slug>/<job/path>`, and only the slug is measurable.** The
container path is a fact about the Jenkins job tree; reading it would need
credentials adoption does not have. That is the same split adoption already
makes for Jira, whose base URL is asked for the same reason.

**One question where the slug was found:**

> Found `jenkins-ci-webbloqs.internal.quatico.dev` in your README. Which job
> builds this repository? (e.g. `quaweb/continuous-build`)

**Two where it was not — and this is the normal case, not the edge one.** A
`Jenkinsfile` says *Jenkins builds this* without saying *which Jenkins*, and
nothing requires a repository to link its pipeline:

> A `Jenkinsfile` says Jenkins builds this repository. Which instance, and
> which job?

**The fallback is a question, never a default.** There is no plausible instance
to invent — a slug is site-specific, and a wrong one produces `NOT reachable`,
which a reader cannot tell from a Jenkins that is down.

**An unanswered question writes what is left.** With a slug and no path, write
the slug alone: `plot-host.sh:566` treats a bare-host instance as *list at the
root scope*, so a half-answer degrades to a reading that is wrong but visible.
With neither, write no key and say so — a `Jenkins instance` invented to fill
the field is the silent misconfiguration `/plot-init` refuses everywhere else.

**Write it beside the `CI:` key:**

```markdown
- **CI:** jenkins
- **Jenkins instance:** jenkins-ci-webbloqs.internal.quatico.dev/quaweb/continuous-build
```

> **Unattended (`PLOT_UNATTENDED=1`):** the *proposal* survives and the
> *question* does not, as for the tracker. A measured slug is written alone and
> the gap is named; an unmeasured one writes nothing.
> `PLOT-UNASKED: Which Jenkins job builds this? — default — proposed the slug from the README, job path unset; builds list at the root scope until it is added`
> `PLOT-UNASKED: Which Jenkins instance, and which job? — refused — a Jenkinsfile was found and no doc names an instance; no key written, the connector will refuse at the first build lookup`

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

**Do not write `## Plot Config` by hand.** Put the answers in a file and call
the command that owns the write:

```bash
cat > /tmp/plot-answers.json <<'JSON'
{
  "hub": "",
  "definitionOfDone": ["test", "lint", "typecheck"],
  "tracker": "jira",
  "trackerUrl": "https://acme.atlassian.net",
  "ticketPrefixes": ["QUACDS", "QUAWEB"],
  "ci": "",
  "worktreeRoot": ""
}
JSON

../plot/scripts/plot-write-config.sh --answers /tmp/plot-answers.json
```

**Every field is what step 2 confirmed, and `""` means *nobody answered*.** An
empty `hub` lets the command read the probe's own list — one doc is not a
question; two are, and it refuses. An empty `worktreeRoot` takes `.worktrees`
with the matching `.gitignore` line. An empty `definitionOfDone` is **not** an
empty Definition: it is the unanswered question, and the command refuses. An
empty `ticketPrefixes` is a **declined** proposal and refuses nothing: no
`Ticket prefixes` key is written and the inbox stays instance-wide.

**IT ASKS `composeAdoption` AND STOPS ON ITS ANSWER.** The keys, their order,
their values and whether the write may happen at all are the rule's
(`packages/domain/src/rules/adoption.ts`), and the proposals inside them are
`proposeStack`'s. **This step composed that section as prose until 2026-09-09**
— an agent copied a markdown block and filled it in, so there was no
invocation to check and no rule that could fire. Adoption is the one command
that writes into a repository Plot does not own, which makes a wrong write the
most expensive one Plot performs.

**Read what it printed and say it.** The JSON on stdout carries the keys that
landed, the `.gitignore` line, and a `gaps` list — a `Tracker:` with no base
URL, a `CI:` refused because both signals were found. Those are what the
adopted repository has to announce; report each one.

**Four refusals, each naming what would end it:**

| refusal | what it means | what ends it |
|---|---|---|
| `already-adopted` | a hub doc carries a `## Plot Config` | edit that section; adoption is done |
| `hub-ambiguous` | `CLAUDE.md` and `AGENTS.md` both exist | put the choice in `hub` |
| `answer-missing` | the Definition of Done is unanswered | put the gates in `definitionOfDone` |
| unreadable input | the answers file is not JSON | it names the file and the parse error |

A refusal writes nothing at all — not the section, not the `.gitignore` line.
`--dry-run` prints both without writing either.

**The posture keys are still yours to add** (`Plan PRs`, `Implementation
home`, `Hosts plans`), and only where the answers are not the default: an
adopting repo should not start with a wall of settings it never chose. The
command writes the keys the rule decides and no others, so these are a
deliberate second edit rather than a gap.

**The `.gitignore` line comes with the `Worktree root`** and the command writes
it — the half of that decision that cannot be skipped. It appends and never
rewrites, skips a line already there, and writes none at all for an absolute
root, which lies outside the repository and needs no rule.

**THIS IS A FILE ADOPTION HAS NEVER TOUCHED**, and it is worth pausing on.
Everything else in this step lands in Plot's own territory — a config section,
`docs/plans/`, `.plot/`. `.gitignore` is read by every tool the team uses, so
it is written only on the confirmation step 2 already took, and only appended
to.

**Do not print it for the user to paste.** A configured root with no ignore
rule turns every dispatched desk into untracked files in `git status`, and the
operator's next `git add -A` stages a whole checkout. Leaving the line to a
human is the most likely way to arrive at that.

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
2, and the repo's own content language if `language.language` says so. A
`null` there means there was no hub doc to sample, which is not the same
reading as English — leave the template's wording alone.

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
| `commitStyle.style` proposed | Record it in the Plot Config, with its count | A reviewer agent aligned to the wrong notation flags correct commits |
| `has_settings: false` and Plot is used as a plugin | The `.claude/settings.json` block enabling the plugin | Merge into an existing file, never overwrite |
| Repo has `docs/stories/` | Note that `story-tracking` pairs with it | It is a companion, not a spoke — it works standalone |
| Repo has `docs/sessionlogs/` (or a session-wrap tool is in use) | A `## Session Wrap Up` section in the hub | Session-scoped tools write the log; Plot only supplies the plot-shaped facts |
| Repo has a plan directory with plans in it | `/plot-board-setup` — a local Kanban view of those plans | The board is first-class and gated in the Definition of Done, but nothing else in adoption mentions it |
| Repo dispatches agents (a `Worktree root` key, or `.plot/agents/`) | The `post-commit` commit record | Several writers to one plan estate is where a commit silently reverts a file it never edited; the record is what makes the next one diagnosable |
| **Plot is being adopted at all** | **Plot's gates as `PreToolUse` hooks** | `hooks/hooks.json` is `${CLAUDE_PLUGIN_ROOT}`-relative, so any install that is not the plugin gets no gates and nothing says so |

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

**The gates**, when offered, are installed by the script and never by hand:

```bash
../plot/scripts/plot-install-hooks.sh --check   # ask first; writes nothing
../plot/scripts/plot-install-hooks.sh           # then install
../plot/scripts/plot-install-hooks.sh --verify  # then prove it fires
```

**Offered on every adoption, because the signal is the adoption.** Unlike the
commit record, whose value depends on a measured defect, the gates protect the
lifecycle this command is installing. `hooks/hooks.json` ships with the plugin
and every path in it is `${CLAUDE_PLUGIN_ROOT}`-relative — a repository that
vendors the skills, or clones the repo, gets **no gates at all**. A missing
gate does not error; it permits, and the first evidence is a plan whose phase
disagrees with its record.

**State what they refuse, plainly, and let the operator decline.** A repository
without gates works. Being told it has none is the deliverable:

- `plot-phase-gate.sh` blocks an implementation commit while the governing plan
  is Draft. Plan-only commits pass, and it fails open.
- `plot-state-gate.sh` blocks a commit that **changes** a `State:` line in a
  plan or sprint file unless the script that owns that write made it, proved by
  a receipt no editor can forge.
- Whatever else `hooks/hooks.json` registers — the set is read from that file,
  never hardcoded, so a gate added later is installed by the same command.

**It never overwrites.** A repository may run its own `PreToolUse` hooks for
its own reasons, and the script cannot tell an important one from an abandoned
one. It reports `present`, names the entries to add, keeps the rest, exits 3.

**A gate already registered by the plugin reports `current` and is not added
again**, and that is correctness rather than tidiness: the state gate spends
its receipt when it clears, so two registrations mean the second reader finds
it spent and refuses a write that was properly owned.

**If `.claude/settings.json` cannot be written, print the block and continue.**
An unwritable settings file already costs slash-command convenience and nothing
more — never fail the whole adoption on one blocked step.

**The written file is not the evidence — the block is.** `--verify` builds a
guarded condition in a scratch repository and requires the refusal. Report what
it says, per gate.

`plot-state-gate.sh` shipped registered in `hooks/hooks.json` and no plugin
release ever carried it, so the gate documented as closing four measured hand
edits had never enforced anything on any machine. Nobody noticed, because a
missing gate does not error — it permits. A step that writes a file and reports
success reproduces that exactly.

**`unverified` is never `installed`.** Measured: `plot-state-gate.sh` exits 0
with empty stderr both when it was never invoked and when it failed open, so
"the commit worked" cannot tell an installed gate from an absent one. Only the
refusal is evidence. A gate reported `unprobed` — `plot-phase-gate.sh` needs a
remote a scratch repo has no way to supply — went unproved, and saying so is
the honest answer rather than a gap.

**A failed verification does not fail the adoption**, the same rule as the line
above: report `unverified`, name the gate and the reason, and continue. A
repository with unproved gates works; being told is the deliverable.


> **Unattended (`PLOT_UNATTENDED=1`):** a hook changes how the operator's own
> tool behaves, so it is NOT installed without an answer. `--verify` asks
> nothing and writes nothing, so it still runs where the gates were already
> installed, and reports `unverified` where they were not — which is the true
> answer for a repository that just declined them.
> `PLOT-UNASKED: Install Plot's gates as PreToolUse hooks? — refused — a hook changes the operator's own tool; run skills/plot/scripts/plot-install-hooks.sh to add them`


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
- **Never write `## Plot Config` by hand.** `plot-write-config.sh` owns that
  write and `composeAdoption` decides it. The section was skill prose until
  2026-09-09 — a markdown block an agent copied — so no rule could refuse an
  already-adopted repository, and nothing recorded which keys a repository was
  meant to get.
- **Never proceed past a refusal from that command.** Four are named and each
  says what would end it. A refusal is the end of the write, not advice: an
  `already-adopted` repository worked around by hand gets two `## Plot Config`
  sections, and `plot-config.sh` reads the first.
- **Never overwrite a hub doc.** The command appends the config section and
  preserves everything else verbatim.
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
- **Never write `Tracker: none` from silence.** A `null` `ticket.prefix` is
  not evidence against a tracker — half of repositories carry no prefix. Ask,
  or leave the default.
- **Never recompute a threshold the rule owns.** *Two occurrences make a
  scheme* is `proposeTicket`'s, and a second copy in an agent's head is the
  defect this seam removed.
- **Never tie-break the CI system on the git host.** A team on GitHub running
  Jenkins is common, and a wrong `CI:` key sends every build-status lookup to
  the wrong system. Two signals ask.
- **Never guess the Jira base URL.** It is nowhere in git history. Ask for it,
  or — unattended — write the key without it and say the URL is missing.
- **Never write the measured prefix as the whole of `Ticket prefixes`.** The
  probe reports the most frequent of the prefixes it counted, so a repository
  mapping to three Jira projects seeds one. Ask for the list; a one-element
  answer is written with its gap named.
- **Never write `Ticket prefixes` empty.** An empty key reads as *this
  repository has no projects* and changes nothing about the query. A decline
  writes no key — put an empty `ticketPrefixes` in the answers file.
- **Never install a git hook without an answer.** `post-commit` runs on every
  commit on the operator's machine, and git ships no hooks on clone for that
  reason. The record is offered; it is never a side effect of adoption.
- **Never overwrite `.plot/worker-prompt.sh`.** The installer refuses to; do
  not work around it by hand. A project's prompt wording is the project's, and
  an out-of-date invocation is one line inside it.
- **Never write `.gitignore` without the confirmation from step 2**, and never
  rewrite it — append. Every tool the team uses reads that file.
- **Never write the `Worktree root` key without the matching ignore line**, or
  the other way round. They are one decision, `plot-write-config.sh` performs
  both, and a key on its own is what turns a desk into untracked work in the
  repository root.
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
| Writing the measured prefix as the complete `Ticket prefixes` | The inbox shows one project's issues and hides the rest under a heading claiming nobody planned them | Ask for the whole list; a one-element answer carries the rule's gap |
| Writing `Ticket prefixes:` with nothing after it | Reads as *this repository has no projects* while behaving exactly like the absent key | Decline writes no key; an empty `ticketPrefixes` is the decline |
| Choosing a CI system when both signals are present | A wrong `CI:` key sends every build-status lookup to the wrong system | Ask, naming both; refuse the key unattended |
| Writing `CI: none` because the probe said `none` | Records a choice the repo never made | `none` is a reading; write no key and say what was read |
| Writing the `## Plot Config` block by hand | No rule can refuse an already-adopted repository, and nothing records which keys the repo was meant to get — the defect this step's own history is | `plot-write-config.sh --answers <file>`; the block is `composeAdoption`'s |
| Appending a second `## Plot Config` beside an existing one | Every key has two answers and `plot-config.sh` reads the first, so half the config is silently the old one | The command refuses `already-adopted`; edit the section that is there |
| Filling in a Definition of Done to get past the refusal unattended | A repository is adopted with gates nobody chose, and the wrong ones gate every later merge | An empty `definitionOfDone` refuses and prints `PLOT-UNASKED`; that is the answer |
| Reading the command's exit code and not its output | A write that landed with two open gaps reports as a clean adoption | The JSON carries `gaps`; report each one |
