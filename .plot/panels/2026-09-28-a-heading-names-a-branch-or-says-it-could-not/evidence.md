Position: amend
Evidence: executed

# EVIDENCE lens — `a-heading-names-a-branch-or-says-it-could-not` (#1031)

## Summary

The plan's **defect** is real and its **fix** is sound — I reproduced both and ran the proposed regex over all 357 plans with zero collateral. The plan's **premise about the 12** is false, and the falsehood is self-inflicted: **2 of the 12 ARE the defect**, and the plan's own wave-1 fix removes them. The residual is **10**. Worse, the 12 hide a **second, distinct defect with identical symptoms** that the plan explicitly classifies as legitimate — `slice_shape` latching to `list` on a narrative first heading, losing **5 slices across 2 plans**. The plan's own discriminator catches it and the plan's Done-when instructs the implementer to assert it stays silent.

---

## 1. Reproduced — both halves of the central claim hold

Scratch files, real parser, `skills/plot/scripts/plot-plan-meta.sh`:

```
### A wave (Branch: `bug/backticked`)
  → "branches":[], "waves":[{"name":"A wave","branches":[]}]

### A wave (Branch: bug/backticked)        # unbackticked control
  → "branches":["bug/backticked"], waves carries the branch
```

Both halves confirmed exactly as the plan states. The mechanism is as cited:

- `plot-plan-meta.sh:927` — `slice_shape = (index($0, "(Branch:") > 0) ? "heading" : "list"` — a backticked heading **is** classified `heading`. The plan is right that classification is not the bug.
- `plot-plan-meta.sh:1295` — `match(hmeta, "Branch:[ \t]*(" PREFIXES ")/[^ \t,)]+")` — anchors the prefix after optional whitespace only. A backtick intervenes and nothing matches.
- The comment at `:1289-1294` says exactly what the plan quotes, verbatim.

**Every `file:line` citation in this plan checks out.** Given this author's measured habit, I went looking for a cited line with no caller and did not find one.

## 2. FALSE CENTRAL CLAIM — "12 plans carry a wave with zero branches legitimately"

Parsed all 357 plans (`plot-plan-meta.sh docs/plans/*.md`, 0.46s) and counted:

```
PLANS_WITH_EMPTY_WAVE=12   EMPTY_WAVES=30      # matches the plan's 12
```

Then I applied the plan's own wave-1 fix and recounted:

```
AFTER FIX: plans_with_empty_wave=10  empty_waves=24
```

**Two of the "12 legitimate" are the defect the plan is fixing** — `2026-09-26-a-parsed-plan-joins-the-index.md` (3 empty waves) and `2026-09-26-the-board-updates-an-index.md` (3 empty waves). Both are the very `Rejected` plans the Motivation section names two paragraphs earlier. The plan counted its own bug into its own control group.

The residual legitimate population, by name:

| plan | empty waves |
|---|---|
| `2026-07-25-opus5-longhorizon-hardening.md` | 3 |
| `2026-08-17-working-shows-the-agent.md` | 3 |
| `2026-08-20-a-mock-row-shows-what-the-tuple-still-gets-wrong.md` | 2 |
| `2026-08-20-a-wave-is-a-thing-not-a-label.md` | 4 |
| `2026-08-29-the-artifact-builds-the-same-everywhere.md` | 1 |
| `2026-08-30-the-pulse-is-an-entity.md` | 7 |
| `2026-08-30-two-monitors-watch-the-agent.md` | 1 |
| `2026-08-31-the-read-path-stops-spawning.md` | 1 |
| `2026-09-11-a-merge-without-a-changeset-is-named.md` | 1 |
| `2026-09-21-an-unasked-host-is-not-an-absent-pr.md` | 1 |

**10 plans, 24 waves.** The plan must say 10, and must say the number is measured *after* wave 1, or the implementer writes an assertion against a population that no longer exists the moment they fix the regex.

## 3. THE FINDING THE PLAN MISSED — a second defect inside the "legitimate" 12

`2026-08-30-the-pulse-is-an-entity.md` reports 7 empty waves. **Four of them carry a perfectly well-formed, unbackticked `(Branch: …)` heading** and still extract nothing:

```
### Freeing the word (Branch: feature/the-scan-reads-a-fleet-reading, PR: #600)  → 0 branches
### Naming (Branch: docs/the-pulse-has-a-design)                                 → 0 branches
### Ticking (Branch: feature/a-subscriber-names-its-divisor)                     → 0 branches
### Waiting (Branch: feature/an-agent-waits-instead-of-asking)                   → 0 branches
```

The plan's whole `branches: []` argument applies to these and the plan calls them "narrative waves in older plans".

**Root cause, isolated with a minimal pair.** `slice_shape` latches on the section's **first** `###` heading (`:926-928`) and is then fixed. `the-pulse-is-an-entity`'s Slices section opens at line 206 with `` ### `Pulse` already means something else … `` — no `(Branch:` — so the whole section routes to the **list** consumer, which never reads headings for branches.

```
### A narrative heading with no branch     ← first
### Real work (Branch: bug/real-work)
  → branches: []            # latched to "list"

### Real work (Branch: bug/real-work)      ← first
### A narrative heading with no branch
  → branches: ["bug/real-work"]   # latched to "heading"
```

Same file content, reordered. The patched parser gives the identical wrong answer — **wave 1 does not touch this.**

Blast radius, measured over all 357: **2 plans, 5 lost slices** — `the-pulse-is-an-entity` (4 of 7) and `opus5-longhorizon-hardening` (1 of 3, `### Recovered (Branch: infra/recover-opus5-hardening, PR: #423)`).

**This is the plan's own discriminator firing correctly on a real defect.** "A heading containing `Branch:` that yields no branch" describes these five exactly. So the Done-when line —

> **The 12 plans with legitimate empty waves are NOT reported** — asserted against a real one, by name

— is an instruction to **suppress a true positive**. If the implementer picks `the-pulse-is-an-entity` as the "real one" to assert silence against, they will write a test that pins the second defect shut.

## 4. VERIFIED — the regex change widens and narrows nothing

Patched a **copy** (`patched.sh`; real file never edited on disk except for the test run below, restored via `git checkout --` and verified clean):

```awk
if (match(hmeta, "Branch:[ \t]*`?(" PREFIXES ")/[^ \t,)`]+`?")) {
    b = substr(hmeta, RSTART, RLENGTH)
    sub(/^Branch:[ \t]*/, "", b)
    gsub(/`/, "", b)
```

Ran both versions over all 357 plans and diffed the JSONL:

```
DIFF LINES = 4   (2 changed records)
```

The only two records that move are the two defective plans, each gaining its 3 branches. **355 plans byte-identical.** The claim "widens what is accepted and narrows nothing" is **verified on the whole estate**, not asserted.

Test suites under the patch (patch confirmed present via `git diff --stat` before running — `cp` is aliased to `cp -i` here and silently refused the first attempt, which would have produced a false green):

```
test/reconcile/parser.test.mjs          106 pass  0 fail   (baseline: 106 pass)
test/reconcile/deliver-headings.test.mjs
+ impl-status-dialects.test.mjs           11 pass  0 fail
```

`test/reconcile/parser.test.mjs` is the home for the Done-when: 99 `test(` blocks, heading-dialect fixtures at `:1180`, `:1232`, `:1261`, and a differential test at the end that parses every real plan. **Both forms in one test is directly expressible there.** The Done-when is testable as written.

Also checked: `packages/board/plot-plan-meta.sh` is a byte-identical copy — **gitignored**, a packaging artifact listed in `packages/board/package.json:37`. Not a second source, not a finding.

## 5. THE COST QUESTION — the plan asks it and gets it wrong-ended

The plan frames `plot-reconcile-scan.sh` as risky because "the scan takes 21-37s and this adds per-plan work". Measured:

- **The scan already parses every plan exactly once.** `plot-reconcile-scan.sh:578` captures `plan_json` for the whole sweep, with a comment at `:573-577` saying precisely why a second call is refused. Sections 7 and 8 already read `waves[]` from it.
- Per-file re-read of headings: **2.19s** — a real 6-10% tax.
- One `grep -h '^### .*(Branch:' docs/plans/*.md`: **0.016s** — free.

So the cost objection dissolves, but a **contract gap** the plan does not name takes its place: **`waves[]` does not carry the raw heading.** `wname` strips the `(Branch: …)` parenthetical at `:1186` before the wave is recorded. Verified:

```
waves: [{"name":"The board updates an index","branches":[]}, …]   # parenthetical gone
```

The scan therefore **cannot** apply the discriminator from `plan_json` at all. The plan's "What the slice must decide" section floats emitting a field beside `waves` as the *cleaner* option; it is in fact the **only** option that keeps the scan single-parse and keeps the parser as the format contract. A `grep` in the scan would be the hand-rolled second parser that `a-plan-branch-can-be-a-parser-artifact` exists to forbid — and the scan's own comment at `:1890` says *"THE PARSER IS THE SOURCE, never a second grep."* The plan leaves this open as a judgement call when the estate's own rules have already decided it.

`plot-reconcile-scan.sh` **is** the right home otherwise: section 24 is next, the `== blocking sections end ==` marker convention is exactly as the plan describes (sections 20-23 all sit below it and say so), and an advisory counter costs nothing once the field exists.

## 6. What the plan must say before someone builds it

1. **"12" → "10", measured after wave 1.** Name the two that are the defect. As written, the control group contains the bug.
2. **Name the `slice_shape` latch defect and scope it.** Either fix it in this plan or state explicitly that it is out of scope and file it — but it **must not** be described as legitimate, because the Done-when then orders the implementer to assert silence on it. Concretely: the Done-when's "assert against a real one, by name" must name a plan that is **actually** legitimate (`a-wave-is-a-thing-not-a-label`, `two-monitors-watch-the-agent`) and must **not** name `the-pulse-is-an-entity` or `opus5-longhorizon-hardening`.
3. **Decide the field, don't defer it.** `waves[]` strips the parenthetical, so the scan cannot see it. Say the parser emits the unreadable heading, or the section cannot be built single-parse.
4. **State the measured diff.** "2 of 357 records change, 355 byte-identical" is the evidence for "narrows nothing" and belongs in Done-when as the assertion, not as a hope.

## 7. What executing revealed that reading would not

Reading gets you the defect, the mechanism, and the correctness of the regex — all three are accurately described.

Executing gets you three things reading cannot:

- **The 12 is self-contaminated.** Only counting before and after the fix shows the control group shrinking to 10. Reading the Motivation section, the "12" and the "two Rejected plans" sit four paragraphs apart and never meet.
- **The second defect.** It is invisible in the plan, invisible in the parser source (the latch at `:926` and the extraction at `:1295` are 370 lines apart), and only surfaces by listing which empty waves carry a `Branch:` heading — at which point `the-pulse-is-an-entity`'s four well-formed headings extracting nothing is impossible to miss. The minimal reordering pair proves the cause in two runs.
- **The contract gap.** `waves[]` stripping the parenthetical is a one-line `sub()` at `:1186` that reads as cosmetic. Only printing the actual JSON shows the scan has nothing to read, which converts the plan's open question into a settled one.

One more, procedural: the `cp -i` alias silently refused my first patch application and the suite ran green against the **unpatched** file. A reader trusting that run would have reported "tests pass under the patch" having never applied it.
