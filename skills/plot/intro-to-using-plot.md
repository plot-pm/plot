# Intro to Using Plot

Plot is a git-native planning workflow. Plans are markdown files on branches — written, reviewed, merged, and versioned just like source code. Pull requests carry the workflow metadata. Git is the source of truth.

This guide walks you through Plot's lifecycle once, end to end, so you know what each command does and when to reach for it.

## Using Plot

A **plan** is a markdown file in `docs/plans/`. It describes something the team has decided to build — context, recommendation, files to change, verification steps. Plans move through four phases:

```
/plot-idea (Draft)     Create plan branch + file + draft PR
     |
   Review              Human reviews, refines, marks ready
     |
/plot-approve          Merge plan to main, fan out implementation branches
     |
   Implement           Parallel work on feature/bug/docs/infra branches
     |
/plot-deliver          Verify all impl PRs merged, archive plan
     |
/plot-release          Cut versioned release with changelog
```

You don't have to memorise this. The hub command — `/plot` — reads the current git state and tells you what to do next.

## Installing Plot

The simplest install is via Claude Code's plugin system:

```
/plugin marketplace add plot-pm/plot
/plugin install plot@plot-marketplace
```

Then add a `## Plot Config` section to your project's `CLAUDE.md` describing your branch prefixes and plan/sprint directories. Plot reads that config rather than enforcing hardcoded paths. See the [README](../../README.md#installation) for other install methods and a config template.

## Creating a plan

When you have an idea you want to build, run:

```
/plot-idea
```

Plot asks for a short title, then does three things:

1. Creates an `idea/<slug>` branch from main.
2. Writes a plan file at `docs/plans/YYYY-MM-DD-<slug>.md` with a template (Context, Recommendation, Files, Verification, Out-of-scope sections).
3. Opens a **draft** pull request linking the plan.

You then edit the plan file the same way you'd edit any code: commits, pushes, PR review. The draft PR is the workspace for refinement. When the plan reads well and the team agrees with the approach, mark the PR ready (`gh pr ready`).

## Approving a plan

Once the plan PR is ready and reviewed:

```
/plot-approve
```

This merges the plan PR to main and fans out **implementation branches** based on the work the plan describes — typically one branch per logical chunk: `feature/<slug>`, `bug/<slug>`, `docs/<slug>`, `infra/<slug>`. Each branch starts empty and ready for work.

The key design choice: the plan lands on main **before** any implementation begins. Every implementation branch points at a stable, approved document. Anyone with repo access can read what was promised and compare it to what's being shipped.

## Implementing

One plan can have many implementation branches. They merge independently, on whatever schedule each piece of work needs. Different people, different agents, different worktrees can all work on the same plan in parallel.

For one branch at a time, that is `/plot-implement <slug>` and you are done. The rest of this section is about doing several at once.

### Working several branches at once

Two questions have to be answered before several people or agents can share a plan: **which branches may run at the same time**, and **how does one person take a branch without someone else taking it too**.

**Waves** answer the first. Group your branches under `### ` subheadings:

```markdown
## Branches

### Tracer
- `feature/checkout-tracer` — thinnest slice through all layers

### Implementation
- `feature/checkout-api` — endpoint and schema
- `feature/checkout-ui` — form and validation
```

Branches in the same wave may run concurrently. A wave becomes eligible once every branch in every earlier wave is **merged** — so the tracer proves the seam before the rest fan out. This is the dependency most work actually has, and it is why the plan template puts `### Tracer` before `### Implementation`.

A plan with no subheadings is a single wave: every branch eligible at once. That is what every plan written before waves existed does, and it still works exactly as before.

**Claiming** answers the second, and it is simpler than it sounds:

```
/plot-fleet
```

shows which waves are complete, eligible, or blocked, and which branches are already taken:

```
  Tracer — complete
      feature/checkout-tracer — merged
  Implementation — eligible
      feature/checkout-api — claimed (2026-08-14T10:22Z, session-3)
      feature/checkout-ui — open
```

Taking a branch means pushing it — empty, before doing any work:

```bash
git checkout -b feature/checkout-ui origin/main
git push -u origin feature/checkout-ui     # this is the claim
```

That push *is* the lock. Git rejects a push that would overwrite an existing branch, so if two people try the same branch at the same moment, exactly one wins and the other picks something else. There is nothing else to configure and nothing that can get out of sync — the branch either exists on the remote or it does not.

Claim **before** you work, not after. Claiming late means two people spend an hour on the same thing before finding out.

`/plot-implement` does all of this for you: it asks which branch is next, claims it, and hands you the brief.

### Letting agents do it

If your branches are independent enough to hand to agents:

```
/plot-dispatch <slug>
```

creates one git worktree per eligible branch — as siblings of your repo, `../plot-wt-<name>` — claims each one, and starts a worker in it. It shows you a dry run and asks how many to start first; starting four agents means four pull requests someone has to review.

Starting workers needs one line of config, because Plot does not assume which agent you use:

```markdown
- **Worker command:** claude -p "Implement the branch in $PLOT_BRANCH per the plan. Open a PR. Do not merge."
```

Without it, `/plot-dispatch` still prepares and claims the worktrees and you start them yourself — which is a perfectly good way to work.

Workers run **detached**, so the fleet outlives your session: start it, close the laptop, come back later. Check on them with:

```
/plot-dispatch --status          # who is running, and their last log line
/plot-dispatch --stop <branch>   # stop one
```

### Merging what comes back

When several branches finish at once, each merge invalidates the others' bases — the second pull request was green when it opened and is broken by the time you reach it.

```
/plot-merge-queue <slug>
```

tells you the safe order, and which branches will collide with a branch **ahead of them in the queue** (not with `main` — each of them merges into main cleanly on its own, which is exactly why the problem is invisible without this).

It does not merge anything. You do, in the order it gives, re-running it after each merge.

### If something goes quiet

```
/plot-reconcile
```

reports claimed branches with no work on them, and how long they have sat there. It distinguishes a branch someone deliberately gave up (annotated `<!-- deferred: … -->` in the plan) from one whose worker may have died — and it never offers to delete the second kind, because a slow worker and a dead one look identical from outside.

To check progress at any point, run:

```
/plot
```

The dispatcher reads the current git state — open plan PRs, implementation PRs in flight, sprints with looming deadlines — and tells you the most useful next action. It's the entry point you'll use most often.

## Delivering and releasing

When every implementation PR for a plan is merged, the plan is **delivered**:

```
/plot-deliver
```

This moves the plan's symlink from `docs/plans/active/` to `docs/plans/delivered/` and updates the Phase field in the plan file. For documentation and infrastructure work, delivery is the end of the road — it's live the moment it's on main.

Features and bug fixes go one step further. To cut a versioned release:

```
/plot-release
```

Plot tags an RC (release candidate), generates a verification checklist (one item per delivered feature or bug fix), and walks you through testing. Bugs found during this endgame are fixed via normal `bug/` branches and a new RC is cut. When every checklist item passes, Plot creates the final tag and writes the changelog from the delivered plans.

## Sprints (optional)

If you want to time-box work, use sprints:

```
/plot-sprint
```

A sprint groups plans by schedule — start date, end date, MoSCoW priorities (Must / Should / Could / Won't). Sprints answer *when*; plans answer *what*. They live in `docs/sprints/` and are committed directly to main. A plan can belong to a sprint or float free; the lifecycle phases above apply either way.

## Plot and GitHub Issues

Plot replaces issue trackers for **planned implementation work** — the things the team has already decided to build. But GitHub Issues (or any equivalent) stay useful for the **inbox** that feeds into Plot:

- **External bug reports.** A user files an issue describing a broken feature. The team triages, decides to fix it, and runs `/plot-idea` to create a plan; the resulting plan can link back to the issue for traceability.
- **Feature requests from outside the team.** Someone outside the planning group has an idea. It belongs in an issue first — a place to discuss whether it should ever become a plan.
- **High-level user stories or business goals.** Aspirational items that haven't been refined into concrete deliverables yet.

The boundary is straightforward: **issues are signals; plans are commitments.** An issue may eventually become a plan, but work isn't *executed* or *scheduled* in the issue tracker — that happens in plans and sprints.

In short:

- **Use a plan when:** the team has decided to build it; review and implementation are about to happen.
- **Use a GitHub issue when:** capturing inbound feedback that may or may not turn into work.

## Some handy advice

Not every change needs a plan. Trivial fixes — typos, dependency bumps, one-line bug fixes, exploratory spikes that may be thrown away — can go straight to a branch and a normal PR. Plot is for work where someone in the future will want to know *why* this was built, not just *what* changed.

The rule of thumb: **if a future reader would benefit from context about the decision, write a plan.** Otherwise, just open a PR.

That's it. Run `/plot-idea` when you're ready to build something, `/plot` whenever you want to know what's next, and let the lifecycle carry the work the rest of the way.
