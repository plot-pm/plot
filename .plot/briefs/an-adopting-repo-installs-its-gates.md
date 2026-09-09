## Implementation brief — an-adopting-repo-installs-its-gates (wave 1: Installing)

- **Plan (canonical):** `docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #865 merged
- **Sprint:** the-jenkins-team-sees-its-builds
- **Branch:** `feature/an-adopting-repo-installs-its-gates` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Wave 2, `feature/an-installed-gate-fires-once`, waits on this branch: it builds the verification step that requires a refusal. It becomes eligible only when this PR merges, so leave the verification's *contract* visible even where you do not build it — wave 2 needs a place to attach.

### What to build

`hooks/hooks.json` registers `plot-phase-gate.sh` and `plot-state-gate.sh` as `PreToolUse` hooks on `Bash`, and every path in it is `${CLAUDE_PLUGIN_ROOT}`-relative. That variable resolves to nothing outside a plugin install, so a repository that vendors the skills or clones the repo gets **no gates at all**, and `/plot-init` never mentions them.

**The measurement that makes this urgent is worse than a missing installer.** Every cached plugin version registers ONE gate — 2.15.0, 2.14.0 and 2.10.0 all carry `plot-phase-gate.sh` and none carries `plot-state-gate.sh`, which merged on 2026-09-09. So the gate that refuses a hand-written `State:` line, and that `CLAUDE.md` documents as the thing closing four measured hand edits, **has never enforced anything on any machine, including the one that wrote it**. Five lifecycle actions routed past their controller in one session on exactly such a machine.

Build two things, in this order:

1. **The route's proof** — register one hook from a repository `.claude/settings.json`, fire it, read the refusal.
2. **`plot-install-hooks.sh`** with the `written`/`current`/`present` contract and a `--check` mode, plus the `/plot-init` step that offers it.

The plan is canonical; this is orientation.

### Measure the route BEFORE you build the installer

**This is the slice's first instruction and it is not optional.** Nothing on this estate demonstrates that a `PreToolUse` hook registered from a repository's own `.claude/settings.json` fires at all. Measured: this repository has **no `.claude/settings.json`** (the directory does not exist), and the user-level settings register only `Notification` and `Stop`.

So three things are unproven, and each is load-bearing:

- that a settings-registered `PreToolUse` hook fires
- that a **repo-relative** path in it resolves
- that a plugin hook and a settings hook **coexist** rather than one shadowing the other

**If the route does not work, the slice reports that and stops.** An installer for a route that does not work is worse than none — it writes a file, reports success, and leaves a repository believing it is gated. That is the precise failure wave 2 exists to prevent, so producing it here would be building the disease.

This is `/plot-fleet --once` applied to adoption: the probe is free and the install is not.

**The gates read hook JSON on stdin**, so the probe has a cheap shape to construct: `plot-state-gate.sh:57` reads `.tool_input.command` via `jq` and acts only on commands containing `git commit`, exiting 2 to block. `test/reconcile/state-gate.test.mjs` and `gate.test.mjs` already drive gates this way — read them before inventing a harness. Note what that proves and what it does not: driving the script directly proves the *script* refuses, and says nothing about whether *Claude Code* invoked it. The route question is the second one.

### The decisions the plan settles — do not re-derive them

**The three-word contract is borrowed verbatim, not designed.** `plot-install-commit-record.sh` is the precedent, and its header states the exact vocabulary:

```
written    no hook existed and ours was installed        (exit 0)
current    ours is installed and calls the right script   (exit 0)
present    a hook exists and is somebody else's           (exit 3)
```

`--check` writes nothing and reports the same words. Do not invent a second vocabulary for the same three answers — that is the drift this estate has already paid for. Read `plot-install-commit-record.sh:1-30` for the contract and `:64-94` for how the words map to exits. Note `--check` on an absent hook prints `absent` and exits 3 there; keep whatever asymmetry you choose deliberate and documented, because `/plot-init` reads the exit code to decide whether to offer.

**It never overwrites — and the reason is that it cannot tell an important hook from an abandoned one.** A repository may run its own `PreToolUse` hooks for its own reasons. `present` reports, names the entry to add, keeps the rest, exits 3. This is `plot-install-commit-record.sh`'s rule and `plot-install-prompt.sh`'s alike; both say so in their headers.

**A plugin-registered gate reports `current` and adds nothing — because the state gate SPENDS a receipt.** This is the one property that is not a style borrowing, and it is a correctness constraint. `plot-state-receipt.sh:94` — `receipt_clears` compares the recorded value and then `rm -f`s the receipt at line 100, so one approval licenses exactly one commit. Two registrations of one gate means the first reader spends the receipt and the second finds it spent, and refuses a write that was properly owned. The phase gate is idempotent and would survive a duplicate; the state gate would not. Which of the two registrations fires first is not the installer's to control, so **the duplicate is prevented by never creating it**, not by ordering it.

**Do not hardcode two gates.** `feature/a-controller-action-leaves-a-receipt` is live on the remote and **already appends a third entry to `hooks/hooks.json`** — measured 2026-09-09, `git diff origin/main...origin/feature/a-controller-action-leaves-a-receipt -- hooks/hooks.json` shows a 4-line addition registering `plot-controller-gate.sh`. Its plan is Approved with no PR yet, so it has not landed; that resolves the plan's second open question in the direction that costs you nothing. Read the gate set from `hooks/hooks.json` rather than naming `plot-phase-gate.sh` and `plot-state-gate.sh` in the installer, and expect that file as the one real conflict if you touch it. A hardcoded pair means the third gate ships and adoption silently keeps installing two.

**Offered on every adoption, and declining is a real answer.** The commit record is gated on a probe signal because a git hook changes every contributor's machine. A `PreToolUse` hook changes only the adopting user's own tool — smaller blast radius — and the signal is that Plot is being adopted at all, since the gates protect the very lifecycle the command is installing. State what it refuses, plainly, and let the operator decline. A repository without gates works; being told it has none is the deliverable.

**A blocked settings file must not fail adoption.** `/plot-init`'s own guardrail (SKILL.md:642 and the `## Guardrails` section): *"Never fail the whole adoption on one blocked step."* Print the block, continue. An unwritable settings file already costs slash-command convenience and nothing more.

**Rejected: shipping the gates as git hooks.** Strictly wider net — every contributor, every tool. Refused because the gates read a **tool call**, not a commit: `plot-state-gate.sh` inspects the `Bash` command about to run and spends a receipt against it. Re-expressing them as git hooks is a rewrite of both gates rather than an install path, and `plot-commit-record.sh` already occupies the git-hook slot with an explicitly non-gating observation.

**Where the new step goes.** `/plot-init` step 4, *"Offer extensions — only what the repo shows it needs"* (`skills/plot-init/SKILL.md:461`). Its signal table already has a row governing `.claude/settings.json` (`:471`, merge-never-overwrite) and the commit-record offer sits at `:481` with its `PLOT-UNASKED` line at `:499`. You are adding a fourth row and a fourth offer to a step that already has the shape — not introducing a pattern.

**Every skill question needs a `PLOT-UNASKED` line.** `test/reconcile/unattended.test.mjs` sweeps all skills for it, so a new question without a declared unattended shape fails the suite. Follow the commit-record wording at `:499`: name the question, the disposition, and the command that does it by hand.

### Done when

The plan's `## Slices` → `### Installing` assertion list is the specification. Its assertions in full: a settings-registered `PreToolUse` hook fires with a repo-relative path; if it does not, the slice reports that and stops; a plugin-registered gate reports `current` and adds nothing; an existing hook is never overwritten (`present`, exit 3, naming the entry); `--check` writes nothing; declining installs nothing and adoption still succeeds; a blocked settings file does not fail adoption.

Three of those exist **because a naive implementation would pass without them**:

- **`--check` writes nothing.** An installer whose check mode has a write path passes every functional test — the file ends up correct either way. Assert on the filesystem being unchanged, not on the reported word.
- **A plugin-registered gate reports `current`.** A naive installer appends its entry and both registrations work "fine" until a receipt is spent twice, which surfaces as a refused *legitimate* approval much later. Test the no-duplicate directly.
- **A blocked settings file does not fail adoption.** The happy path never reaches it. Make the file unwritable and assert adoption still reports success with the block named.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:reconcile` for the plan-format and skill contracts, and a changeset with the description FIRST and the `bumps:` block LAST (`plot-init` bump; a `plan:` line naming this plan is optional and welcome). **Do not run `pnpm run test:e2e`** — it is CI's gate, dispatches real workers, and an agent running it locally starves the machine.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading rather than the last commit subject. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-install-hooks.sh` (new), `skills/plot-init/SKILL.md` step 4, a test file under `test/reconcile/`, and one changeset. Touch `hooks/hooks.json` only if the measurement shows the existing file cannot be reused with a path substitution — that is the plan's first open question and the slice's own measurement to make.

**Do not build** the verification step that requires a refusal — that is wave 2, `feature/an-installed-gate-fires-once`.

**Other branches in flight, verified on the remote at dispatch:** `feature/a-controller-action-leaves-a-receipt` (the third gate — it will add to `hooks/hooks.json`, so that file is the one real collision risk), `bug/a-fleet-start-records-that-it-finished`, `feature/adoption-proposes-the-ticket-prefixes` (**touches `/plot-init` — expect a `skills/plot-init/SKILL.md` collision and keep your edit surgical**), `feature/an-issue-key-is-a-string`, `feature/the-jira-jql-scopes-by-project`.

The shared working tree carried uncommitted sprint-annotation edits to five plan files and one sprint file at dispatch time. They belong to another session — do not commit them, and do not `git add -A`.

If you find something the plan did not anticipate — in particular if the settings-hook route does not fire — report it rather than improvising outside scope. The plan explicitly licenses stopping there.
