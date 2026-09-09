# An adopting repo installs its gates

> `hooks/hooks.json` ships with the plugin. A repository that adopts Plot any other way gets the phase gate and the state gate silently absent — and `/plot-init` never mentions them.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** the-jenkins-team-sees-its-builds
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #865 merged
- **Started:** 2026-09-09, Jan Wloka, `feature/an-adopting-repo-installs-its-gates`
- **Started:** 2026-09-09, Jan Wloka, `feature/an-installed-gate-fires-once`

## Changelog

- `/plot-init` offers to install Plot's hooks, reports what is already there, and proves the install by firing a gate rather than by writing a file. A repository whose gates are absent is told so instead of discovering it when a guarded write lands unguarded — the state that `plot-state-gate.sh` has been in on every machine since it merged, because no plugin release has carried it.

Board impact: no. Adoption writes files; nothing renders.

## Motivation

**Plot's two gates are real and their reach is the plugin's.** `hooks/hooks.json` registers `plot-phase-gate.sh` and `plot-state-gate.sh` as `PreToolUse` hooks on `Bash`, and every path in it is `${CLAUDE_PLUGIN_ROOT}`-relative. A project that vendors the skills, or clones the repo, or installs by any route other than the plugin, gets **no gates at all** — and nothing says so.

**`/plot-init` installs four things and none of them is a gate:**

| what | how |
|---|---|
| config section | `plot-write-config.sh` |
| worker prompt | `plot-install-prompt.sh` — writes, never overwrites |
| commit record | `plot-install-commit-record.sh` — **offered**, gated on a probe signal |
| `.claude/settings.json` | merged, never overwritten; prints and continues if blocked |
| **the hooks** | **nothing** |

### The state gate has never fired, on any machine

**Measured 2026-09-09, and it is worse than the plan first argued.** The repo's
`hooks/hooks.json` at HEAD registers two gates. Every cached plugin version
registers one:

| where | registers |
|---|---|
| repo HEAD | `plot-phase-gate.sh`, `plot-state-gate.sh` |
| plugin 2.15.0 | `plot-phase-gate.sh` |
| plugin 2.14.0 | `plot-phase-gate.sh` |
| plugin 2.10.0 | `plot-phase-gate.sh` |

`plot-state-gate.sh` shipped on 2026-09-09 and **no release has carried it
since**. So the gate that refuses a hand-written `State:` line — written,
tested, merged, and documented in `CLAUDE.md` as the thing that closes the
four measured hand edits — **has never enforced anything anywhere**, including
on the machine that wrote it.

**That is the disease and the missing installer is a symptom.** A gate reaches a
machine by two routes: a plugin release, or a repository's own settings. The
first has a lag nobody is watching, and the second does not exist. The plan
covers the second; the first is named here because a reader who fixes only
adoption will still be running a repo whose newest gate is unshipped.

**It also explains a defect this session took hours to notice.** Five lifecycle
actions routed past their controller, four `State:` lines written by hand in an
earlier session — every one of them on a machine where the gate that would have
refused them was present in the source tree and absent from the running plugin.

### The failure is silent, and that is the whole problem

A missing gate does not error. It permits. `plot-state-gate.sh` refuses a `State:` line written by anything but its owning script — in a repository without it, that same edit lands, commits, and pushes, and the first evidence is a plan whose phase disagrees with its record.

**`CLAUDE.md` already argues why this matters:**

> If prose-only, it's a rule and will eventually be violated.

A gate that is *installed only sometimes* is worse than a rule: it is a rule that some contributors believe is a gate. Measured on this very repository, 2026-09-09 — five lifecycle actions routed past their controller by an agent that had read the rule, and the estate's answer to that class of failure is the gate the adopting repo does not get.

### The install must be proved, not claimed

`plot-fleetctl.sh` refuses a unit whose fill it cannot verify — a surviving `__PLACEHOLDER__` deletes the plist, and `plutil -lint` must pass before `launchctl bootstrap` is called. The reason is stated: *"the fill is VERIFIED rather than assumed"*, because a wrong install **fails long after anybody is watching**.

A hook is the same shape. Writing `hooks.json` proves the file exists; it does not prove Claude Code loaded it, that the paths resolve in this repository, or that a guarded write is actually refused. **An install that reports success without firing the gate is the failure this plan exists to prevent**, and the same failure the supervisor plan measured: a unit file on disk that launchd was never told about.

## Design

### The route is PROVED before the installer is built

**`PreToolUse` from a repository's own `.claude/settings.json` is unverified,
and this plan will not assume it.** Measured: this repository has no
`.claude/settings.json` at all, and the user-level settings register only
`Notification` and `Stop`. **Nothing on this machine demonstrates that a
settings-registered `PreToolUse` hook fires**, that a repo-relative path
resolves, or that a plugin hook and a settings hook coexist.

So the first thing the slice does is register one hook from a settings file,
fire it, and read the refusal. **If the route does not work, the installer has
nothing to install** — and building it first would produce a script that writes
a file and proves nothing, which is the exact failure the second slice exists to
prevent.

This is `/plot-fleet --once` applied to adoption: *prove it works before
installing anything*, because the tick is free and the install is not.

### `plot-install-hooks.sh`, shaped exactly like the commit-record installer

That script is the precedent and it is a good one:

```
written    no hook existed and ours was installed        (exit 0)
current    ours is installed and calls the right script  (exit 0)
present    a hook exists and is somebody else's          (exit 3)
```

`--check` writes nothing and reports the same words, so `/plot-init` can ask before offering. This plan reuses that contract verbatim rather than inventing a second vocabulary for the same three answers.

**It never overwrites.** A repository may run its own `PreToolUse` hooks for its own reasons, and this cannot tell an important hook from an abandoned one — so `present` reports, names the entry to add, and exits 3. That is `plot-install-commit-record.sh`'s rule and `plot-install-prompt.sh`'s alike.

### It is OFFERED, not automatic, and the signal is adoption itself

`plot-install-commit-record.sh` is offered *"only where the probe found the signal"*, because a git hook changes every contributor's machine. A `PreToolUse` hook changes only the adopting user's own tool, which is a smaller blast radius — but the decision is still the repository's.

**The signal here is that Plot is being adopted at all.** Unlike the commit record, whose value depends on a measured defect, the gates protect the lifecycle this very command is installing. So it is offered on every adoption, with what it refuses stated plainly, and declining is a legitimate answer that leaves a working repository.

### Verification fires a gate and reads the refusal

The install ends by proving the gate works, in the shape `/plot-fleet --once` set: *the gate is free, so run it before installing anything.*

The proof is a **refusal that must happen**: construct the guarded condition, invoke it, and require the block. A hook that does not fire prints its own absence rather than a green tick. **A gate whose install cannot be proved is reported as unverified, never as installed** — failing toward the honest word, the way `plot-phase-gate.sh` allows a commit and *says the phase went unverified*.

### Where the hooks live for a non-plugin install

`hooks/hooks.json` is `${CLAUDE_PLUGIN_ROOT}`-relative, which resolves to nothing outside a plugin install. The adopting repository's own `.claude/settings.json` is where its hooks belong, with paths relative to the repository root — which is also where `/plot-init` already merges the plugin block, so the file and its merge-never-overwrite rule are already in this command's scope.

**The two must not both fire.** A plugin install plus a repository install means two registrations of one gate: the phase gate is idempotent (it reads and refuses), but the state gate **spends a receipt**, and a spent receipt does not clear a second reader. So the installer detects a plugin-registered gate and reports `current` rather than adding a duplicate.

### Not chosen: shipping the gates as git hooks

A `pre-commit` hook would cover every contributor and every tool, not just Claude Code — a strictly wider net. It is refused because the gates read a **tool call**, not a commit: `plot-state-gate.sh` inspects the `Bash` command about to run and spends a receipt against it. Re-expressing them as git hooks is a rewrite of both gates, not an install path, and `plot-commit-record.sh` already occupies the git-hook slot with an explicitly non-gating observation.

### Not chosen: failing adoption when the hooks cannot be installed

`/plot-init`'s own guardrail forbids it: *"Never fail the whole adoption on one blocked step."* An unwritable settings file already costs slash-command convenience and nothing else. A repository with no gates still works — it is less protected, and being told so is the deliverable.

### Open Questions

- [ ] **Does a vendored install have a `CLAUDE_PLUGIN_ROOT` equivalent?** The paths must resolve from the repository root, and whether the existing `hooks.json` can be reused with a substitution or needs its own template is the slice's measurement.
- [ ] **Should the controller gate join this set once it exists?** [`a-lifecycle-action-needs-a-controller-receipt`](2026-09-09-a-lifecycle-action-needs-a-controller-receipt.md) adds a third gate. If it lands first, this installs three; if not, the installer must not hardcode two.

## Slices

### Installing

- `feature/an-adopting-repo-installs-its-gates` <!-- builds: plot-install-hooks.sh and its verification, and the /plot-init step that offers it --> — **first prove the route, then build the installer.** Register one hook from a `.claude/settings.json`, fire it, read the refusal; only then write `plot-install-hooks.sh` with the `written`/`current`/`present` contract and a `--check` mode, plus the `/plot-init` step that offers it.

  **Asserted: a settings-registered `PreToolUse` hook FIRES, with a repo-relative path** — measured before anything is built, because nothing on this estate demonstrates it. **Asserted: if it does not fire, the slice reports that and stops** — an installer for a route that does not work is worse than none.

  **Asserted: a plugin-registered gate reports `current` and adds nothing** — the plugin and the repository must not both register one, because the state gate spends a receipt and a spent receipt will not clear a second reader. Which fires first is not the installer's to control, so the duplicate is prevented by not creating it.

  **Asserted: an existing `PreToolUse` hook is never overwritten** — `present`, exit 3, naming the entry to add and keeping the rest. **Asserted: a plugin-registered gate reports `current`, not a duplicate** — the state gate spends a receipt, and a second reader would find it spent. **Asserted: `--check` writes nothing** and reports the same three words, so the offer can be made before anything changes. **Asserted: declining installs nothing and adoption still succeeds**, since a repository without gates works and being told is the deliverable. **Asserted: a blocked settings file does not fail adoption** — it prints the block and continues, `/plot-init`'s own rule.

### Proving

- `feature/an-installed-gate-fires-once` <!-- builds: the install's verification step, which requires a refusal rather than a written file --> — the install proves itself by triggering a guarded condition and requiring the refusal. Waits on `feature/an-adopting-repo-installs-its-gates`.

  **Asserted: the verification REFUSES and the refusal is read** — a written file is not the evidence, the block is. **Asserted: a gate that does not fire is reported UNVERIFIED, never installed** — the honest word, and the one the supervisor's written-but-unloaded plist needed. **Asserted: verification writes nothing that survives it** — it constructs its condition and leaves the repository as it found it, because a proof that dirties a tree is one people skip.

## Notes

Written 2026-09-09, after a session that produced the argument twice over: five controller-routing violations by an agent that had read the rule, and a supervisor whose unit file existed while launchd knew nothing about it. Both are the same failure — **an install that looks complete and is not** — and both are why this plan's second slice is about proof rather than about writing a file.

**Every installer property here is borrowed, not invented.** `plot-install-commit-record.sh` supplies the three-word contract and `--check`; `plot-install-prompt.sh` supplies never-overwrite; `plot-fleetctl.sh` supplies verify-the-fill; `/plot-init` supplies never-fail-the-whole-adoption. A second vocabulary for any of them would be the drift this estate has already paid for.

Definition of Done: docs/definition-of-done.md
