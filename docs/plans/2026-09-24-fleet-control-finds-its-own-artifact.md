# Fleet control finds its own artifact

> `/plot-fleet` cannot run in any repository that consumes Plot as a plugin. One line resolves the supervisor bundle against the *consumer's* checkout rather than the plugin's, and refuses with a repair — `pnpm build:board` — that does not exist there.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #969
- **Rounds:** 1

## Changelog

- `/plot-fleet` starts in a repository that consumes Plot as a plugin. `plot-fleetctl.sh:89` resolved `plot-registryd.mjs` against the consumer's repository root, so the gate refused with *"no supervisor artifact"* and told the operator to run a script their repository does not have. The artifact ships with Plot, tracked and versioned.

Board impact: none. `plot-fleetctl.sh` is fleet control's own mechanics; the board resolves this class of artifact correctly already and is untouched.

## Motivation

**A consumer repository cannot start fleet control at all, and the refusal names a repair it cannot perform.**

```
$ /plot-fleet --once
plot-fleetctl: no supervisor artifact at
  /Users/…/quaweb-website/skills/plot/scripts/board/plot-registryd.mjs
  Build it: pnpm build:board
```

**Both lines are false.** The artifact is not missing — it ships in the plugin, tracked in git. And `pnpm build:board` is a script of *this* repository, not of the one reading the message.

The gate itself behaved correctly: `--once` is documented as the thing to run before installing anything, and it refused rather than installing a unit naming a file that is not there. **It refused for a reason that is not true**, which is the defect.

## Design

### What was measured, 2026-09-24

```
plot-fleetctl.sh:89   registryd="$repo_root/skills/plot/scripts/board/plot-registryd.mjs"
                      $repo_root = git rev-parse --show-toplevel  (:88)
                                 = the CONSUMER's checkout

plot-board-probe.sh   "artifact": "/Users/…/plot-marketplace/skills/plot/scripts/board/board-server.mjs"
                      "artifact_source": "plugin"

git ls-files skills/plot/scripts/board/   → the bundles are tracked and shipped
```

**The estate has three resolutions for one question, and only the broken one is rare.** Counted across `skills/plot/scripts/*.sh`:

| Idiom | Sites | Correct under a plugin install? |
|---|---|---|
| `$script_dir/board/` (and `$here`, `HERE`) | **26** | yes — relative to the script, which lives in the plugin |
| `plot-board-probe.sh` | 1 (`plot-boardctl.sh:313`) | yes, and it reports `artifact_source` |
| **`$repo_root/…/board/`** | **1** | **no** |

So this is a single outlier against a settled convention, not a design gap.

### Which resolution to adopt, and why not the one the issue suggests

The issue suggests following `plot-boardctl.sh` through the probe. **That is the heavier of two correct answers, and the lighter one is what 26 sites already do.**

`$script_dir` is correct *by construction*: the script and the bundle ship in the same directory of the same package, so a path relative to the script cannot point outside the installation it came from. It needs no subprocess, no JSON parse, and cannot fail for a reason of its own.

The probe earns its cost where the caller must **report** where the artifact came from — `plot-boardctl.sh --start` prints `artifact_source`, and `/plot-board-setup` reasons about it. Fleet control needs the path and not its provenance.

**Recommendation: `$script_dir`.** The probe stays the right answer for the board, and the two commands stay independent, which `DESIGN-process.md` §1 requires.

### The unit bakes the path permanently, so this is worse than a refusal

`--start` fills `__REGISTRYD__` into the launchd/systemd unit with an absolute path, and `skills/plot-fleet/SKILL.md` records the consequence in the same terms as `__NODE__`: **an installed unit does not update itself.** A wrong path written there produces a daemon that keeps restarting long after anybody is watching.

**So fixing the probe alone would be incomplete**: the fill must use the same resolution, or the fix repairs the gate and leaves the installation broken.

### The shape of the fix

**Two lines, not one — a panel found the second.**

1. `registryd="$script_dir/board/plot-registryd.mjs"` — the idiom 26 sites already use
2. **`pinned_major()` stops reading the consumer's `.nvmrc`.** `plot-fleetctl.sh:110` reads `$repo_root/.nvmrc`, so a consumer repository — which has no reason to carry one — makes the node-version check evaluate to nothing. **Refusal 2 silently vanishes for exactly the population this plan serves**, and it is the refusal that stops a wrong interpreter being baked PERMANENTLY into the unit. The pin is Plot's, so the file to read is Plot's.
3. the unit fill resolves the same way, so `__REGISTRYD__` names the plugin's artifact
4. the refusal's message stops naming `pnpm build:board` when the artifact genuinely is absent — `plot-dispatch.sh:1955-1960` is the model, scoping that suggestion to *"in a development checkout"*

**The other `$repo_root` uses in the file are correct and stay**: the start marker (`:176`), the worktree root (`:260`) and the logs (`:567`) belong to the consumer's estate. Only a shipped artifact and a pin that is Plot's own are wrong.

### The gate has two known blind spots, and naming them is part of the slice

Done-when 4 asks for a gate counting `$repo_root`-resolved bundle paths. A naive grep for `$script_dir/board/` fails twice:

- **`plot-pr-merged.sh:105` inlines the `cd`/`dirname`/`BASH_SOURCE` expression** rather than using a `$script_dir` variable. It is correct under a plugin install and the gate would not see it.
- **`plot-board-probe.sh:266` legitimately builds a repo-root bundle path** as its documented last fallback, stamping `artifact_source="checkout"`. **The gate must exempt it by name**, or it fails on the one file that already answers this question correctly.

**A gate described and not built is a rule** (CLAUDE.md: *"If prose-only, it's a rule and will eventually be violated"*), so the slice builds it or the Done-when drops it.

### What this does NOT do

- **It does not adopt the probe.** Fleet control needs a path, not a provenance, and `DESIGN-process.md` §1 keeps the two commands free of each other. A probe call here would make the board's script a dependency of fleet control's.
- **It does not change the gate.** `--once` refusing on a missing artifact is correct and stays.
- **It does not touch `$repo_root` elsewhere in the script.** It is the right reading for the estate's own files — plans, `.plot/state`, worktrees — and only wrong for the shipped bundle.
- **It does not fix an already-installed unit.** A unit filled before this lands still names the wrong path; `--stop` then `--start` is the documented upgrade path and remains the only one.

### Done when

- `/plot-fleet --once` resolves the supervisor artifact in a repository that consumes Plot as a plugin, with no `build:board` script present.
- **The unit fill uses the same resolution**, so `__REGISTRYD__` cannot name a path the consumer's checkout would have.
- **The node-version refusal still fires in a consumer repository.** It is disabled there today, and a test pins it.
- A genuinely missing artifact still refuses, with a repair a consumer can perform.
- **A gate counts `$repo_root`-resolved bundle paths and holds at zero** — the outlier was one line against 26, and it survived because nothing said so.

## Slices

### Fleet control resolves beside itself (Branch: bug/fleet-control-resolves-beside-itself)

- `bug/fleet-control-resolves-beside-itself` — `plot-fleetctl.sh:89` and the unit fill resolve `plot-registryd.mjs` relative to the script; `:110` reads Plot's `.nvmrc` rather than the consumer's, so the node refusal survives adoption; the missing-artifact message follows `plot-dispatch.sh:1955`'s model; a contract test asserting no shipped bundle is resolved against `$repo_root`, catching the inlined `BASH_SOURCE` form and exempting `plot-board-probe.sh:266` by name

## Notes

- Reported from a website monorepo consuming Plot as a plugin, where `/plot-board --start` worked and `/plot-fleet --once` refused — **the two commands' different answers to one question is what made it visible.** It is not reproducible here, because this repository is both the plugin and the consumer.
- The issue says *"only one knows the plugin case"*. The count says something narrower and more useful: **26 sites know it, one does not** — independently recounted by a juror, to the number.
- **Panelled 2026-09-24: `divided`, proceed=estate, amend=adoption+manifesto.** The estate lens verified every claim the plan makes and found them sound; the other two looked at what the plan PROMISES and found `:110` missing and the gate unbuilt. The moderation records why that is not averaged: one juror was asked a narrower question, and a panel that split the difference would ship a Done-when it knows to be unreachable.
