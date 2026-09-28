## Implementation brief — a-heading-names-a-branch-or-says-it-could-not

- **Plan (canonical):** `docs/plans/2026-09-28-a-heading-names-a-branch-or-says-it-could-not.md` on `main`
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Branch:** `bug/a-heading-names-a-branch-or-says-it-could-not` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1031

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

Two halves.

**Read the backticked form.** `(Branch: \`bug/x\`)` parses to `branches: []` today. The classification is fine — `slice_shape` at `plot-plan-meta.sh:927` tests `index($0, "(Branch:")` and a backticked heading contains it. The extraction is not: `plot-plan-meta.sh:1295` anchors the prefix after optional whitespace only, and a backtick intervenes.

**Report a heading that names a branch the parser did not take.** A non-blocking section in `plot-reconcile-scan.sh`, below `== blocking sections end ==`.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The regex change is already verified over the whole estate.** The panel patched a copy and ran both versions over all 357 plans: **4 diff lines, 2 changed records, 355 byte-identical**, with `parser.test.mjs` at 106/106. The shape it used:

```awk
if (match(hmeta, "Branch:[ \t]*`?(" PREFIXES ")/[^ \t,)`]+`?")) {
    b = substr(hmeta, RSTART, RLENGTH)
    sub(/^Branch:[ \t]*/, "", b)
    gsub(/`/, "", b)
```

You are not obliged to use it, but if you write a different one, **re-run the same whole-estate diff** — "widens and narrows nothing" is a measured claim here, not an argument.

**THE CONTROL GROUP IS 10, NOT 12, AND ONLY AFTER WAVE 1.** Twelve plans carry an empty wave today; **two of them are this defect** — `a-parsed-plan-joins-the-index` and `the-board-updates-an-index`, the two Rejected plans the plan's Motivation names. Fix the regex first and recount, or you will assert against a population that stops existing.

**DO NOT ASSERT SILENCE AGAINST `the-pulse-is-an-entity`.** Four of its seven empty waves are a **second, distinct defect** (#1042): `slice_shape` latches on a section's first `###` heading, so a narrative one routes the whole section to the list consumer and every branched heading below is lost. Minimal pair, same content reordered:

```
### A narrative heading with no branch     ← first
### Real work (Branch: bug/real-work)      → branches: []

### Real work (Branch: bug/real-work)      ← first
### A narrative heading with no branch     → branches: ["bug/real-work"]
```

**Wave 1 does not touch it, and this plan does not fix it.** The scan must **report** those five slices — the discriminator describes them exactly — and the finding says the repair is #1042. A test asserts they appear.

**Pick the silence fixture from the 10**, whose emptiness is genuinely narrative (no `Branch:` in the heading at all). `a-wave-is-a-thing-not-a-label` or `a-mock-row-shows-what-the-tuple-still-gets-wrong` are safe; verify before choosing.

**The discriminator is not emptiness.** It is *a heading carrying `Branch:` that yields no branch*. The 10 legitimate empty waves carry no `Branch:`, which is exactly why they stay silent.

**Non-blocking, and never a `PreToolUse` gate.** A plan file is edited constantly by people and agents; a gate on every write fires mid-sentence. The scan runs over finished files, reports, and changes no exit code.

**The open question the slice must answer:** whether `plot-plan-meta.sh` emits the unreadable heading itself, so the scan reads one value rather than re-parsing. That is the cleaner shape and it widens the plan-format contract. Argue it either way in the PR and say which you chose. **Note the scan already takes 21-37s** — measure what your approach adds before choosing the one that re-parses.

**Out of scope:** the template (`/plot-idea` keeps writing the unbackticked form); making an unreadable heading an error; `slice_shape` (#1042); the 10 legitimate empty waves, which are not defects.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **Both forms parse**, asserted in the same test.
- **The whole-estate diff is re-run** if you changed the regex shape, and reported in the PR.
- **The five latched slices ARE reported**, by name. The scan's value here is that it finds a defect this plan does not fix.
- **A narrative empty wave is NOT reported**, asserted against one of the 10 — never one of the 5.
- The new counter sits below the blocking marker and gates nothing.
- `parser.test.mjs` passes unchanged: this widens what is accepted and narrows nothing.
