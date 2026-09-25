# A plugin install finds its own scripts

> Several scripts assume Plot is vendored at `<repo>/skills/plot/`. With Plot installed as a Claude Code plugin — the documented install — that directory does not exist. Measured 2026-09-25 on Plot 2.20.0 as a plugin: the installed gates point at a path that is not there, and every refusal text prescribes a command the operator cannot run.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #980
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 2
- **Approved:** 2026-09-25, Jan Wloka, in-session after two panel rounds
- **Started:** 2026-09-25, Jan Wloka, `bug/the-installer-writes-a-path-that-runs`

## Changelog

- Scripts that reach another Plot script resolve it beside themselves rather than against the adopting repository's root, so a plugin install works where a vendored checkout did. Refusal texts name a command that exists on the reader's machine.

Board impact: none directly. The gates are `PreToolUse` hooks and the refusal texts are prose; neither reaches the board's payload.

## Motivation

**The documented install is the one that does not work.** `<repo>/skills/plot/` exists only where the repository vendors Plot. A plugin install puts the scripts under `${CLAUDE_PLUGIN_ROOT}`, and three sites still name the vendored path.

**One third of this is already fixed, and that is the evidence the rest is real.** `#969` reported item 1 — `plot-fleetctl.sh` resolving the supervisor artifact against `$repo_root` — and it shipped 2026-09-25 as PR #986. Measured now, `plot-fleetctl.sh:97` reads `$script_dir/board/plot-registryd.mjs` and the supervisor starts. The same defect at two more sites was reported in the same issue and is untouched:

| site | measured 2026-09-25 | state |
|---|---|---|
| `plot-fleetctl.sh:97` | `$script_dir/board/…` | **fixed** (#986) |
| `plot-install-hooks.sh:145` | `"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/%s` | live |
| `plot-controller-gate.sh:232` | `bash skills/plot/scripts/plot-state-receipt.sh …` | live |

**The two live ones fail differently, and the first fails silently.**

### The installed gates permit everything

`plot-install-hooks.sh:145` writes `.claude/settings.json` entries rooted at `$CLAUDE_PROJECT_DIR`. In a plugin install that path holds no script, so every gate invocation runs a missing file.

**A missing hook does not block, and the vendor documents it.** Claude Code's hooks documentation addresses this case by name: a hook whose script path does not exist exits ~127, *"a hook that can't start lands in the same non-blocking bucket … for most hook events, the action proceeds"*, and `PreToolUse` blocks on **exit 2 alone**. Confirmed locally in both invocation shapes. **So every gate written at a path that does not exist permits.** One honest qualifier: the harness surfaces a notice (*"Failed with non-blocking status code"*), so the failure is **unenforced rather than wholly invisible** — the gate does not fire, and the operator is not told their repository is ungated.

**`--verify` says `verified` anyway**, and that is the measured defect. Reproduced in a scratch consumer repository with no `skills/` directory, settings written exactly as `gate_command()` writes them, `--verify` run from the plugin copy:

```
verified — 2 gate(s) refused a guarded write; 1 could not be proved here:
  verified    plot-controller-gate.sh — refused a guarded write (exit 2)
  unprobed    plot-phase-gate.sh — …
  verified    plot-state-gate.sh — refused a guarded write (exit 2)
exit=0
```

Three gates registered at a directory that does not exist, and the installer reports `verified`. **It is a design decision rather than an oversight** — `gate_path()` at `:191-195` resolves beside the script *on purpose*, with the rationale written above it, and the existence check at `:289` therefore tests the sibling and can never fire for this case.

**All five existing `--verify` tests miss it.** Each uses `repoWithGates()` (`test/reconcile/install-hooks.test.mjs:279-290`), which copies the gates into `<dir>/skills/plot/scripts/`. The vendored arm is the only arm tested.

**The plugin already registers the same three gates** through `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` — verified, exactly the same set. So on a plugin install the project-level entries are redundant as well as broken.

**But the existing no-duplicate rule does NOT reach this case, and an earlier draft of this plan claimed it did.** That rule is a basename grep over `existing_bash_hooks` (`:365-370`), and `existing_bash_hooks` reads **only `$root/.claude/settings.json`** (`:149-155`). A plugin's hooks are registered by the harness and never merged into that file, so on a real plugin install the installer sees nothing and reports `absent`. The test that proves the rule works (`install-hooks.test.mjs:135`) constructs a fixture with the plugin-spelled entry literally inside `settings.json` — a repository where somebody pasted the block in, not a plugin install.

### The refusal texts prescribe a command that is not there

`plot-controller-gate.sh:232` prints:

```
bash skills/plot/scripts/plot-state-receipt.sh --unowned-action <action> <slug> "<reason>"
```

On a plugin install that file does not exist, so **the named escape from a gate is unreachable**. CLAUDE.md's argument for the escape is that *"a gate with no exit is one people route around"* — and an exit whose command errors is a gate with no exit.

## Design

### The rule, stated once

**A script that reaches another Plot script resolves it beside itself.** `$script_dir` is what every correct site already uses, and `plot-fleetctl.sh:97` is the worked example from #986. `$repo_root` answers *which repository am I acting on*, which is a different question and stays where it is asked.

### What each site needs

**`--verify` must accept EITHER the written path or the sibling — unverified only when NEITHER finds the script.** Testing the written path *alone* was an earlier draft of this plan and it is refuted: `${CLAUDE_PLUGIN_ROOT}` is unset when the installer runs by hand, so a plugin-rooted entry in `settings.json` resolves to nothing and all three gates flip to `unverified` — on a repository whose gates were measured refusing with exit 2. **That configuration is tested and documented as correct**, at `install-hooks.test.mjs:104`, `:144` and `:160`, with `:135` explaining why a duplicate must not be added. Turning it red is the *"red on a perfect install"* outcome `plot-install-hooks.sh:254-263` argues against: a check that cries wolf on a good install is one operators learn to ignore.

**The installer must NOT try to detect a plugin install.** An earlier draft proposed exactly that — detect, and write nothing. It is refuted by measurement and it fails in the unsafe direction:

| a wrong guess | what happens |
|---|---|
| guesses **vendored** when it is a plugin (today) | writes entries at a missing path. They are inert, and the plugin's own `hooks/hooks.json` gates are registered by the harness regardless — **the repository is still gated**. |
| guesses **plugin** when it is vendored | writes nothing, reports the gates are registered. The repository now has **no gates at all**, and an installer that said otherwise. |

The second is strictly worse, and it is the arm "write nothing" produces. It also reintroduces the measured failure `plot-install-hooks.sh:52-58` exists to fix. **A detection whose wrong answer removes every gate must not gate the action** — and the signal it would need is absent, because `existing_bash_hooks` cannot see a plugin registration at all.

**So the installer reports what it cannot determine rather than deciding it.** Where the written path does not exist, say so and name both readings:

> registered at `$CLAUDE_PROJECT_DIR/skills/plot/scripts/`, which does not exist here — if Plot is installed as a plugin these entries are inert and the plugin's own gates apply; if it is vendored, the vendoring is incomplete.

That sentence is correct under both arms and guesses nothing.

**`plot-controller-gate.sh`** — the refusal text names `$script_dir/plot-state-receipt.sh`, which it can compute. A reader copying the line gets a command that runs.

### What this does NOT do

- It does not change what any gate decides, only whether it can be reached.
- It does not touch `plot-fleetctl.sh` — #986 fixed it, and re-fixing it would be the duplication this plan exists to name.
- It does not change `hooks/hooks.json`, which is already correct.
- It does not fix `plot-state-gate.sh:138,143,144`, which carry the identical repo-relative path in their own refusal texts. **Measured and deliberately deferred** to the sweep below, named here so it is not re-discovered.
- It does not audit every script for the pattern. The three sites #980 names are the measured ones; a sweep is a separate plan with its own gate.

### Open questions

- [ ] **How does a script tell a plugin install from a vendored one?** `${CLAUDE_PLUGIN_ROOT}` is set in a hook's environment but not necessarily when a script runs by hand. The detection must not guess wrong in the direction that skips a gate a vendored repo needs.

## Done when

- `plot-install-hooks.sh` on a plugin install writes no project-level gate entry and says why; on a vendored install it writes what it writes today.
- `--verify` tests the path it wrote. A test asserts that a settings entry pointing at a missing script reports **not** verified.
- `plot-controller-gate.sh`'s refusal names a path that exists on the machine printing it.
- **A plugin-rooted entry with the gates in place still reports `verified`.** None of the five existing `--verify` tests spells the entry the plugin's way — `repoWithGates()` covers only the vendored arm — so without this test slice 1 ships the false negative.
- **A test per site.** No test asserting `plot-fleetctl.sh` is untouched — `scripts/check-bundle-resolution.sh` already holds that invariant across every bundle caller, which is more than one test would.
- The gate set is still read from `hooks/hooks.json` rather than hardcoded — the existing rule, unchanged.

## Slices

### The installer writes a path that runs (Branch: bug/the-installer-writes-a-path-that-runs, PR: #998)

- `bug/the-installer-writes-a-path-that-runs` — `--verify` tests the path the installer WROTE rather than the script beside itself (`gate_path()`, `:191-195`), so an entry pointing at a missing script reports **unverified**; where the written path is absent the installer names both readings rather than choosing one. **No plugin detection** — the signal is absent and a wrong guess leaves a vendored repository ungated. Tests: the vendored arm unchanged, and a settings entry at a missing path reporting unverified, which all five existing `--verify` tests miss because `repoWithGates()` always copies the gates into place

### A refusal names a command that exists (Branch: bug/a-refusal-names-a-command-that-exists, PR: #996)

- `bug/a-refusal-names-a-command-that-exists` — `plot-controller-gate.sh:232` builds the escape command from `HERE` (`:187`) — **not `$script_dir`, which does not exist in that file**; a test asserts the printed path resolves to a real file from a checkout whose layout differs from the caller's → #996

## Notes

- **Panelled again 2026-09-25 (round 2): `amend`, `Evidence: executed`.** Round 1 refuted this plan's design, the plan was rewritten, and **nobody had questioned the replacement** — which is why it went back. Two results. The premise round 1 could not settle is **settled affirmatively**: the vendor's hooks documentation names the missing-script case, quotes exit 127 and says the action proceeds, so the defect is severe and the plan now asserts it. Round 1 was right that the ESTATE holds no evidence; the evidence is the vendor's, and nobody had looked there. And the replacement design is **refuted** — `--verify` testing the written path alone turns a *correct* plugin install red, because `${CLAUDE_PLUGIN_ROOT}` is unset when the installer runs by hand and three tests construct exactly that configuration. Accepting either reading fixes both. Verdict: `.plot/panels/a-plugin-install-finds-its-own-scripts/juror-round2.md`.

- **Panelled 2026-09-25: `amend`, `Evidence: executed`.** Every verbatim citation reproduced — `:97`, `:145`, `:232`, and the three plugin-registered gates. The juror **reproduced the silent `verified`** in a scratch consumer repository and found it stronger than drafted: the sibling resolution is deliberate, with its rationale written at `:191-195`, so this is a design defect rather than an oversight. Two things were refuted. The *"a missing hook permits"* premise has **no evidence in this estate** — a nonexistent command exits 127 and the harness's reading of that is recorded nowhere — so the Motivation no longer asserts it. And *"detect a plugin install and write nothing"* was refuted by measurement: `existing_bash_hooks` reads only `settings.json`, a plugin registers nothing there, and the wrong half of that guess leaves a vendored repository with no gates. Verdict file: `.plot/panels/a-plugin-install-finds-its-own-scripts/juror.md`.
- **The gate for this class already exists next door.** `scripts/check-bundle-resolution.sh` holds the bundle-path pattern at zero after #986, but neither live site here is a bundle path — one is a settings string, one is prose in a refusal. The sweep this plan scopes out has an obvious model.

- Reported as one issue naming three sites. The first shipped separately as `fleet-control-finds-its-own-artifact` (#969 → PR #986) before this plan was written, which is why this plan covers two slices rather than three and says so in a table rather than quietly dropping it.
- **The silent failure is the serious half.** A missing gate script permits, and the installer reports `verified`, so a repository can believe it has three gates and have none. The refusal-text defect is real and merely inconvenient by comparison.
