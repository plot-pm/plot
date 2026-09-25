# Juror: evidence + design

Position: amend
Evidence: executed

## Summary

Every verbatim measurement in the plan reproduces. The plan's most serious claim — `--verify` reports `verified` on a plugin install where no registered gate can run — **reproduces exactly**, and I have the output. Two things must change before this is built: one premise the plan rests on has **no evidence in this repo** and the plan does not say so, and the plan's stated design for the installer (*"detect a plugin install and write nothing"*) is **refuted by measurement** — the installer on a plugin install sees an empty settings file and has no signal to detect anything, and writing nothing would leave a vendored-fallback repo with no gates.

---

## EVIDENCE — every stated measurement, re-run

### 1. `plot-fleetctl.sh:97` — CONFIRMED, and fixed

```
$ grep -n 'plot-registryd' skills/plot/scripts/plot-fleetctl.sh
97:registryd="$script_dir/board/plot-registryd.mjs"
```

Line number exact. The comment above it (`skills/plot/scripts/plot-fleetctl.sh:91-96`) names #969 and the defect verbatim. The fix shipped:

```
$ git log --oneline --grep='986'
f98d14a45 Fleet control resolves beside itself (#986)
```

And it is now gated — `scripts/check-bundle-resolution.sh` exists and holds the pattern at zero, allowlisting only `plot-board-probe.sh`. The plan's claim is true **and understated**: it is not merely fixed, it has a gate.

### 2. `plot-install-hooks.sh:145` — CONFIRMED verbatim, exact line

```
$ grep -n 'CLAUDE_PROJECT_DIR"/skills/plot/scripts' skills/plot/scripts/plot-install-hooks.sh
145:  printf '"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/%s' "$1"
```

### 3. `plot-controller-gate.sh:232` — CONFIRMED verbatim, exact line

```
$ grep -n 'bash skills/plot/scripts/plot-state-receipt.sh' skills/plot/scripts/plot-controller-gate.sh
232:  echo "      bash skills/plot/scripts/plot-state-receipt.sh --unowned-action $action <slug> \"<reason>\""
```

The string is hardcoded and repo-relative. `script_dir` is available in that script, so the fix the plan proposes is mechanically available.

### 4. `--verify` "runs the scripts next to itself" — **CONFIRMED, and it is worse than the plan says**

The plan is right, and the code says so *on purpose*. `skills/plot/scripts/plot-install-hooks.sh:191-195`:

```bash
  # Where the gate scripts actually live. The registered command is
  # repo-relative by construction (gate_command), but a plugin-registered entry
  # is ${CLAUDE_PLUGIN_ROOT}-rooted, so the script beside THIS one is the
  # reading that works for both.
  gate_path() { printf '%s/%s' "$script_dir" "$1"; }
```

The sibling resolution is a deliberate decision with a stated rationale — which makes this a **design defect, not an oversight**, and the plan should say so. The existence check at `:289` (`if [ ! -f "$gp" ]` → `unverified ... the script is not at $gp`) tests the **sibling**, so it can never fire for the case that matters.

**I reproduced the silent pass.** Scratch consumer repo, no `skills/` directory (a plugin install), settings written exactly as `gate_command()` would write them, `--verify` run from the plugin copy:

```
$ test -d skills && echo YES || echo "NO (plugin install)"
NO (plugin install)
$ bash <plugin>/skills/plot/scripts/plot-install-hooks.sh --verify
verified — 2 gate(s) refused a guarded write; 1 could not be proved here:
  verified    plot-controller-gate.sh — refused a guarded write (exit 2)
  unprobed    plot-phase-gate.sh — reads the plan from origin/<main>, which a scratch repository has no remote for
  verified    plot-state-gate.sh — refused a guarded write (exit 2)
exit=0
```

Three gates registered at `$CLAUDE_PROJECT_DIR/skills/plot/scripts/`, that directory does not exist, and the installer reports **`verified`, exit 0**. The plan's characterisation — *"the installer confirms a protection that is not in place"* — is precisely correct.

**Why the existing tests miss it**: `test/reconcile/install-hooks.test.mjs:279-290` defines `repoWithGates()`, which `copyFileSync`s each gate into `<dir>/skills/plot/scripts/`. Every one of the five `--verify` tests (`:292`, `:307`, `:319`, `:332`, `:356`) uses it. The vendored arm is the only arm tested. The plan's "Done when" item — *"a test asserts that a settings entry pointing at a missing script reports not verified"* — is the right test and it genuinely does not exist.

### 5. "A PreToolUse hook pointing at a missing script is non-blocking and therefore permits" — **NOT ESTABLISHED. This is the amendment.**

I searched the estate and found **no evidence for this premise**:

- `grep -rn "non-blocking\|permits\|fail open" skills/plot/scripts/plot-state-gate.sh skills/plot/scripts/plot-phase-gate.sh` returns exactly one line, and it is about a *different* case: `plot-phase-gate.sh:243` — `exit 0   # fail open: unreadable blob is not evidence of a Draft plan`. That is the gate deciding to permit, not a missing gate permitting.
- No hooks documentation in the repo states the exit-code contract for a command that cannot be executed.
- The estate's own documented contract is only about exit 2: `plot-install-hooks.sh:38-45` measures three outcomes of *running* the gate and states *"Only the refusal is positive evidence, and it is read from exit 2."* It says nothing about a command that does not exist.

A nonexistent command under `bash` exits **127**, not 0 or 2. Whether Claude Code treats 127 as permit, as an error surfaced to the user, or as a block is a **harness property this repo does not record anywhere**. It is plausible that it permits — but the plan asserts it as measured fact and it is not one in this estate.

**This matters for scope, not for validity.** The `--verify` defect I reproduced above stands on its own: the installer reports a protection it did not prove, regardless of what a missing hook does at runtime. But the plan's Motivation is built on *"the installed gates permit everything"*, and the Notes call the silent failure *"the serious half"* — that framing needs the premise. If a missing hook turns out to surface a visible error on every Bash call, the defect is loud rather than silent and the priority argument changes.

### 6. "The plugin's own hooks/hooks.json already registers the same gates via `${CLAUDE_PLUGIN_ROOT}`" — CONFIRMED, exactly three, exactly the same set

```
$ cat hooks/hooks.json
... "${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-phase-gate.sh"
... "${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-state-gate.sh"
... "${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-controller-gate.sh"
```

One matcher, `Bash`, three gates — the same three the installer reads out of that file and writes.

---

## DESIGN — where the plan is wrong

### The detection the plan proposes cannot be done, and the Open Question understates it

The plan asks *"How does a script tell a plugin install from a vendored one?"* and worries `${CLAUDE_PLUGIN_ROOT}` may be unset when run by hand. The real problem is one step earlier and I measured it.

**The installer already knows how to answer a related question, and the answer is empty on a plugin install.** Run `--check` in a bare consumer repo with the plugin installed:

```
$ bash <plugin>/skills/plot/scripts/plot-install-hooks.sh --check
absent — .../.claude/settings.json would register: plot-controller-gate.sh plot-phase-gate.sh plot-state-gate.sh
exit=3
```

`existing_bash_hooks` (`:149-155`) reads **only `$root/.claude/settings.json`**. A plugin's `hooks/hooks.json` is registered by the harness, not merged into the project's settings file. So on a plugin install the installer sees **nothing registered** and reports `absent`.

**This refutes the plan's appeal to the existing duplicate rule.** The plan argues (line 40) that `plot-install-hooks.sh`'s own no-duplicate rule *"says the right answer is to write no entry at all."* It does not. That rule is implemented at `:365-370` as a basename grep over `existing_bash_hooks`, and `test/reconcile/install-hooks.test.mjs:135` proves it works **only when the plugin-spelled entry is literally present in `settings.json`** — the fixture constructs `{matcher:'Bash', hooks:[{command:'"${CLAUDE_PLUGIN_ROOT}/..."'}]}` inside the settings file. That fixture models a repo where somebody pasted the plugin block into their settings, not a plugin install. The rule has never seen a real plugin install, and on one it does not fire.

So the plan cites a precedent that does not reach the case, and the Open Question it files against itself is load-bearing rather than incidental.

### "Write nothing" is the wrong answer, and it fails in the unsafe direction

The plan asks which way detection fails. Consider both arms of a wrong guess:

- **Guesses vendored when it is a plugin** (today's behaviour): writes entries at a missing path. Under the plan's own premise, that is silent permission — bad, but the plugin's `hooks/hooks.json` gates are *still registered by the harness*, so the repository is actually gated. The broken entries are inert.
- **Guesses plugin when it is vendored**: writes nothing and reports the gates are already registered. The vendored repo now has **no gates at all** and an installer that told it otherwise. This is the measured failure `plot-install-hooks.sh:52-58` was written to fix, reintroduced by its own installer.

The second is strictly worse, and "write nothing" is the arm that produces it. A detection that cannot be made reliable — and on the evidence above, this one cannot, because the signal it would need is absent — must not gate an action whose wrong answer removes every gate.

**The alternative the plan dismisses in one line is the better one.** The plan's Design (line 63) rejects writing plugin-rooted entries without argument. But writing `${CLAUDE_PLUGIN_ROOT}`-rooted entries has a property "write nothing" does not: it needs no detection at all. If `${CLAUDE_PLUGIN_ROOT}` is set, the path resolves; if it is not, the entry is no worse than today. The plan's stated objection would be the receipt-spending duplicate — and that objection is real, since the plugin already registers the same three gates. Which is the actual finding: **on a plugin install the correct number of project-level entries is zero, but the reason is redundancy, and the installer has no way to see it.**

That makes the honest fix narrower than the plan's: `--verify` must test the written path, and the installer should report what it cannot determine rather than deciding it. An installer that says *"registered at `$CLAUDE_PROJECT_DIR/skills/plot/scripts/`, which does not exist here — if Plot is installed as a plugin these entries are inert and the plugin's own gates apply; if it is vendored, the vendoring is incomplete"* is correct under both arms and guesses nothing.

### Scoping out `plot-fleetctl.sh` is honest — and the plan is too modest about it

#980 named three sites; the plan covers two and says so in a table rather than dropping the third. That is the right call and it is well done. It is also stronger than the plan claims: #986 did not merely fix the line, it added `scripts/check-bundle-resolution.sh`, a gate holding the pattern at zero across `skills` and `hooks`. The plan's "Done when" item *"one asserting `plot-fleetctl.sh` is untouched"* is therefore redundant — that gate already asserts more than the proposed test would, over every bundle caller rather than one.

### One thing the plan should notice but does not

`check-bundle-resolution.sh` covers **bundle** paths (`…/board/*.mjs`). Neither live site in this plan is a bundle path — one is a settings string, one is prose in a refusal. So the estate has a gate for exactly the class #986 fixed and none for the class this plan fixes. The plan says *"a sweep is a separate plan with its own gate"* (line 74), which is right, but it should name that the gate shape already exists next door and is the obvious model.

---

## What must change

1. **Drop or qualify the "non-blocking therefore permits" claim.** Either produce the evidence (harness docs, a measured run) or restate the Motivation on what *is* measured: `--verify` reports `verified` for gates it did not prove, which I reproduced. The defect does not need the premise; the plan's framing of severity does.

2. **Replace "detect a plugin install and write nothing" with a design that needs no detection.** State the measurement: `existing_bash_hooks` reads only `settings.json`, a plugin install registers nothing there, so the installer cannot see a plugin registration and the existing duplicate rule does not reach this case. Then say which way the remaining ambiguity is allowed to fail — and it must not be the arm that leaves a vendored repo ungated.

3. **Correct line 40.** The claim that the existing no-duplicate rule *"says the right answer is to write no entry at all"* is refuted by `:365-370` and by the fixture at `install-hooks.test.mjs:135`. The rule matches basenames in `settings.json` only.

4. **Keep the `--verify` slice as written** — it is correct, the defect is real and reproduced, and the test it asks for closes a genuine hole in all five existing `--verify` tests.

5. **Drop the "`plot-fleetctl.sh` is untouched" test** in favour of naming `scripts/check-bundle-resolution.sh`, which already holds that invariant more broadly.
