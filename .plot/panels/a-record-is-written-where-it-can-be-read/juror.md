# Juror: p981 — evidence + design

Position: amend
Evidence: executed

## Summary

The defect is real and I reproduced every step of it independently. The fix direction (A over B) is
sound and I could not refute it — B is in fact a worse trap than the plan argues. But the plan is
**wrong on two load-bearing factual claims**, and both change the work:

1. **"This estate never saw it" is false.** Ten plans here carry 38 swallowed records.
2. **The fix already exists, shipped 2026-09-01 as PR #597, with a test file.** The plan proposes to
   invent a guard that `plot-deliver.sh` has carried for three weeks, and does not cite it. The
   Open Question ("do they share or duplicate?") is answered: **three copies, one already fixed.**

The plan is also missing a third writer entirely, and its preferred guard shape is the *blunt* one
the existing fix used — which misplaces the record on 12 real plans here.

---

## EVIDENCE — reproduced

### 1. The insertion lands inside the comment. CONFIRMED.

`append_approved_line` extracted verbatim (`skills/plot/scripts/plot-approve.sh:409-434`), run against
an unmodified copy of `skills/plot/templates/plan.md`:

```
$ append_approved_line in.md out.md "2026-09-25, Probe, plan-PR #1"
exit=0

<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Approved:** 2026-09-25, Probe, plan-PR #1
-->
```

### 2. The parser cannot see it. CONFIRMED.

```
$ skills/plot/scripts/plot-plan-meta.sh out.md | jq -r .approved_raw
''
```

### 3. The blamed awk line. CONFIRMED, with a correction to the line number.

`plot-approve.sh:424` — the plan says `~:425`:

```awk
if (lines[i] ~ /^[ \t]*[-*][ \t]/) insert = i
```

The scan loop is `:421-425`; there is no `<!--` arm. `templates/plan.md:15-18` holds the block, and
lines 16-17 match that pattern exactly. The plan's reading of the mechanism is correct.

Note the plan's other line citation is also off: it calls the empty-slot rule `plot-approve.sh:422`;
it is **`:423`**. Cosmetic, but a plan quoting source should quote it right.

### 4. "No plan in docs/plans/2026-09-2*.md carries a commented record." TRUE — AND MISLEADING.

The stated sweep passes: 38 files in that glob, zero hits. But the conclusion drawn from it —
*"This estate never saw it … it fires on a first approval in a new repository and nowhere else"* —
is **false**. I swept `docs/plans/*.md` instead of the plan's narrow window:

```
docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md  | 4 records
docs/plans/2026-08-31-the-read-path-stops-spawning.md         | 4
docs/plans/2026-08-31-the-registry-supervises-its-agents.md   | 2
docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md     | 3
docs/plans/2026-09-01-a-third-connector-costs-one-adapter.md  | 2
docs/plans/2026-09-01-an-interrogation-records-itself.md      | 2
docs/plans/2026-09-03-the-board-says-slice.md                 | 3
docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md  | 6
docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md    | 6
docs/plans/2026-09-04-every-element-is-a-domain-concept.md    | 6

plans affected: 10        swallowed records: 38
hits inside the plan's own 2026-09-2* window: 0
```

Confirmed lost at the parser:

```
--- docs/plans/2026-09-04-every-element-is-a-domain-concept.md
  started_raw from parser: 0 records
  Started: lines on disk:  6
--- docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md
  started_raw from parser: 0 records
  Started: lines on disk:  6
```

The window the plan chose is the one period where the bug had already been fixed on the only writer
that had been firing. **The estate is the primary victim, not a hypothetical adopting repo.** This
inverts the plan's severity argument and its "worst place for it to hide" framing.

---

## DESIGN

### The B-trap argument is sound — and understated. NOT REFUTED.

`plot-plan-meta.sh:334`:

```awk
function strip_placeholder(s) { return (s ~ /^<!--/) ? "" : s }
```

It rejects a value that *starts with* `<!--`, and nothing else. An angle-bracket placeholder passes:

```
- **Approved:** <date>, <who>, <channel>
-> approved_raw: '<date>, <who>, <channel>'
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-> started_raw: ['<date>, <who>, <branch>   (one line per started branch)']
```

**Worse than the plan says.** The scalar fields are first-wins (`:859-861`). With a bare placeholder
above a real record, the placeholder *beats* it:

```
- **Approved:** <date>, <who>, <channel>
- **Approved:** 2026-09-25, P, in-session
-> approved_raw: '<date>, <who>, <channel>'
```

B does not merely trade an invisible record for a false one — it makes a correctly written record
unreadable. B is correctly rejected.

### Fix A is NOT complete, and the Open Question is a finding — a bigger one than the plan expects.

Three copies of the idiom:

```
skills/plot/scripts/plot-approve.sh:424   insert = i     — NO guard
skills/plot/scripts/plot-deliver.sh:332   insert = i     — HAS the guard
skills/plot/scripts/plot-disp*.sh:3067    insert = i     — NO guard
```

**`plot-deliver.sh` was already fixed**, `:329-331`:

```awk
# An HTML comment ends the writable region. Checked BEFORE the
# placeholder arms so a commented-out `- **Delivered:**` template line
# is never mistaken for the slot to fill.
if (lines[i] ~ /<!--/) break
```

Shipped as **`19b60430a plot-deliver: the record lands outside the template comment (#597)`, 2026-09-01**,
with a dedicated contract test at `test/reconcile/deliver-record-outside-comments.test.mjs` — six tests,
including the shipped-template round trip and the empty-placeholder arm the plan's "Done when" asks for.

Verified live: deliver on the shipped template puts the record above the comment and
`delivered_raw: '2026-09-25, Probe, x'`.

**That test file's own header describes the `Started:` records as what triggered the bug** — the fix
was applied to the writer that was diagnosed, and the two writers sharing the defect were never
touched. The plan is re-deriving from scratch a fix that exists, with a test that exists, without
citing either.

### The plan MISSES the third writer, which is the one doing the damage.

The plan names `plot-approve.sh` and `plot-deliver.sh` and `/plot-release`. The actual third copy is
**`append_started_line`** in the dispatch script (`:3026-3078`), and all 38 swallowed records on this
estate are `Started:` records. Reproduced against the shipped template (run from a non-interactive
script — this shell aliases `mv` to `mv -i`, which silently refuses the function's own `mv` and fakes
a pass):

```
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-25, Probe, `feature/x`
-->
-> started_raw: []
```

A plan naming `Delivered:` and `Released:` as the sibling scope, when the measured damage is entirely
`Started:`, will produce a fix that misses the population.

### `/plot-release` is not in scope, and the plan should say so.

`/plot-release` has no `append_*_line`. `skills/plot-release/SKILL.md:393-396` instructs an agent to
write the two lines into `## Status` by hand, then declare an unowned-state receipt. There is no awk
to guard. The plan's "A also fixes every other writer of that shape" is wrong for this one, and its
"Done when" bullet demanding `Released:` coverage cannot be satisfied by fix A.

### A third option exists, and the plan's preferred guard shape is the WRONG one. This is the substantive design finding.

The plan's rule is *"the awk tracks comment depth and skips those lines"* — i.e. **skip and continue**.
`plot-deliver.sh` instead does **`break`**: the comment ends the writable region. These differ, and
the plan does not notice there is a choice.

`break` is the blunt one. It puts the record above *any* comment in `## Status`, not after the last
live item. Twelve plans here have a comment before later live list items:

```
docs/plans/2026-08-23-a-draft-plan-claims-no-approvals.md
docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md
... (12 total)
```

Measured on `2026-09-01-an-interrogation-records-itself.md`, where `Released:` is the last live line:

```
--- DELIVER (break) ---
- **Released:** 2026-09-05, 2.13.0
- **Delivered:** 2026-09-25, P, x        <- correct here, by luck of ordering
<!-- Transition records ... -->
```

and on a synthetic plan with the comment *before* live items, `break` puts the record in the middle
of the live list rather than after it:

```
- **Type:** bug
- **Delivered:** 2026-09-25, P, x
<!-- a note
     that wraps -->
- **Review:** in-session
- **Impl:** own branches
```

The plan's own "Done when" bullet — *"A plan whose `## Status` contains a comment block **after** the
live list items still gets its record in the right place"* — is satisfied by `break`, but the
**converse** case (comment before live items, 12 plans here) is not, and the plan does not name it.
Depth-tracking with skip-and-continue handles both; `break` handles one. The plan should state which
it builds and why, because copying the existing guard verbatim is the obvious path and it is the
weaker one.

A fourth option the plan lists nowhere: **fix the reader instead** — have `plot-plan-meta.sh`'s
`strip_placeholder` reject `<...>` angle-bracket placeholders. That does not fix the writer and I do
not recommend it, but it is what would make the 38 already-damaged records readable without editing
ten plan files, and the plan's "What this does NOT do" asserts the parser is "right to ignore
commented content" without considering that the damage is already on disk.

### Unaddressed: the 38 existing records.

The plan fixes forward and says nothing about the ten plans already holding invisible records. Those
plans' `started_raw` is `[]` today. Whether that is repaired, reported by `plot-reconcile-scan.sh`, or
consciously left is a decision the plan should make, not omit.

---

## What must change (amend)

1. **Delete or rewrite "Why this estate never saw it."** Replace with the measurement: 10 plans, 38
   swallowed records, all `Started:`, all written before the deliver-side fix. Widen the sweep from
   `docs/plans/2026-09-2*.md` to `docs/plans/*.md` — the narrow window is what produced the wrong
   conclusion.
2. **Cite the prior art.** `plot-deliver.sh:329-331`, commit `19b60430a` (#597, 2026-09-01), and
   `test/reconcile/deliver-record-outside-comments.test.mjs`. The slice is *apply the existing guard
   to the two writers that missed it*, not *invent a guard*. That is a smaller, better-evidenced slice.
3. **Name `append_started_line` (dispatch script `:3026-3078`) as the primary target.** It is the
   third copy and the source of all measured damage. The plan currently does not mention it.
4. **Answer the Open Question in the plan body**: three copies, one already fixed, one is the real
   victim. Close the checkbox.
5. **Decide `break` vs depth-tracking explicitly**, with the 12-plan comment-before-live-items case as
   the evidence. If `break` is chosen for consistency with the shipped fix, say that and accept the
   placement; if depth-tracking is chosen, note it diverges from `plot-deliver.sh` and that the two
   should converge.
6. **Drop `/plot-release` from scope or reclassify it.** `skills/plot-release/SKILL.md:393-396` writes
   by hand; there is no awk. The "Done when" bullet demanding `Released:` coverage is unsatisfiable
   as written.
7. **Say what happens to the 38 existing records** — repair, report, or leave, with the reason.
8. Fix the two line citations: `:424` not `:425`, `:423` not `:422`.

## What is right and should not change

- The reproduction is honest and repeats exactly.
- A over B is correct, and the reason is stronger than stated (first-wins makes B actively destructive).
- "Do not change the template" is right for the same reason B is wrong.
- The "failure is silent in both directions" note in Notes is the correct framing, and the existing
  test file independently reached the same conclusion three weeks earlier.
