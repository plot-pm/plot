# Juror round 2: the premise, and the design nobody had questioned

Position: amend
Evidence: executed

## Summary

**The unanswered premise is SETTLED, affirmatively, by the harness's own documentation** — which addresses the missing-hook case by name and even quotes exit 127. The plan's Motivation may now assert what round 1 correctly refused to let it assert, and the defect is confirmed **silent**, not loud. That is a strengthening, not an amendment.

The amendment is the replaced design. **`--verify` testing the written path breaks the case `gate_path()` was written for, and I reproduced the break.** A plugin-rooted entry inside `settings.json` — a configuration this repo's own test suite constructs in **three** places — reports `verified` today and would flip to `unverified` under the plan, on a repository whose gates I separately proved DO refuse. The plan proposes the change in one sentence and never traces this arm.

---

## 1. THE PREMISE — SETTLED, and the plan may now assert it

Round 1 refused the claim for want of evidence in the estate, and the plan then declined to assert it. **The evidence exists; it is simply not in this repository.** It is in the Claude Code hooks documentation (`https://code.claude.com/docs/en/hooks`), which addresses this exact scenario:

> "A hook that can't start lands in the same non-blocking bucket. When the script path doesn't exist or isn't executable, the shell exits with a code like 127 and you see the same notice with the interpreter's message, for example `Failed with non-blocking status code: /bin/sh: /path/to/hook.sh: No such file or directory`. For most hook events, the action proceeds."

And the general rule it falls under:

> "Any other exit code doesn't block on its own for most hook events."

Against `PreToolUse` specifically, the documented blocking mechanism is exit 2 alone:

> "Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print JSON."

I confirmed the 127 half locally, in both plausible invocation shapes:

```
$ echo '{"tool_input":{"command":"git commit -m x"}}' | bash /nonexistent/.../plot-state-gate.sh
bash: /nonexistent/path/skills/plot/scripts/plot-state-gate.sh: No such file or directory
exit=127
$ echo '{...}' | sh -c '"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/plot-state-gate.sh'
sh: /skills/plot/scripts/plot-state-gate.sh: No such file or directory
exit=127
```

**What this settles.** A missing gate script is non-blocking and the tool call proceeds — so the installed gates DO permit everything. The defect is silent in the sense that matters: nothing refuses. One qualification the plan should carry rather than overstate — the docs say a notice IS surfaced (`Failed with non-blocking status code: …`), so it is not literally invisible. It is **non-blocking and cosmetic**: a notice an operator may never read, on a gate that no longer gates. `plot-install-hooks.sh:28` already says it in the estate's own words — *"a missing gate does not error — it permits"* — and that line is now supported by the vendor's documentation rather than by assumption.

**Consequence for the plan:** the Motivation section *"What a missing hook does at runtime is NOT established, and this plan does not assert it"* is now out of date and understates a confirmed defect. Priority argument holds: severe.

---

## 2. THE REPLACED DESIGN — the refutation

### 2a. `--verify` on the written path: I traced all three arms

**The vendored arm survives.** Full script tree, entries written exactly as `gate_command()` writes them:

```
$ bash skills/plot/scripts/plot-install-hooks.sh --verify
verified — 2 gate(s) refused a guarded write; 1 could not be proved here:
  verified    plot-controller-gate.sh — refused a guarded write (exit 2)
  unprobed    plot-phase-gate.sh — …
  verified    plot-state-gate.sh — refused a guarded write (exit 2)
exit=0
```

Resolving the WRITTEN path in that same fixture:

```
plot-phase-gate.sh       written-path exists? YES -> would still verify
plot-state-gate.sh       written-path exists? YES -> would still verify
plot-controller-gate.sh  written-path exists? YES -> would still verify
```

Good — `$CLAUDE_PROJECT_DIR` expands to the repo root and the vendored case is unaffected.

**The plugin-rooted-in-settings arm BREAKS. This is the finding.** `gate_path()`'s comment at `:191-195` names this case explicitly:

```
  # The registered command is repo-relative by construction (gate_command),
  # but a plugin-registered entry is ${CLAUDE_PLUGIN_ROOT}-rooted, so the
  # script beside THIS one is the reading that works for both.
```

Same repository, same correct gates, entries spelled the plugin's way inside `settings.json`. **Today:**

```
verified — 2 gate(s) refused a guarded write; 1 could not be proved here:
  verified    plot-controller-gate.sh — refused a guarded write (exit 2)
  verified    plot-state-gate.sh — refused a guarded write (exit 2)
exit=0
```

**Under the plan**, `${CLAUDE_PLUGIN_ROOT}` is unset when the installer runs by hand:

```
CLAUDE_PLUGIN_ROOT='<UNSET>'
plot-phase-gate.sh       resolves to: /skills/plot/scripts/plot-phase-gate.sh   exists? NO  <-- flips to unverified
plot-state-gate.sh       resolves to: /skills/plot/scripts/plot-state-gate.sh   exists? NO  <-- flips to unverified
plot-controller-gate.sh  resolves to: /skills/plot/scripts/plot-controller-gate.sh exists? NO  <-- flips to unverified
```

The gates are present and I proved in the run above that they **refuse with exit 2**. The plan would report that repository `unverified`.

**This is not a hypothetical configuration.** `test/reconcile/install-hooks.test.mjs` constructs plugin-rooted entries in `settings.json` at `:104`, `:144` and `:160`, and `:135`'s test — *"a plugin-registered gate reports current and adds no duplicate"* — documents it as correctness rather than tidiness, because a duplicate state gate spends the receipt twice. So it is a supported, tested configuration, and the plan turns a green install red on it.

**It is also exactly the failure direction the plan itself forbids.** The plan's own table rejects "write nothing" because a wrong guess leaves a repository believing something false. A `--verify` that reports `unverified` on a correctly gated repository is the same error class: `plot-install-hooks.sh:254-263` argues a verdict that is red on a perfect install is *"one operators learn to ignore, which is how a gate nobody trusts fails."* The plan's change manufactures precisely that verdict.

**The fix is available and small:** test BOTH readings and let either satisfy. The written path is the one that proves the registered entry is live; the sibling is the one that proves a plugin-rooted entry resolves. A gate found at neither is the measured defect and reports `unverified`. That keeps round 1's reproduced bug closed without inventing a false negative. The plan must say this — as written, it says only *"must take the registered command's path instead"*, which is the regression.

### 2b. "Report both readings" — useful, but it must not be the whole answer

Asked what an operator DOES with the sentence: it is genuinely actionable, and better than the alternatives. It names a check the reader can run (`does my install have a `skills/` directory?`) and it is correct under both arms, which "write nothing" is not. Round 1's reasoning here is sound and I do not overturn it.

But it is only adequate **because the stakes are low in that arm** — and the premise settled in §1 is what proves that. On a plugin install the harness registers the three gates from `hooks/hooks.json` regardless, so the repository is gated and the stray entries are inert. The sentence reports a cosmetic mess, not an exposure. The plan should say that plainly rather than leaving the operator to weigh two readings of unknown severity: **"if Plot is a plugin, you are gated by the plugin's own registration and these entries do nothing; remove them if you like."** That converts a hedge into an instruction, which is the estate's own standard (`plot-controller-gate.sh:220` — *"A refusal an operator cannot act on becomes a flag somebody turns off"*).

### 2c. Known-inert entries in a user's settings.json

The plan keeps writing them and says nothing about them. Given §1, they are harmless — non-blocking, and shadowed by a working plugin registration. But "harmless" is a conclusion the plan now has evidence for and should state, because an operator reading three broken paths in their own settings file cannot tell that without it. One sentence in *"What this does NOT do"* suffices. I do not think it blocks the slice.

---

## 3. SLICE 2 — still correct, and mechanically available

`plot-controller-gate.sh:232` is unchanged and still hardcoded:

```
232:  echo "      bash skills/plot/scripts/plot-state-receipt.sh --unowned-action $action <slug> \"<reason>\""
```

**One correction to the plan's wording.** It says the gate "can compute" `$script_dir`. There is no `script_dir` in this file — `grep -n 'script_dir'` returns nothing. What exists is `HERE`, at `:187`:

```
187:HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

assigned at top level and therefore in scope at `:232`. The fix is available exactly as intended; the plan names the wrong variable. Trivial, but a brief written from it would grep for a variable that is not there.

**One thing the plan scopes out that it should at least name.** `plot-state-gate.sh` carries the identical defect at three lines:

```
138:    printf '/plot-sprint %s %s  (or: bash skills/plot/scripts/plot-sprint-state.sh %s %s)\n'
143:    approved) printf '/plot-approve %s  (or: bash skills/plot/scripts/plot-approve.sh %s)\n'
144:    delivered) printf '/plot-deliver %s  (or: bash skills/plot/scripts/plot-deliver.sh %s)\n'
```

Same class, same unreachable-escape consequence, in a sibling gate. The plan says *"the three sites #980 names are the measured ones; a sweep is a separate plan"* — defensible, but these three are in the file next door and found by the slice's own grep. The plan should name them as measured-and-deferred rather than leave the next reader to rediscover them.

---

## What must change

1. **Assert the premise, with the citation.** The hooks documentation states that a hook whose script path does not exist exits ~127 and is non-blocking, and that `PreToolUse` blocks on exit 2 alone. Motivation's *"NOT established"* paragraph should become the measurement it now is — with the honest qualifier that a non-blocking notice IS surfaced, so the failure is unenforced rather than wholly invisible.

2. **`--verify` must accept EITHER the written path or the sibling, not the written path alone.** As drafted it reports `unverified` on a plugin-rooted entry in `settings.json` whose gates I proved refuse with exit 2 — a configuration three tests in `install-hooks.test.mjs` construct, and the exact "red on a perfect install" verdict `:254-263` argues against. Unverified only when NEITHER reading finds the script.

3. **Add the regression test for that arm.** The `Done when` list must include a plugin-rooted-entry fixture with the gates in place, asserting it still reports `verified`. Without it slice 1 ships the false negative, because all five existing `--verify` tests use `repoWithGates()` and none spells the entry the plugin's way.

4. **Correct `$script_dir` → `HERE` (`:187`)** in the slice-2 description.

5. **Name `plot-state-gate.sh:138,143,144`** as the same defect, measured and deliberately deferred to the sweep.

Slice 2 is otherwise correct as written and I endorse it unchanged.
