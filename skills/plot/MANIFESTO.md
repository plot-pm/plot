# Plot Manifesto

Plot is a git-native planning system for software development. It is designed for teams where humans make decisions and AI agents help plan and implement, but requires nothing more than git and markdown. It is experimental, evolving through real-world usage, and currently in alpha.

## Core Belief

Plans belong in git. Not in a separate issue tracker, not in a project management tool, not in a spreadsheet. Plans are markdown files — written, reviewed, and versioned just like source code. They get reviewed — a pull request with inline discussion, an in-session walkthrough with the approval recorded in the file, or an async ballot, whichever matches the plan's weight — and stay in place forever with date-prefixed filenames. Anyone with repo access can `ls docs/plans/active/` and see exactly what's in flight. No dashboard logins, no access tiers, no sync problems.

Plot works for any team composition, but it is especially designed for a specific one: **human decision-makers** working with **AI facilitators** (for refining ideas, planning, and process administration) and **AI coding agents** (implementing plans as autonomously as current models allow). In this model, humans always own the decisions — approval, prioritization, release, verification. Agents surface information, suggest actions, and do implementation work. But every step of the workflow can also be done by a human with basic git knowledge. The AI is the designed-for sweet spot, not a hard requirement.

## Principles

These are the founding beliefs that guide Plot's design. When a proposed change conflicts with these principles, the principles win.

### 1. Git is the database

Plans are markdown files committed to git. Pull requests are workflow metadata. A project board (if used) is a read-only reflection of PR state — useful to glance at, but never the source of truth. No external tracker, database, or sync API. If it's not in git, it doesn't exist.

This also makes plans transparent. Plans-as-files are more visible than backlog items in a tracker. Anyone with repo access can browse `docs/plans/active/` and `docs/plans/delivered/` without needing credentials for a separate tool. The full history of every plan — drafts, revisions, approvals — is in the git log.

### 2. Plans are approved before implementation

The key design insight: implementation only ever references a stable, **approved** plan. Anyone with repo access can see what was promised and compare it to what was delivered. Merging the plan to main first is how PR-reviewed plans realize this — but the invariant is the recorded approval, not the merge: a plan that rides its work branch with an in-session approval recorded in the file satisfies it just as well. Guardrails read the recorded phase, not pull-request state.

### 3. Commands, not code

Plot's workflow commands are markdown skill instructions that an AI agent interprets — not shell scripts or compiled programs. When a PR is already merged, arguments are missing, or local state is stale, the agent adapts rather than crashing. Behavior is not perfectly deterministic, but the flexibility matters more than the precision. Separate helper scripts (`scripts/plot-pr-state.sh`, `scripts/plot-impl-status.sh`) handle mechanical data gathering — structured output that any model tier can parse. The distinction: skills interpret and adapt; scripts collect and report.

### 4. One plan, many branches

A single approved plan can spawn multiple implementation branches. Different people, different agents, different worktrees — all working on the same plan in parallel. Each branch merges independently on its own schedule.

Parallelism needs exactly two things beyond that: a way to say which branches may run *at the same time*, and a way for one worker to take a branch without another taking it too. Both follow from Principle 1 rather than adding machinery.

**Waves** answer the first. Branches grouped under a `### ` subheading of `## Branches` may run concurrently; a wave becomes eligible once every non-deferred branch in every prior wave is merged. This expresses the dependency teams actually have — a tracer bullet proves the seam, then the rest fan out — without a dependency graph nobody maintains correctly. A plan with no subheadings is one wave, so nothing about the original shape changes.

**Claim-by-ref** answers the second. A worker takes a branch by pushing a claim commit to it. Two independent claims diverge, so the loser's push is rejected as non-fast-forward and a race has exactly one winner: **git is the lock**. The commit is load-bearing — a branch merely pointing at the main branch does not diverge from it, and both pushes would succeed. There is no lock manager, no lease, and no coordination file, because a second store of who-has-what is precisely the drift Principle 1 exists to prevent. The plan may carry a `<!-- claimed: -->` note, but that is a reflection for humans and the board — where it and git disagree, git wins.

Fleet state is therefore **derived, never stored**: every report re-reads git. A killed dispatcher, a crashed watcher, or a dead worker costs nothing, because the next read re-derives the truth. That is what makes a fleet restartable, and it is why Plot needs no database to run one.

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

### 10. Ceremony scales with weight

Every plan answers two independent questions, recorded in its frontmatter or Status block: **how is this plan reviewed and approved?** (`Review:` pr · in-session · ballot) and **where does implementation happen?** (`Impl:` here on own branches · here on the same branch · another repo · nowhere). The adopting repo's Plot Config constrains the answers — a knowledge repo can forbid plan PRs outright, a handover repo can refuse to host plans at all — and within those bounds the default for a small, well-described change is the *lightest allowed* path. Needing more ceremony is what requires justification, never less. The answers, not a workflow shape, drive every downstream command.

### 11. Guidance is part of the workflow

Commands narrate position and consequence, not procedure: where the work stands, which artifact falls out next, and why it exists. Every effort-starting flow opens by eliciting a complete problem statement — goal, motivation, prior attempts, constraints, deadlines, and every source that exists — and a free-form brain dump is the *preferred* input; structuring it is the agent's job, never the user's. Skills ask-and-advise when unsure (naming the signal they see and their recommendation), never re-ask what an upstream artifact already answered, and may push back on a human's explicit wish exactly once before complying and recording the override. The user should feel helped, not processed.

### 12. Evidence over assertion

A gate is satisfied by the artifact that proves it, never by the claim that it holds. `/plot-deliver`'s landed check demands the scan's actual `summary:` footer line — not the words "verified" or "clean". Release sign-off is a human's, not an agent's. Completeness is checked by comparing what a plan promised against what the diffs contain, because a changelog written at planning time describes intent, and intent is not delivery.

The reason is specific to how agents fail: **reading code and judging it is not the same as running it and seeing what happens.** An agent that inspects a mechanism will usually conclude it works, because the mental model it uses to read is the same one it used to write. Only execution can contradict that model.

Two things follow, and both cost something:

**Passing tests prove only what they test.** A suite can be entirely green while the central mechanism is broken, if the untested case is precisely the one the mechanism exists for. Green is evidence about the covered cases and silence about everything else — so when a claim matters, ask which test would fail if it were false, and if the answer is none, the claim is unverified however many tests pass.

**Verification wants an adversary, and preferably a separate one.** Checking your own work shares the blind spot that produced it. Where a claim is load-bearing, the useful instruction is not "confirm this" but *"try to prove this is false, and report what you executed versus what you only read."* That distinction — executed versus read — is what makes a verification report worth trusting.

This principle is a rule, not a gate: nothing can force an agent to genuinely doubt itself. What Plot *can* do, and does, is demand the artifact instead of the assertion wherever an objective one exists.

## Four phases, four artifacts

Plot's phases (below) are **states of a plan**. Cutting across them are four
*activities*, each turning one durable artifact into the next:

| Activity | Turns | Into | Plot phase |
|---|---|---|---|
| **Discovery** | a request, a bug report, an idea | a story (`docs/stories/`) — or straight to a plan, for small work | *before* Draft |
| **Design** | a story or a request | a plan, reviewed before any code exists | Draft → Approved |
| **Development** | an approved plan | merged branches | Approved → Delivered |
| **Endgame** | delivered work | a verified release | Delivered → Released |

The artifact is the point of each phase, and it is what survives the session
that produced it. **Discovery is the one that predates Plot's own states** —
a story can gather context for weeks before any plan exists, and several plans
can hang off one story. It is optional: small, well-understood work goes
straight to Design.

A fifth artifact runs alongside rather than between: the **session log**,
which records how something was decided — including the alternatives that were
rejected and why. A plan says what will be built and is frozen on approval; a
log says what was decided and stays amendable, can be superseded, and outlives
the plan it belongs to. The rule of thumb: if it must be true *before* building
starts, it belongs in the plan; if it answers "why not the other way?", it
belongs in a log. Plot does not write session logs — session-scoped tools do
that better — but it supplies the plot-shaped facts they need.

## Lifecycle

Plot has four plan-level phases: **Draft**, **Approved**, **Delivered**, and **Released** — universal across every ceremony choice. What varies with the recorded `Review:`/`Impl:` answers is how a transition is *effected*; what never varies is that it is *recorded* in the plan (who, when, through which channel — e.g. `Approved: 2026-07-30, alice, in-session`).

A PR-reviewed plan starts as a draft on an `idea/` branch and merges to main on approval. An in-session-reviewed plan is approved by recording the human's go in the file — on the work branch itself when plan and code travel together. **Approval and implementation start are two events**: approving a plan makes it *ready*; starting it (creating branches, briefing the implementer, recording `Started:`) is its own step, because under human pacing days may pass between the two — and re-entry after a gap begins with a staleness check of the plan's assumptions, not blind execution. When all implementation work is merged, the plan is delivered — its symlink moves from `active/` to `delivered/` and the Phase field is updated. For features and bugs, a separate release step cuts a versioned tag with changelog entries. For docs and infra work, delivery is the end — it's live when merged to main.

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

Parallel work sorts into the same three, and the sort is not obvious:

- **Watching a fleet is automate-ASAP.** Reading which waves are complete and which branches are taken is mechanical, cheap, and safe to run on a timer.
- **Fanning one out is human-paced.** Starting four agents commits scope: four branches, four pull requests, four reviews. That is a decision with a cost, so it belongs beside approval and release — not beside the transitions a script may take on its own.
- **Merging stays human-paced, deliberately, even once the order is computed.** A tool can say which merge order is safe and which branches will collide; it should not be the thing that lands them. Automating the *ordering* removes the guesswork; automating the *merge* removes the last review point in a workflow that just multiplied its throughput.

The meta-principle: **don't over-complicate because AI doesn't feel friction.** Every step must be executable by a human with basic git knowledge. If a workflow step can't be done by hand, it's too complex. Scripts and AI make it faster, not possible.

This is why the fleet has no autonomous merger. Every part of it — claiming, dispatching, reaping, ordering — is a thing a human could do by hand with `git push`, `git worktree add`, and a list. The tooling makes that faster. It does not make it possible, and it deliberately stops short of making it automatic.

## Sprints

Sprints are an optional temporal lens over plans — and they exist only where Plot is the tracker. Where a project's declared tracker owns sprint state, Plot writes no sprint artifact: a shadow board that drifts is worse than none. A sprint groups work by schedule — start date, end date, MoSCoW priorities. Plans track *what* to build; sprints track *when* to ship it. Sprint files live in `docs/sprints/`, managed by `/plot-sprint`, committed directly to main. Sprints do not spawn implementation branches, so Principle 2 (plans approved before implementation) does not apply.

## What Plot Is Not

Plot is deliberately small and opinionated. These boundaries are intentional, not oversights.

- **Not a monorepo tool.** Plot's mechanics work per repository. A repo may declare that plans live here while implementation happens in another repo (or that it hosts no plans at all) — but coordinating releases across multiple packages or repos stays out of scope.
- **Not a package publisher.** Plot handles versioning and changelogs, not npm publish or artifact distribution.
- **Not an issue tracker.** Two postures, declared per repo. Where no tracker exists, Plot replaces it for *planned implementation work*; issues (or any equivalent) remain the *inbox* — signals, not commitments. Where a team already runs a tracker (Jira, GitHub Issues, Linear) as its system of record, Plot never duplicates tracker state: the tracker owns work items, business status, and sprints; Plot owns what trackers structurally can't — git-reviewable plans, narrative continuity, and machine-readable plan phases. Plans reference tickets; they never mirror their content, because copies age into lies.
- **Not a CI/CD system.** Plot creates tags and changelogs. What happens after that (deployment, notifications, artifact builds) is the project's CI/CD pipeline's job.
- **Not an effort tracker.** No story points, no burndown charts, no estimates. Sprints use deadlines as constraints, not time as a metric — Plot tracks *what* is planned and *whether* it shipped, not *how long* it took.
- **Not a release note generator.** Plot discovers and uses whatever release note tooling the project already has (changesets, custom scripts, etc.). When no tooling exists, it constructs notes from plan changelog sections and commit messages. It doesn't auto-generate notes from commit history alone.

## Release Notes

Not every change needs a release note. The rule: **user-facing changes need release notes; internal work does not.** Features and bug fixes describe what changed for users. Documentation, infrastructure, tests, and refactoring don't — they're important work, but they aren't something users need to know about in a changelog.

## Origin

Plot was built on 2026-02-07 across five Claude Code sessions, starting from a simple question: "I want to plan multiple ideas, read them as formatted text, and implement them in parallel." It grew up in a project where *all* collaboration was asynchronous by construction — pull requests were the UI — and its early defaults reflected that. That context turned out to be one ceremony choice among several, not the definition: the field feedback behind Plot 2 was, by volume, mostly about PR ceremony applied where it wasn't carrying review. The design evolved through two complete end-to-end lifecycle tests that uncovered and fixed critical issues — empty branches on approve, undated archive names, draft PR merge failures, and stale local state in helper scripts.

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
9. Does it add ceremony that doesn't scale with the weight of the change?

If the answer to question 5 is yes, remove it. If the answer to question 6 is no, simplify it. Plot should stay lean. The goal is a small set of strong conventions, not a large set of flexible options.
