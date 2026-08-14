# Fleet user test — protocol

A guided first run of the parallel-agent fleet (`/plot-fleet`,
`/plot-dispatch`, `/plot-merge-queue`) in a **real project**, before the
release that ships them.

Automated coverage already exists: 134 unit tests and 9 end-to-end flows prove
the scripts feed each other correctly on real refs. **This protocol targets
what those cannot reach** — whether an agent follows the prose, whether the
messages make sense to a human, whether real detached workers work at all, and
whether running four agents at once actually feels manageable.

Budget about 60–90 minutes. Findings go in the table at the end.

---

## Why not just install the plugin

The plugin manifest is still at the pre-fleet version, so
`/plugin marketplace add plot-pm/plot` would install a Plot **without** these
commands. Testing before the release therefore means linking the skills
directly.

---

## 0. Setup (10 min)

**Pick a real project.** Not `plot` itself — dogfooding hides the newcomer
experience, which is exactly what is under test. A small side project with a
git remote is ideal. It should have work you would genuinely split three ways.

**Link the skills** from your plot checkout:

```bash
PLOT=~/CODE/plot          # adjust
for s in plot plot-idea plot-approve plot-implement plot-deliver \
         plot-fleet plot-dispatch plot-merge-queue plot-reconcile; do
  ln -sfn "$PLOT/skills/$s" ~/.claude/skills/$s
done
ls -l ~/.claude/skills/ | grep plot     # verify the symlinks resolve
```

> **Link `plot` too, even if you already have it.** The spoke skills call
> helper scripts by relative path (`../plot/scripts/plot-fleet-scan.sh`), which
> only resolves when `plot` sits beside them. Linking `plot-fleet` alone leaves
> every script call broken.

Sanity-check that the scripts are reachable before going further:

```bash
~/.claude/skills/plot/scripts/plot-fleet-scan.sh --offline    # in your project
```

It should print a pulse (or "No active plans found"), not a path error.

**Check the prerequisites** — the fleet needs more than base Plot:

```bash
git --version        # must be >= 2.38 (merge-queue uses merge-tree --write-tree)
python3 --version    # fleet-scan and merge-queue parse JSON with it
```

**Add a Plot Config** to the project's `CLAUDE.md` if it has none:

```markdown
## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Worker command:** claude -p "Implement the branch named in $PLOT_BRANCH per the plan in docs/plans/. Follow the project's conventions. Open a PR when done. Do NOT merge."
```

> **`Worker command` is the part most likely to need tuning.** Plot hardcodes
> no agent tooling, so this string is yours. Getting it wrong is itself a
> finding worth recording — note what you had to change.

---

## 1. Write a plan with waves (15 min)

```
/plot-idea fleet-trial: <something you actually want built>
```

Answer the ceremony questions as you normally would. When it asks about
implementation, choose **own branches**.

**Then edit the plan's `## Branches` section into two waves:**

```markdown
## Branches

### Tracer
- `feature/fleet-trial-tracer` — thinnest slice that proves the seam

### Implementation
- `feature/fleet-trial-a` — <independent piece>
- `feature/fleet-trial-b` — <independent piece>
```

Make the two Implementation branches genuinely independent — different files if
you can. You want them to *not* conflict, so the merge queue has something
honest to say later.

> ⚠️ **Annotations bind to the branch line.** A `<!-- deferred: ... -->` on a
> wrapped continuation line is silently ignored. If you defer anything, keep it
> on the same line as the backticked branch name.

Approve it: `/plot-approve fleet-trial`

**Watch for:** Did the agent explain the two ceremony questions in a way you
could answer without knowing Plot's internals? Did anything read as jargon?

---

## 2. First pulse — an empty fleet (5 min)

```
/plot-fleet
```

**Expected:** Tracer eligible, Implementation blocked, nothing claimed.
Something like:

```
  Tracer — eligible
      feature/fleet-trial-tracer — open
  Implementation — blocked
      ...
summary: plans=1 waves=2 branches=3 claimed=0 eligible=1 blocked=1 ...
```

**Watch for:** Is "blocked" understandable *without* reading the docs? Would
you know why, and what to do about it?

---

## 3. Dry run, then dispatch wave 1 (10 min)

```
/plot-dispatch fleet-trial
```

**Expected:** the agent runs `--dry-run` first, shows you one eligible branch,
and **asks how many to start** before doing anything.

> **This is the key prose behaviour under test.** The dry-run-then-ask
> discipline is instruction, not a gate — an agent can skip it. If it fans out
> without asking, that is a finding, and an important one.

Let it dispatch the tracer. Then:

```bash
ls -d ../plot-wt-*                # a sibling worktree appeared
/plot-dispatch --status           # pid, alive?, last log line
```

**Watch for:**
- Does `--status` say something useful, or just "running"?
- Is the worktree where you expected — beside the repo, not inside it?
- If no worker started: did the message tell you *how* to fix it, or just fail?

---

## 4. Let a real worker run (15 min)

This is the part no automated test covers at all: the tests all run
`--no-start`.

```bash
tail -f ../plot-wt-fleet-trial-tracer/.plot-worker.log
```

**Watch for:**
- Does the worker understand the brief from `$PLOT_BRANCH` alone?
- Does it open a PR and **stop**, or does it try to merge? (It must not merge.)
- If it goes wrong: could you tell from `--status` and the log, or did you have
  to guess?

Stop it if it misbehaves:

```bash
/plot-dispatch --stop feature/fleet-trial-tracer
```

The claim and worktree stay behind on purpose — the branch is still taken.
**Note whether that surprised you.**

---

## 5. The wave transition (10 min)

Merge the tracer's PR yourself (workers never merge), then:

```
/plot-fleet
```

**Expected:** Tracer now **complete**, Implementation now **eligible**, two
branches on offer.

> This is the design's core claim: the same command gives a different answer
> because git changed, not because anything remembered. If it does not flip,
> that is the most serious possible finding.

Now fan out both:

```
/plot-dispatch fleet-trial
```

**Watch for:** two workers, two worktrees, two PRs. Does `--status` stay
readable with more than one? Does it feel manageable — or is this the point
where you lose the thread?

---

## 6. Merge queue (10 min)

Once both workers have opened PRs:

```
/plot-merge-queue fleet-trial
```

**Expected:** both branches listed with a merge order, `conflicts=0` if they
really were independent.

**Optional, and the more interesting test:** deliberately make them collide —
edit the same line on both branches — and re-run. The conflict should be
reported against **the branch ahead in the queue**, not against `main` (each
merges into main cleanly on its own; that is exactly the burst-landing case).

**Watch for:** Does the order tell you what to actually do next? Would you
trust it enough to merge from it?

---

## 7. Cleanup (5 min)

```
/plot-reconcile
```

**Expected:** merged branches listed as deletion candidates; any leftover
claim reported under "claims". Nothing is deleted for you — the commands are
printed.

Then remove the worktrees by hand:

```bash
git worktree remove ../plot-wt-fleet-trial-a       # etc.
git worktree list
```

**Watch for:** Is it obvious what is safe to delete? Does anything look
orphaned that should not?

---

## Known rough spots

Do not report these as findings — they are known and deliberate. **Do** report
if they hurt more than expected:

| Rough spot | Why it is this way |
|---|---|
| `Worker command` must be written by you | Plot hardcodes no agent tooling (Principle 5) |
| Worktrees are not cleaned up automatically | Deleting directories is the kind of write this design avoids |
| No merge automation | Merge authority stays with the human until the queue's ordering has proven itself |
| Annotations must sit on the branch line | Parser contract; documented in the templates |
| A stale claim gets no delete command | A slow worker and a dead one look identical; only you can tell |

---

## Findings

| # | Step | What happened | Expected | Severity |
|---|------|---------------|----------|----------|
|   |      |               |          |          |

**Severity:** *blocker* (cannot proceed) · *confusing* (worked, but I had to
guess) · *papercut* (mildly annoying) · *idea* (would be better if…).

**"Confusing" is the most valuable category.** The automated tests already
prove the mechanics work; what they cannot prove is that a human can follow
them. If you had to read a script to understand a message, that is a finding
even though nothing broke.

---

## Afterwards

File findings as `/plot-idea` plans, or paste the table into the fleet plan's
`## Notes`. If nothing blocked, the fleet is ready for `/plot-release`.
