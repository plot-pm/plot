## Implementation brief — setup-tells-me-what-it-found (wave Proposed)

- **Plan (canonical):** `docs/plans/2026-08-26-setup-tells-me-what-it-found.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/setup-proposes-what-it-found` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Warned` (`feature/setup-names-an-unread-key`) follows and depends
on this one landing — it adds the warning for a key with no backend.

### What to build

`/plot-board-setup` proposes the **Tracker** it inferred, and its existing
host/CI proposals are audited against this sprint's population.

`Tracker` appears **zero times** in `skills/plot-board-setup/SKILL.md` — verified,
not assumed. It is exactly the key this sprint's Jira backend will read, so a
user configures everything else and the inbox stays blank.

### Half of this already works — do NOT rebuild it

Step 2 of the skill is already called *"Propose, then confirm"* and already
presents one correctable block covering host, CI and the Jenkins instance, and
already refuses well when unattended (`PLOT-UNASKED` lines are in place).

**The gap is inference, not manners.** Adding a question is not the work; adding
the missing signal and the missing key is.

### The wiring decision — settled, do not re-derive

**`/plot-board-setup` never calls `plot-detect-repo.sh`.** Zero references,
measured. It reads only `plot-board-probe.sh`, and that script has **no
`ticket_prefix` field**; its `git_host` is the *configured key*, not an inference.

So the signal below is not reachable today. **The skill calls BOTH scripts and
merges their reports:**

| script | answers |
|---|---|
| `plot-board-probe.sh` | *can the board run here?* — node, artifact, CLIs, auth |
| `plot-detect-repo.sh` | *what is this repo?* — git host, ticket prefix, style |

**Not chosen: add `ticket_prefix` to the probe.** Two scripts answering one
question means duplicated detection or the probe shelling out to detect-repo —
and the probe's contract has OTHER CALLERS who would inherit a field they never
asked for. Composition belongs in the skill (Manifesto Principle 3: scripts
collect and report, skills interpret and adapt).

**Do not change either script's output contract.** This wave is skill-side.

### The tracker signal is measured — use it exactly as measured

`plot-detect-repo.sh:79` scans 80 commit subjects for `ABC-123` and reports the
prefix only if it appears **at least twice**. Measured across the **70 git repos
on this machine**:

```
  32 repos carried a prefix        ZERO false positives
  perfect precision                all 32 Bitbucket-hosted, Jira-tracked
                                   all 5 GitHub repos: no prefix
  half recall                      32 of 64 Bitbucket repos: no prefix
```

Prefixes seen: `MCHW2C`(8) `QUACDS`(6) `EWZREL`(4) `CDSTLZ`(4) `LNTNGP24`(3)
`EWZKUS`(3) `MGNLCKE` `LIPRET` `EWZLEG` `EKZREL2`.

**The signal is ONE-DIRECTIONAL, and this is the whole design:**

- a prefix is strong evidence **FOR** a Jira tracker → propose it, with the
  evidence named: *"found `QUACDS-*` in 6 of 80 commits"*
- its absence is **NOT** evidence against one → ask the open question, exactly
  as today. Never propose `Tracker: none` from silence.

Done-when 9 is the assertion a naive implementation fails **while passing item
8**: reading absence as *no tracker* silently writes the wrong answer for half
the measured population.

**What the prefix does not prove is which system hosts it.** `ABC-123` is Jira's
convention, but Linear and GitHub issues carry prefixed keys too. Perfect
correlation in this population; a proposal, never an assertion, anywhere else.

### A wrong Tracker is as dangerous as a wrong Jenkins slug

The skill already refuses to guess a Jenkins instance when unattended, for a
precise reason: `jen -I <bogus> auth status` prints `Keycloak: signed in` and
exits 0, so a guess buys a green light that verifies nothing.

**`Tracker` has the same shape.** A wrong `Tracker: jira` sends `issue-list` to
the wrong system, which answers — with an empty list. The board renders an empty
inbox, which reads as *you have no tickets*: the exact failure the story
`the-board-is-blank-where-it-matters` is named for, caused by the tool meant to
prevent it.

So `Tracker` inherits the Jenkins rule verbatim: **infer only from structural
signals, and when unattended, refuse rather than guess.** No key beats a wrong
key — Done-when 6.

### One signal proposes, two signals ask

A repo can carry a `Jenkinsfile` **and** `.github/workflows/`, and
`plot-board-probe.sh` already reports them as two independent booleans
(`ci_signals: {jenkinsfile, gh_workflows}`), so the ambiguity is representable
today.

Where both are true, setup **does not propose** — it asks, naming what it found:
*"Found a `Jenkinsfile` and 3 workflow files. Which runs your PRs?"*

**Preferring the git host's CI was rejected**: a team on GitHub running Jenkins
is common, and it is exactly this sprint's user. This is the general rule for
every inferred field, not a CI special case.

### Done when

The plan's `## Done when` list is the specification — all eleven items. Four
exist because a naive implementation passes without them:

- **Item 1b** — both CI signals present ⇒ ASK, do not tie-break on the host.
- **Item 6** — unattended refuses a Tracker rather than guessing.
- **Item 9** — no prefix asks; it never proposes `none`.
- **Item 10** — both scripts are invoked, and neither grows the other's field.

Plus: **`pnpm run validate`**. Node 24 (`nvm use`); `corepack pnpm` if the
homebrew one misbehaves.

**`pnpm test` is NOT a test run in this repo** — it is `skills add . --list` and
prints an installer listing. Do not read its output as a passing suite.

**Bump the skill version via a changeset `bumps:` block** — never edit
`metadata.version` by hand:

```
<!--
bumps:
  skills:
    plot-board-setup: minor
-->
```

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Proposed (Branch: feature/setup-proposes-what-it-found, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot-board-setup/SKILL.md` (and its README if the
change warrants it).

**Do not edit `plot-board-probe.sh` or `plot-detect-repo.sh`.** Both have other
callers; this wave composes their existing output.

**Do not write the "key with no backend" warning** — that is wave 2
(`feature/setup-names-an-unread-key`) and it is a separate branch.

**`plot-host.sh` is busy.** PR #450 (Jenkins checks) is live in it right now and
#449 (Bitbucket issues) just landed. You should not need to touch that file at
all; if you think you do, report it instead.

Every skill change must keep its unattended shape: every question needs a
`PLOT-UNASKED` line, and a repo-wide test sweeps all skills for this.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
