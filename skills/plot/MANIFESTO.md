# Plot Manifesto

Plot is a git-native planning system for software development. It is designed for teams where humans make decisions and AI agents help plan and implement, but requires nothing more than git, a forge with pull request review, and markdown. It is experimental, evolving through real-world usage, and currently in alpha.

## Core Belief

Plans belong in git. Not in a separate issue tracker, not in a project management tool, not in a spreadsheet. Plans are markdown files — written, reviewed, and versioned just like source code. They live on branches, merge through pull requests, and stay in place forever with date-prefixed filenames. Anyone with repo access can `ls docs/plans/active/` and see exactly what's in flight. No dashboard logins, no access tiers, no sync problems.

Plot works for any team composition, but it is especially designed for a specific one: **human decision-makers** working with **AI facilitators** (for refining ideas, planning, and process administration) and **AI coding agents** (implementing plans as autonomously as current models allow). In this model, humans always own the decisions — approval, prioritization, release, verification. Agents surface information, suggest actions, and do implementation work. But every step of the workflow can also be done by a human with basic git knowledge. The AI is the designed-for sweet spot, not a hard requirement.

## Principles

These are the founding beliefs that guide Plot's design. When a proposed change conflicts with these principles, the principles win.

### 1. Git is the database

Plans are markdown files committed to git. Pull requests are workflow metadata. A project board (if used) is a read-only reflection of PR state — useful to glance at, but never the source of truth. No external tracker, database, or sync API. If it's not in git, it doesn't exist.

This also makes plans transparent. Plans-as-files are more visible than backlog items in a tracker. Anyone with repo access can browse `docs/plans/active/` and `docs/plans/delivered/` without needing credentials for a separate tool. The full history of every plan — drafts, revisions, approvals — is in the git log.

### 2. Plans merge before implementation

The key design insight: the plan file lands on main *before* any implementation branch is created. Every implementation branch references a stable, approved document. Anyone with repo access can see what was promised and compare it to what was delivered.

### 3. Commands, not code

Plot's workflow commands are markdown skill instructions that an AI agent interprets — not shell scripts or compiled programs. When a PR is already merged, arguments are missing, or local state is stale, the agent adapts rather than crashing. Behavior is not perfectly deterministic, but the flexibility matters more than the precision. Separate helper scripts (`scripts/plot-pr-state.sh`, `scripts/plot-impl-status.sh`) handle mechanical data gathering — structured output that any model tier can parse. The distinction: skills interpret and adapt; scripts collect and report.

### 4. One plan, many branches

A single approved plan can spawn multiple implementation branches. Different people, different agents, different worktrees — all working on the same plan in parallel. Each branch merges independently on its own schedule.

### 5. Skills stay project-agnostic

Plot contains zero hardcoded project names, paths, or configuration. Adopting projects describe their conventions in a `## Plot Config` section of their `CLAUDE.md`. Plot discovers and adapts to whatever the project provides — branch prefixes, release tooling, changelog conventions. If a project uses changesets, Plot uses changesets. If it doesn't, Plot constructs release notes from plan files and commit messages.

### 6. Smart defaults over strict inputs

Commands discover context rather than demanding exact arguments. If there's one open plan PR, Plot proposes it. If the slug is obvious from the conversation, Plot suggests it. Missing or ambiguous input triggers a helpful suggestion, never a cryptic error. The system should feel forgiving, not bureaucratic.

### 7. Phase guardrails

Each command checks the current workflow phase before acting. An unreviewed draft cannot be approved. A plan with open implementation PRs cannot be delivered. Undelivered work cannot be released. These guardrails prevent common workflow mistakes at the point where they'd cause the most confusion.

### 8. Plans stay in place

Plan files are created with a date prefix (`docs/plans/YYYY-MM-DD-slug.md`) and never move. Symlink directories (`docs/plans/active/`, `docs/plans/delivered/`) provide filtered views by phase. Links from PR bodies and other references point to the date-prefixed file, so they never break. The date prefix sorts files chronologically and answers "when did this start?" at a glance.

### 9. Small models welcome

Facilitator tasks — reading git state, running commands, printing summaries — must work with smaller, faster models, not just frontier models. Plot defines three capability tiers:

- **Small (e.g., Haiku)** — Mechanical steps: running commands, parsing structured output (JSON from helper scripts), filling templates, printing summaries. No interpretation of unstructured content.
- **Mid (e.g., Sonnet)** — Moderate reasoning: heuristic comparisons (title similarity, version bump suggestions), discovery logic with clear rules, structured analysis where the criteria are explicit.
- **Frontier (e.g., Opus)** — Deep judgment: completeness verification (comparing plan deliverables against PR diffs), semantic gap detection in release notes, any step that requires interpreting unstructured prose against unstructured code changes.

Each skill's `## Model Guidance` section maps steps to tiers. Steps that exceed a model's tier degrade gracefully: a smaller model asks for human confirmation where a larger model might decide autonomously, but the workflow never breaks.

**Subagent delegation:** When subagents are available (e.g., Claude Code's Task tool), a mid or frontier orchestrator can delegate mechanical subtasks to small-model subagents running in parallel. Example: in `/plot-deliver` step 5, a frontier orchestrator extracts deliverables (judgment), then launches small subagents to gather PR diffs and metadata (mechanical), then consolidates results (judgment). The orchestrator handles reasoning; subagents handle data collection. This gives frontier-quality results at small-model cost for the bulk of the work.

Design implications: explicit step-by-step instructions over narrative prose, structured data over free-form parsing, concrete examples over abstract descriptions.

### 10. An agent that has gone quiet has failed, not finished

Unattended agent work must produce an observable trace — a commit, a pushed branch, a PR state change, a posted comment. Silence is a failure signal, never a completion signal. Any Plot command that runs unattended must bound how long it may run, and must ship partial work with a handover before that bound is reached rather than after.

This is the agentic case of Principle 1. Git is the database; work that never reached git did not happen, no matter how the agent narrates it. A run that ends with nothing committed and no explanation is indistinguishable from a run that never started — and must be treated as the failure it is.

## Lifecycle

Plot has four plan-level phases: **Draft**, **Approved**, **Delivered**, and **Released**.

A plan starts as a draft on an `idea/` branch. When the plan is reviewed and approved, it merges to main and spawns implementation branches (`feature/`, `bug/`, `docs/`, `infra/`). When all implementation PRs are merged, the plan is delivered — its symlink moves from `active/` to `delivered/` and the Phase field is updated. For features and bugs, a separate release step cuts a versioned tag with changelog entries. For docs and infra work, delivery is the end — it's live when merged to main.

The release phase includes a verification loop. An RC (release candidate) tag is cut from delivered plans, and a verification checklist is generated — one item per delivered feature or bug fix. The team tests against the checklist: automated CI for technical tests, manual verification for user stories. Bugs found during this endgame phase are fixed via normal `bug/` branches, merged to main, and a new RC is cut. When all checklist items pass, a final release tag is created.

- **RC tags:** `v1.2.0-rc.1`, `v1.2.0-rc.2`, etc.
- **Verification checklist:** generated from delivered plans, lives as `docs/releases/v<version>-checklist.md` (git-native, like everything else).
- **Endgame fixes:** normal branches, normal PRs, new RC. No special process.
- **Sign-off:** humans give final OK on each checklist item. Agents can guide testing but never sign off.

The `/plot` dispatcher reads the current git state and suggests the next action.

## Pacing

Not every step in the workflow should move at the same speed. Plot recognizes three pacing categories:

**Automate ASAP** — Mechanical transitions with no judgment required. These should be scripted and fast. Examples: merging an approved plan PR, creating implementation branches, delivering a plan (moving symlink), cutting an RC tag, generating a verification checklist, creating a final release tag.

**Natural pauses** — Steps where real work happens and the workflow should wait. These aren't bottlenecks; they're the point. Examples: implementing a feature on a branch, running the endgame verification checklist, writing a plan.

**Human-paced** — Steps that require a human decision. No agent should rush these. Examples: reviewing and approving a plan, deciding when to release, signing off on a verification checklist item, choosing the version number.

The meta-principle: **don't over-complicate because AI doesn't feel friction.** Every step must be executable by a human with basic git knowledge. If a workflow step can't be done by hand, it's too complex. Scripts and AI make it faster, not possible.

## Sprints

Sprints are an optional temporal lens over plans. A sprint groups work by schedule — start date, end date, MoSCoW priorities. Plans track *what* to build; sprints track *when* to ship it. Sprint files live in `docs/sprints/`, managed by `/plot-sprint`, committed directly to main. Sprints do not spawn implementation branches, so Principle 2 (plans merge before implementation) does not apply.

## What Plot Is Not

Plot is deliberately small and opinionated. These boundaries are intentional, not oversights.

- **Not a monorepo tool.** Plot works with a single repository. Coordinating releases across multiple packages or repos is out of scope.
- **Not a package publisher.** Plot handles versioning and changelogs, not npm publish or artifact distribution.
- **Not an issue tracker.** Plot replaces issue trackers for *planned implementation work* — the things the team has committed to build. GitHub Issues (or any equivalent) remain useful as the *inbox* that feeds Plot: external bug reports, user-submitted feature requests, and high-level user stories or business goals that haven't been refined into plans yet. The boundary: issues are signals, plans are commitments. An issue may eventually become a plan, but work is executed and scheduled in plans, not in the issue tracker.
- **Not a CI/CD system.** Plot creates tags and changelogs. What happens after that (deployment, notifications, artifact builds) is the project's CI/CD pipeline's job.
- **Not an effort tracker.** No story points, no burndown charts, no estimates. Sprints use deadlines as constraints, not time as a metric — Plot tracks *what* is planned and *whether* it shipped, not *how long* it took.
- **Not a release note generator.** Plot discovers and uses whatever release note tooling the project already has (changesets, custom scripts, etc.). When no tooling exists, it constructs notes from plan changelog sections and commit messages. It doesn't auto-generate notes from commit history alone.

## Release Notes

Not every change needs a release note. The rule: **user-facing changes need release notes; internal work does not.** Features and bug fixes describe what changed for users. Documentation, infrastructure, tests, and refactoring don't — they're important work, but they aren't something users need to know about in a changelog.

## Origin

Plot was built on 2026-02-07 across five Claude Code sessions, starting from a simple question: "I want to plan multiple ideas, read them as formatted text, and implement them in parallel." The design evolved through two complete end-to-end lifecycle tests that uncovered and fixed critical issues — empty branches on approve, undated archive names, draft PR merge failures, and stale local state in helper scripts.

Plot is experimental. The current version (1.0.0-beta) reflects what works for a small team, but conventions may change and behavior may be revised as more projects adopt it.

## Making Decisions

When considering a change to Plot, ask:

1. Does it keep planning in git, or does it introduce an external dependency?
2. Does it stay project-agnostic, or does it hardcode assumptions about a specific project?
3. Does it fail gracefully with helpful suggestions, or does it break on unexpected state?
4. Is it a convention that projects opt into, or configuration that Plot enforces?
5. Would removing it make the system simpler without losing something essential?
6. Could a human with basic git knowledge execute this manually?
7. Could a smaller model (Sonnet/Haiku) follow these instructions for the mechanical parts?
8. Does it stay focused on scheduling, or creep into effort tracking?

If the answer to question 5 is yes, remove it. If the answer to question 6 is no, simplify it. Plot should stay lean. The goal is a small set of strong conventions, not a large set of flexible options.
