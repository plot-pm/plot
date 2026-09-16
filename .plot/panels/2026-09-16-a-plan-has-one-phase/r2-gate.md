# Gate lens, round 2 — a-plan-has-one-phase (#924)

Read at `origin/main`. Every claim below was checked by running the named code
on a fixture I built, or by reading the named line. What I ran is named.

## 1. The new claims are TRUE, and the gate fires on the reporter's case

**`plot-deliver.sh:98` parses before the write — TRUE.** `:98` is
`meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" …)`, feeding `phase=$(jfield '.phase')`
at `:105`. The second parse is `decide_transition`'s at `:385`, which runs
*before* `write_transition`. **Nothing re-reads after the write.** The last read
of the plan file in the whole script is `:385`; after `write_transition`'s `mv`
(`:443`) the file is never opened again — `:546` sets `phase_report` from the awk
exit status alone:

```
546:  phase_report=$([ "$flipped" = 1 ] && echo flipped || echo already)
```

That is the defect stated exactly: the report is a function of *the write having
been attempted*, never of *the file now reading as Delivered*.

**A refusal is the established shape — TRUE, emphatically.** 14 `die` sites and
7 further `return 1`-with-message sites. Three already carry the plan's exact
wording, *"refusing rather than guessing"* (`:99`, `:123`, `:172`). The proposed
gate is the same move on the same script, not a new idiom.

**The gate fires on the reporter's shape — VERIFIED by running it.** I built the
reporter's exact file (front matter `status: Approved` + `phase: Approved`, plus
a `## Status` block) and ran the script's own `flip_phase` awk on it:

| | `format` | `phase` | file's `State:` line |
|---|---|---|---|
| before write | `frontmatter` | `approved` | `Approved` |
| **after write** | `frontmatter` | **`approved`** | **`Delivered`** |

`flip_phase` returns 0 (it changed the file), so `flipped=1` and the script
prints `phase=flipped`. The parser goes on answering `approved`. **A post-write
re-parse asserting `.phase == delivered` fails here and passes on every plan in
this repository** — I ran the control too: a Status-block-only plan reports
`format: canonical` and its phase moves normally.

## 2. It is a genuine GATE by CLAUDE.md's own test

The test is *"Can you answer 'did I complete this?' without actually doing the
work?"*

- **Before:** yes, trivially. `phase_report` is computed from an awk exit code.
  The awk substituted a string in a scratch file; whether the value that string
  landed in is the one the estate reads is a question the script never asks.
  Everything downstream — the board, the scan, `/plot-release` — reads
  `plot-plan-meta.sh`, and the script's success criterion is not that reader.
- **After:** no. The only way to report `phase=flipped` is for the parser — the
  same reader every consumer uses — to answer `delivered` on the bytes on disk.
  The check is objectively verifiable (one parse, one string compare), not
  skippable (it sits between the write and the summary, on the single code path),
  and it fails loudly on the filed case.

**It is also the right KIND of gate for this estate.** `plot-state-gate.sh` and
`plot-phase-gate.sh` both gate *who may write*; this gates *whether the write
took*. That is a third question and nothing currently asks it.

One structural strength the plan understates: the check is **format-agnostic and
corpus-independent**. Zero of 290 plans here carry front matter, so this repo can
never exercise the bug — but it *can* exercise the gate, because the gate asserts
a property (`written value == parsed value`) that holds on all 287 plans with a
`State:` line. Round 1's strongest objection to the first draft — *"detection the
estate cannot exercise"* — does not transfer.

## 3. Walking the `Done when` as an implementer — and the idempotence clause is WRONG

I could build five of the six gates from the text. The sixth is not merely
unresolved; **it asserts a behaviour the script does not have.**

### The conflict is real, and the plan resolves it by assertion

The plan says: *"A second run today reports `already` on finding its own line;
with the gate it finds the mismatch and says so."* It presents this as restoring
idempotence.

**I traced the second run on the reporter's file and the plan's premise is false
at the step it names.** After run 1, the file carries `State: Delivered` *and* a
`Delivered:` record, while the parser still answers `approved`. Run 2:

- `plot-transition.mjs` is handed `phase=approved, delivered_raw="2026-09-16, jw"`
  and answers **`write`**, not `already`. I ran it:
  `Delivered → 2026-09-16, jw → write → yes`.
- The healthy control — a Status-block plan already Delivered — answers
  **`already`**. I ran that too.

So the domain never reaches `already` on a dual-format plan. The `already` the
ticket observes is produced **further downstream**, at `:546`: `write_transition`
runs `flip_phase`, which finds no `Approved` to substitute, returns 1,
`flipped=0`, and the summary prints `phase=already`. Two different code paths
produce the same word, and the plan attributes it to the wrong one.

**Why this matters for the gate rather than being trivia:** it tells the
implementer *where* the check must sit. Placed inside the `action = "already"`
branch of `apply_local_writes` (`:671`), the gate **never runs on the reporter's
file** — that branch is not taken on either run. It must sit after
`write_transition` returns, on the path both runs take. The `Done when` does not
say this, and the plan's own narrative points at the wrong branch.

Once placed correctly, the conflict with documented idempotence **dissolves, and
is not really a conflict.** The script's idempotence contract is *"re-running is
the repair for every interruption"* (`:30-33`) and *"each step asks the source it
would have written whether it is already done"* (`:35-38`). A gate that re-reads
the source and refuses on a mismatch is that contract applied one step further —
it refuses the case where the source does **not** say what was written. Refusing
an unrepairable file is not non-idempotent; it is the same refusal every run,
which is the definition. **But the plan asserts this rather than arguing it,** and
it argues it from a false premise about which component says `already`.

### The other five gates discriminate

- *re-parses and asserts* — discriminating: verified failing before, passing after.
- *names BOTH values and the file* — discriminating, and correctly reasoned; the
  estate's refusals already do this (`:120`, `:436-438`).
- *exit code is a refusal* — discriminating.
- *agreement is byte-identical to today* — discriminating, and the most important
  of the six: 287 plans depend on it.
- *no parser field changes* — discriminating and cheap.

### One count is wrong

`Done when` says *"all 289 plans"*; the prose table says 285 twice. Measured now:
**290 files, 287 with a `State:` line, 0 with front matter.** Round 1 flagged
285-vs-286 and the rewrite changed the number without re-measuring. Cosmetic, but
it is a gate's own number and it will not match the directory.

## 4. What `Done when` fails to pin

**The strongest gap — an implementation satisfying every gate that is still wrong:**
place the re-parse inside `write_transition` **before** the `mv`, reading the
scratch file `$a` rather than the plan file. Every listed gate passes — it
re-parses, it can name both values, it refuses, agreement is byte-identical, no
parser field changes, contracts pass — and on the reporter's file it still
refuses correctly, because `$a` parses the same way. But it has silently changed
the failure semantics: the gate now refuses *before* the write lands, leaving the
file untouched, where a post-`mv` gate refuses *after*. Which of those the estate
wants is a real decision (the script's whole `write_transition` design is
"replace the file by one `mv`, or not at all"), and nothing in `Done when`
chooses. **Pin the read as the plan file after the `mv`, or pin it before, but pin it.**

Three smaller ones:

- **The receipt.** `record_state_receipt "$f" "Delivered"` fires at `:548`, after
  the `mv`. If the gate refuses after that line, a receipt is left unspent
  licensing a commit of a state the script just refused. If it refuses before,
  no receipt exists. Unpinned, and it touches `plot-state-gate.sh`.
- **Which phase word.** The gate asserts "the phase the parser reports" — against
  what? The domain's returned `Delivered`, or the literal `delivered`? The parser
  normalises; `decide_transition` returns the capitalised form. A case-sensitive
  compare fails on every plan.
- **The `already` path.** `apply_local_writes:671` sets `phase_report="already"`
  without writing. Does the gate run there? On a genuinely-already-delivered
  dual-format plan it would refuse a run that is correctly doing nothing.

## 5. Strongest argument against doing this at all

**It gates the symptom's reporting while the delivery still does not work, and it
ships under a ticket whose first complaint is that the delivery fails.**

After this lands, the reporter's `/plot-deliver` refuses loudly instead of
succeeding falsely. Their plan is still not delivered. Their `Delivered:` record
is still absent, so `plot-fleet-scan.sh` still drops the plan from its window.
They still reach for `plot-state-receipt.sh --unowned`, which the ticket calls
out as the wrong escape. The change converts a silent failure into a loud one —
genuinely better, and the estate's own philosophy — but #924 is closeable against
it while the delivery remains broken.

**Why I do not think this defeats it.** A loud refusal naming both values is
exactly what tells that reporter *what to fix in their file* — which the silent
success never did, and which no amount of parser reporting would have surfaced at
the moment they were looking. And unlike the first draft, this one is not inert:
it fires on the single code path every delivery takes, in a repo that can
regression-test it on 287 real plans. The remaining gap is honestly scoped in
*"Not in this slice"* — though that section names only `/plot-approve` and
`/plot-undeliver`, and **not** the format question that actually blocks the
reporter. That omission is the residue of round 1's finding, and it should be
named where a reader will see it.

## Assessment

The rewrite is sound in kind. It replaces a rule with a gate, on the right
script, at the right seam, catching the filed case — which I reproduced — and it
is exercisable by this estate where the first draft was not. The reasoning about
*why* it is a gate is correct by CLAUDE.md's own test.

Three things must be fixed before an implementer can build exactly this, and one
of them is a factual error the plan rests an argument on:

1. **The idempotence claim is wrong about its own mechanism.** The domain answers
   `write`, not `already`, on the reporter's file; the `already` comes from
   `flip_phase` returning 1 at `:546`. Correct it, and state where the gate sits
   — after `write_transition` returns, on the path both runs take. As written it
   points an implementer at a branch the reporter's file never enters.
2. **Pin the read: the plan file after the `mv`, or the scratch file before it.**
   Both satisfy every listed gate and they differ in whether a refused delivery
   leaves the file written. Name the receipt's fate with it.
3. **Re-measure the count.** 290 files, 287 with a `State:` line, 0 front matter.

Worth adding: the comparison is normalised-vs-normalised, and the `already`
branch at `:671` is explicitly in or out.

None of these is a reason to abandon the approach. They are the difference
between a plan an implementer can build and one where the review will not know
which of two correct-looking implementations was intended.

Verdict: amend
