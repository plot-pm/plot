# Estate lens — fleet-control-finds-its-own-artifact

Position: proceed

The counts are exact, the outlier is real and singular, the recommended idiom is correct by measurement under a live plugin install, and the "one line" claim holds because the unit fill reuses the same variable. Three amendments are offered below as findings, none of them blocking.

## The count: 26 / 1. Correct, to the number.

Counted over `skills/plot/scripts/*.sh`, code lines only (comment lines excluded — the raw grep returns more because `plot-dispatch.sh:1908`, `:1923`, `plot-deliverable-search.sh:133` and others discuss bundles in prose):

- **26** sites resolve script-relative: `$script_dir/board/`, `$here/board/`, `$HERE/board/`. Fourteen files: `plot-approve.sh:473`, `plot-deliver.sh:165,373`, `plot-dispatch.sh:861,862,1351,1352,1356,1936,2214`, `plot-fleet-scan.sh:3407,3795,4142,4453`, `plot-open-pr.sh:37`, `plot-reconcile-scan.sh:2449`, `plot-release-gate.sh:28`, `plot-sprint-release.sh:112`, `plot-sprint-state.sh:29`, `plot-story-lint.sh:96`, `plot-undeliver.sh:28`, `plot-worker-loop.sh:1088,1182,1183`, `plot-worker-state.sh:728`, `plot-write-config.sh:31`.
- **1** resolves against a repo root: `plot-fleetctl.sh:89`. The plan's table is right.

A 27th script-relative site exists in a form the plan's idiom list does not name — `plot-pr-merged.sh:105` inlines the `cd/dirname/BASH_SOURCE` expression rather than using a `$script_dir` variable. It is correct under a plugin install and does not change the plan's argument, but **a gate grepping for `$script_dir/board/` will not see it**, which matters for slice 3 below.

## Is `:89` the only `$repo_root`-resolved bundle path? Yes — with one deliberate sibling.

`plot-board-probe.sh:266-267` builds `$git_root/skills/plot/scripts/board/board-server.mjs`, and that is **not** a defect: it is the probe's third and last fallback, reached only after `marketplaces/` and the npm bin miss, and it stamps `artifact_source="checkout"`. It is answering *where did this come from*, which is the probe's job. Any gate written for the Done-when must exempt it by name, or it fails on the file that already does this correctly.

Searched beyond `skills/plot/scripts/`: `packages/board/src/contract/bundles.generated.ts:43-62` holds the twenty bundle paths as repo-relative strings, but those are a *contract manifest* consumed by `stuck.ts`/`resolver.ts`, not a resolution site. `hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}` throughout. `scripts/` has no bundle path. **Nothing else resolves a bundle off a repo root.**

## `$script_dir` under a plugin install: verified empirically, not argued.

A real install exists on this machine, so this is measured rather than reasoned:

```
/Users/jwloka/.claude/plugins/marketplaces/plot-marketplace/skills/plot/scripts/plot-fleetctl.sh
realpath == the same path          (no symlink anywhere in the chain)
$script_dir  → …/plot-marketplace/skills/plot/scripts
$script_dir/board/plot-registryd.mjs  → exists
$script_dir/../units/                 → exists, both templates present
```

The `BASH_SOURCE[0]` + `cd`/`pwd` form at `plot-fleetctl.sh:64` is physical-path resolution: `pwd` in a `cd`'d subshell returns the resolved directory, so even if a marketplace copy were symlinked the result lands beside the real script — which is where the bundle is. `UNIT_DIR` at `:83` already depends on exactly this and works, so the file's own existing behaviour is the proof.

**The plan's rejection of the probe is also right on a second ground it does not state.** `plot-board-probe.sh` searches for `board-server.mjs` specifically (`:242`, `:248`) and returns *that* artifact. Fleet control needs `plot-registryd.mjs`. Adopting the probe would require widening it or deriving a sibling path from its answer — strictly more work than the one-line change, on top of the dependency `DESIGN-process.md` §1 forbids.

## The unit fill: the plan is right, and it is the same variable.

`plot-fleetctl.sh:593` is `-e "s|__REGISTRYD__|$registryd|g"` — the *same* `$registryd` set at `:89`. So fixing line 89 fixes the fill for free, and the plan's "one line" is accurate. Slice item 2 ("the unit fill resolves the same way") is satisfied by item 1, not by a second edit.

Worth stating because the plan implies two changes where there is one: the honest framing is *one line, and a test proving the fill inherited it*.

## Findings the plan does not carry

**1. A second consumer-relative read survives at `:110`, and the plan's exclusion list arguably covers the wrong case.** `pinned_major()` reads `$repo_root/.nvmrc`. In a consumer repo that is the *consumer's* pin — but the node version that matters is the one `plot-registryd.mjs` needs, and that artifact ships from the plugin, which carries its own `.nvmrc`. A consumer repo pinned to 22, or with no `.nvmrc` at all, either refuses `--start` wrongly or skips refusal 2 silently (`[ -n "$want" ]` makes an absent file a no-op). The plan's "does not touch `$repo_root` elsewhere" says this reading is for "the estate's own files — plans, `.plot/state`, worktrees". `.nvmrc` is not one of those; it is a property of the shipped artifact. This deserves a sentence — either as in-scope or as an explicitly deferred sibling — rather than falling through the exclusion list unexamined.

**2. There are two refusal sites, not one.** `:505-506` (`--once`) and `:518-519` (`--start`). Slice item 3 says "the refusal's message" singular; both need the wording change, and `test/reconcile/fleetctl.test.mjs:214` and `:223` already assert on each separately.

**3. The Done-when gate has a near neighbour, and should join it rather than start fresh.** `test/reconcile/resolveartifact.test.mjs:533`, *"build.mjs, the script and the board contract name the same bundle set"*, already holds the bundle-set contract as sets across three sources. Nothing anywhere asserts anything about *how a script resolves* a bundle path — so the gate the plan asks for genuinely does not exist, and the plan is right to ask. But `scripts/check-*.sh` is the estate's home for grep-shaped gates (`check-bundle-attributes.sh` is the closest precedent, and its header argues at length for deriving the bundle set from `build.mjs` rather than listing it). A new gate should follow that file's own lesson: derive, exempt `plot-board-probe.sh` by name and reason, and count the `plot-pr-merged.sh:105` inline form as compliant.

## Prior art

Nothing duplicates this. `2026-08-29-the-artifact-builds-the-same-everywhere.md` and `2026-09-15-the-board-asks-the-build-resolver.md` are about the build's determinism and the board's resolver, not about script-side path resolution. `2026-09-09-an-adopting-repo-installs-its-gates.md` and `2026-09-17-a-rule-reaches-the-install-that-runs-it.md` are the adjacent family — plugin-vs-checkout reach — and neither touches `plot-fleetctl.sh`. Issue #969 matches the plan's account of it, including the `339df23` line reference, which is still unchanged on this checkout.

## The plan's own honesty

The note *"It is not reproducible here, because this repository is both the plugin and the consumer"* is correct and is the reason the defect survived 26-to-1. Worth keeping: it is also why the gate matters more than the fix.
