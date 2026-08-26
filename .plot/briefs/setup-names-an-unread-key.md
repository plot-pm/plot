## Implementation brief — setup-tells-me-what-it-found (wave Warned)

- **Plan (canonical):** `docs/plans/2026-08-26-setup-tells-me-what-it-found.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/setup-names-an-unread-key` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Proposed` merged as **#451** — `/plot-board-setup` now infers and
proposes the Tracker, calling `plot-detect-repo.sh` alongside the probe.

### What to build

A key that setup writes but **nothing reads yet** is recorded with a warning
that names the gap.

Read #451 first: it added the Tracker proposal (*"Found `QUACDS-*` in 6 of 80
commit subjects → propose `Tracker: jira`"*). This wave adds the honesty about
what happens next.

### The decision the plan settles — do not re-derive it

Three options were considered for a key writable before it is readable:

| option | verdict |
|---|---|
| refuse to write it | **rejected** — blocks the configuration the backends need |
| write it silently | **rejected** — recreates today's exact failure |
| write it with a warning naming the gap | **CHOSEN** |

The warning is the honest form: the key IS what the backend will read, and
saying *"recorded; no backend reads this yet"* is a fact about Plot's state, not
about the user's repo.

**This is the motivating failure of the whole plan.** A user configures
`Tracker: jira`, the board looks configured and behaves unconfigured, and the
reasonable conclusion is *I set it up wrong*. The warning is what stops that.

### Which keys are unread — check, do not assume

**The answer moved twice today**, so verify rather than trusting this brief:

- `Tracker: jira` — a Jira backend is being built RIGHT NOW on
  `feature/jira-issues-reach-the-inbox`. If it lands before you, `Tracker` stops
  being unread and the warning must not fire for it.
- `CI: jenkins` — **#450 merged today** and `plot-host.sh` now resolves `checks`
  through `jen`. `CI` is READ. Do not warn about it.

So do not hardcode a list of unread keys from this brief's prose. Derive it, or
state the check the skill performs, so the warning stays true as backends land.
A warning that keeps firing after its backend exists is the same defect one
level up: text asserting something that is no longer so.

### Done when

The plan's `## Done when` item 4 is this wave's core:

> **A key with no backend is written with a warning that names it.** Asserted on
> `Tracker: jira` while its backend is unbuilt.

Note the italicised condition — *while its backend is unbuilt*. If the Jira wave
lands first, say so in the PR and assert the warning on whatever key is
genuinely unread, rather than asserting a stale fact to satisfy the sentence.

Items 5 and 6 still apply and are not yours to break: the unattended path
refuses rather than guessing, and a wrong Tracker is refused rather than guessed
under `PLOT_UNATTENDED=1`.

Plus: **`pnpm run validate`**. Node 24 (`nvm use`); `corepack pnpm` if the
homebrew one misbehaves. **`pnpm test` is NOT a test run here** — it is
`skills add . --list` and prints an installer listing.

Bump the skill via a changeset `bumps:` block — never edit `metadata.version`
by hand:

```
<!--
bumps:
  skills:
    plot-board-setup: minor
-->
```

Every skill question needs a `PLOT-UNASKED` line; a repo-wide test sweeps all
skills for this shape.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Warned (Branch: feature/setup-names-an-unread-key, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot-board-setup/SKILL.md` (and its README if
warranted).

**Do not re-do #451's inference work** — the proposal, the two-signal rule and
the detect-repo wiring all landed. This wave adds the warning only.

**Do not edit `plot-board-probe.sh` or `plot-detect-repo.sh`.** Both have other
callers; #451 deliberately composed their existing output rather than changing
either contract.

**Do not build any backend.** `Tracker: jira` is
`feature/jira-issues-reach-the-inbox`, live right now.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
