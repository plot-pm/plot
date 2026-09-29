Position: amend
Evidence: executed

# Evidence juror — the board runs the artifact its repo built

The plan's **premise is correct and reproduced**. Its **diagnosis of tonight's outage is wrong**, one of its "Done when" items **is already shipped**, and — the finding I hold hardest — **the test it leans toward (#2) misfires on both populations the plan names, and on a third it does not.**

## 1. The premise: VERIFIED, and the cited lines are right

`skills/plot/scripts/plot-board-probe.sh:36` says exactly what the plan quotes:

```
36:#   artifact_source plugin | npm | checkout | none  (resolved in that order)
```

The checkout fallback is at `:265-268`, as cited — verified by line number, not by trust:

```
252:  artifact="$cand"; artifact_source="plugin"
261:    artifact="$npm_bin"; artifact_source="npm"
267:  artifact="$git_root/skills/plot/scripts/board/board-server.mjs"
268:  artifact_source="checkout"
```

The probe, run here:

```
$ bash skills/plot/scripts/plot-board-probe.sh
  "git_root": "/Users/jwloka/Quatico/Agentic-Tools/plot",
  "artifact": "/Users/jwloka/.claude/plugins/marketplaces/plot-marketplace/skills/plot/scripts/board/board-server.mjs",
  "artifact_source": "plugin",
```

**`checkout` is unreachable here, and the order alone causes it** — not a missing directory. Isolated with a fixture, the same repo answers both ways depending only on whether a plugin root exists:

```
$ cd /tmp/probe-adopt   # git repo carrying skills/plot/scripts/board/board-server.mjs
$ PLOT_PLUGIN_ROOT=/nonexistent  … plot-board-probe.sh
  "artifact": "/private/tmp/probe-adopt/skills/plot/scripts/board/board-server.mjs",
  "artifact_source": "checkout",
$ PLOT_PLUGIN_ROOT=~/.claude/plugins  … plot-board-probe.sh
  "artifact": "/Users/jwloka/.claude/plugins/marketplaces/…/board-server.mjs",
  "artifact_source": "plugin",
```

Same repository, same artifact on disk, shadowed purely by resolution order. The mechanism the plan describes is real.

## 2. `plot-boardctl.sh` really does just obey — and there is no second consumer

`:328` reads the field, `:333` refuses on `none`, `:351` branches for the `node` prefix, `:358` prints it. Every other mention on the estate is prose in `plot-board-setup/SKILL.md:133`, `plot-init/SKILL.md:728,741`, `plot-board/SKILL.md:114` and READMEs — no second decision. **This claim of the plan holds.** A correct probe answer does need no caller change.

## 3. The plan's own measurement is stale, and one "Done when" already ships

**The plan says the marketplace directory "no longer exists on disk".** It does:

```
-rwxr-xr-x@ 1 jwloka  staff  1198574 Sep 29 12:45 …/marketplaces/plot-marketplace/…/board-server.mjs
```

And `plot-host.sh` is present in both the marketplace tree and the `cache/2.21.0` tree. **So the plan's framing (wrong artifact) and the observed outage (`exit 127`, `plot-host.sh: No such file or directory`) are two different defects.** The outage was a board running from a tree that was deleted and later restored; this plan is about a tree that is present and wrong. Fixing the order would not have prevented that `exit 127`. The plan should stop claiming the outage as its motivation — it has a sufficient one without it.

**More consequential: the three copies are not three versions.**

```
c0bff96ac2b5b4e6  skills/plot/scripts/board/board-server.mjs          (checkout, HEAD 96a48728)
c0bff96ac2b5b4e6  …/marketplaces/plot-marketplace/…/board-server.mjs  (the probe's answer)
23eb76a3bbdfc1c0  …/cache/plot-marketplace/plot/2.21.0/…              (one live board, pid 46011)
```

**The probe's answer is byte-identical to the checkout build** (separate inodes, 814417548 vs 832851557 — a copy, kept in sync, not a symlink). The plan's own table prints the two as if they were different files and never compares them. So the headline symptom — *"`pnpm build:board` writes a file the running board will never read"* — is **not currently reproducible on this machine through the probe's answer.** The divergent copy is the `cache/2.21.0` one, which is what pid 46011 is running, and the probe does **not** select it (`:239-241` picks `marketplaces/` explicitly, with a measured comment saying why). The real gap is **a running board vs. the probe**, not the probe vs. the build.

**And `--dry-run` already does what "Done when" #3 asks:**

```
$ bash skills/plot/scripts/plot-boardctl.sh --start --dry-run
would start the board
  artifact: /Users/jwloka/.claude/plugins/marketplaces/…/board-server.mjs (plugin)
  command:  node …
```

That item is satisfied on `main` (`plot-boardctl.sh:357-359`). Leaving it in the acceptance list makes the slice look larger than it is and invites a re-implementation.

## 4. THE FINDING: test #2 misfires on three populations

The plan calls candidate 2 — *"`packages/board/package.json` naming `@plot-pm/board` is a fact only the repository that builds it has"* (`:61`) — and leans toward it. **That sentence is false, measured three ways.**

**(a) The plugin tree itself carries it.**

```
$ ls ~/.claude/plugins/marketplaces/plot-marketplace/packages/board/package.json
…/packages/board/package.json
$ ls ~/.claude/plugins/marketplaces/plot-marketplace/packages
board
domain
```

The plugin ships `packages/`. So the fact is not unique to the building repository; it is a fact about *Plot's source layout*, which the plugin distributes.

**(b) A vendoring repo or a fork gets it for free.** Any checkout that vendors the skills has the tree, and a fork has it by definition. Both then answer `checkout` and run whatever artifact happens to sit in their tree — including one they never built.

**(c) EVERY DISPATCH DESK SATISFIES IT, and one is already stale.** A desk is a full worktree, so `packages/board/package.json` is present in all of them:

```
/Users/jwloka/Quatico/Agentic-Tools/plot                      : @plot-pm/board
…/scratchpad/rb-a-heading-names-a-branch-or-says-it-could-not : @plot-pm/board
…/scratchpad/rb-the-jury-button-names-its-caller              : @plot-pm/board
/private/tmp/plot-brief-sweep                                 : @plot-pm/board
…/.worktrees/free-4e6564dc                                    : @plot-pm/board
```

And their artifacts already disagree:

```
plot                                             : c0bff96ac2b5b4e6
rb-a-heading-names-a-branch-or-says-it-could-not : 23eb76a3bbdfc1c0   ← stale
rb-the-jury-button-names-its-caller              : c0bff96ac2b5b4e6
```

**So the answer to the panel's question is yes: a worker's desk would run a different board than the main checkout.** Under test #2, a board started from that desk resolves `checkout` and runs `23eb76a3` — the exact class of quiet-wrong-answer the plan rejects candidate 3 for producing (`:62`). The plan rejects mtime-wins because *"a stale build after `git pull` would silently win"*; candidate 2 reproduces that failure through a different door, and the plan does not notice because it never considers a worktree.

The plan's own exclusion — *"It does not warn about a stale checkout build… this plan decides which file runs, not whether it is fresh"* (`:69`) — is written as a scope boundary, but under candidate 2 it is the defect. The staleness stops being the developer's business the moment the probe starts *preferring* the possibly-stale copy in 10+ trees nobody builds in.

**Candidate 1 (a `Board artifact` config key) survives all three.** The plan's objection to it — *"costs a key nobody sets by default, so it fixes nothing until someone reads this plan"* (`:60`) — is weaker than it sounds: this repository's `CLAUDE.md` `## Plot Config` is where Plot dog-foods exactly this, `Agent registry` set the precedent the plan itself cites, and a key set once in the hub doc is inherited by every worktree because worktrees share the tracked file. That is a feature here, not a cost: the key travels with the repo, so a desk and main agree — which is precisely what candidate 2 cannot give.

## 5. Prior art

`git log -S 'artifact_source' -- skills/` returns four commits (`6c14571e`, `71586e37`, `a1c03e98`, `eaee2739`) — the probe's birth and the board door. **No prior plan proposes reordering.** But `scripts/check-bundle-resolution.sh:30-37` already reasons about exactly this and names the probe its one exception:

> `plot-board-probe.sh` — REPORTS PROVENANCE, AND A CHECKOUT IS ONE OF ITS ANSWERS. … It tries the plugin and npm first, so the checkout path is reached only after both are absent, and naming where the artifact came from is the probe's whole output.

That gate's exception is written on the assumption of the current order. **Changing the order does not break the gate** (it still exempts the file), but the exception's stated reasoning becomes wrong, and the plan should say so. It is not a blocker; it is an undeclared edit.

## Against my own position

Three things push toward `proceed` rather than `amend`:

**The plan explicitly declines to pick.** `:58` — *"This is the slice's one real decision, and the plan does not pick for it"* — and `:78` requires the choice be argued in the PR. So one could say I am refuting an option the plan only listed, and the implementer would discover the desk problem themselves. I do not find that persuasive: `:61` states as a *fact* that the package name is unique to the building repository, and it is not. An implementer trusting that sentence has no reason to check a desk. A plan that hands its implementer a false premise about the option it favours has not deferred the decision — it has pre-loaded it.

**The premise is genuinely correct.** Unlike the two failures cited in my brief, this author read the right lines, cited them accurately, and the mechanism reproduces under a controlled fixture. That is real work and it argues against `reject`.

**The desk case may be out of scope by construction.** A worker never starts a board — `plot-boardctl.sh` is an operator command, and no desk runs one today. If that holds, candidate 2's desk misfire is latent rather than live. But "no one does this today" is not a property of the probe, and the probe is what the plan changes; the vendoring-repo and fork cases (a) and (b) misfire regardless of whether anyone starts a board from a desk.

## What would make this `proceed`

1. **Drop the outage from the motivation, or separate it.** The `exit 127` was a deleted tree, not a wrong one. Both trees and their `plot-host.sh` exist now.
2. **Replace the three-copies table with the hashes.** Two of the three are identical; the divergent one is `cache/2.21.0`, which the probe deliberately does not select. The honest finding is *a running board can outlive the probe's answer*, and that is a different (real) plan.
3. **Remove "Done when" #3** — `plot-boardctl.sh:357-359` already prints artifact and source under `--dry-run`.
4. **Correct `:61` and re-argue the choice.** The package-name test fires in the plugin tree, in any vendoring repo or fork, and in every dispatch desk — one of which is already stale today.
5. **Add an assertion for the desk.** "Done when" already requires both directions; it needs a third: *a worktree of this repository resolves the same artifact the main checkout does, or the plan states why not.*
