# A broken caller is not a hedging juror

> `plot-panel.mjs check` given its positions as `proceed|amend|reject` reports every juror as uncommitted and blames them for it. The separator it parses is a comma; the separator it *prints* is a pipe. A caller who copied the tool's own output gets a panel that reads as unanimously hedging.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #965
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Started:** 2026-09-24, Jan Wloka, `bug/the-check-refuses-an-unusable-vocabulary`

## Changelog

- `plot-panel.mjs check` refuses an unusable positions argument with exit 2 instead of reporting its jurors as hedging. Measured 2026-09-24: `check "Position" "proceed|amend|reject" j` over a verdict file reading `Position: amend` exits 3 with *"'amend' is not one of proceed|amend|reject"*, while the same file with `proceed,amend,reject` exits 0 and commits.

Board impact: none. `plot-panel.mjs` is the panel mechanism's own bundle.

## Motivation

**Exit 3 means a juror hedged, and the skill acts on it.** `/plot-panel` step 4 sends a refused juror back to read again. With a `|`-separated argument every juror refuses, so the skill re-asks a panel that committed perfectly the first time — and the second run fails identically, because nothing about the jurors was ever wrong.

**The two codes exist precisely to keep these apart.** The bundle's own comment at `entry/panel.ts:141`:

> THE REFUSAL GETS ITS OWN CODE. A caller reading only `$?` must not be able to treat a hedge as a verdict.

A broken caller reported as a hedge is the same confusion in the other direction.

## Design

### What was measured, 2026-09-24

One verdict file containing `Position: amend`:

```
check "Position" "proceed|amend|reject" j   → rc=3  uncommitted  'amend' is not one of proceed|amend|reject
check "Position" "proceed,amend,reject" j   → rc=0  committed    amend
```

### The cause, and why the caller is not careless

`entry/panel.ts:139` — `positions: positions.split(',')`.

`"proceed|amend|reject".split(',')` yields **one** element: the whole string, pipes included. The guard above it at `:133` tests only that each argument is non-empty, so a one-element vocabulary whose single word is `proceed|amend|reject` is structurally valid and semantically nonsense. Every real verdict then fails to match it.

**And the tool prints that form itself.** `rules/panel.ts:90`:

```ts
export const commitmentLine = (commitment: Commitment): string =>
  `${commitment.label}: <${commitment.positions.join('|')}>`;
```

So the error a caller sees is *"must write `Position: <proceed|amend|reject>`"* — pipes — and the skill's own prose uses the same notation. **The caller copied the shape the tool renders.** This is a tool teaching the wrong input, not a user mistake, and a fix that only rejects pipes leaves that teaching in place.

### A worse shape, found by two jurors independently

**`"proceed, amend, reject"` — the natural way to type a list — is a SILENT PARTIAL failure**, and the plan's first draft caught neither it nor anything like it.

Measured 2026-09-24:

```
positions "proceed, amend, reject"     split → ['proceed', ' amend', ' reject']

  juror writes 'proceed'  → rc=0  committed
  juror writes 'amend'    → rc=3  uncommitted  ('amend' is not one of proceed,  amend,  reject)
```

Only the first entry lacks a leading space, so **some jurors commit and others are refused.** The pipe case fails everyone loudly and is recognisable; this one produces a panel that looks legitimately split. **A divided verdict manufactured by an argument typo** is worse than a unanimous refusal, because a moderator reconciles it as a real disagreement.

The draft's rule — fewer than two positions, or a `|` inside one — catches neither: this yields three positions and contains no pipe.

### The shape of the fix

Three halves now, and the middle one is the important one:

1. **Refuse an unusable vocabulary with exit 2.** Fewer than two positions cannot be a vocabulary, and a `|` inside a position is the measured mistake. Exit 2 is documented as *a broken caller, not a hedging juror*, so the contract already covers this; it is simply not reached.

2. **Trim each position, and refuse one that was not already trimmed.** Trimming alone would accept the typo silently and change behaviour invisibly; refusing names the caller's error while the edit is still one character. **A position is caller-supplied text and whitespace inside it is never meaningful.**

3. **Say what was wrong and what to type.** The refusal names the separator, because the caller's next action is a one-character edit.

### Why not accept pipes as well

Tempting and wrong. A vocabulary is caller-supplied text, and a word may legitimately contain characters a second separator would split. **Accepting both makes the parse ambiguous to remove an error message**, and the estate's rule for this is the panel's own: refuse and name the repair. The comma stays the one separator.

### What this does NOT do

- **It does not change `commitmentLine`'s rendering.** `<a|b|c>` is the conventional notation for a choice in a message a human reads, and it is correct there. The plan records the collision and leaves the rendering alone — if that judgement is wrong, the alternative is a usage line that shows the comma form explicitly, which slice 1 adds anyway.
- **It does not change exit 3.** A juror that genuinely hedged still exits 3, and the skill still re-asks it.
- **It does not touch `readPanel` or `reconcile`.** The defect is in the `check` verb's argument handling.

### Done when

- `check` with a `|`-separated positions list exits **2**, names the separator, and reports no juror.
- A single-word positions argument exits 2 — a commitment with one option is not a commitment.
- **`"proceed, amend, reject"` exits 2 rather than committing some jurors and refusing others.** This is the regression the first draft would have shipped, and its test asserts the partial case explicitly: two verdict files, two different positions, one exit code.
- **A comma-separated list still behaves exactly as today**, including exit 3 for a real hedge. The regression this must not cause.
- The usage line shows the comma form, so the message a broken caller reads contains the fix.

## Slices

### The check refuses a vocabulary it cannot use (Branch: bug/the-check-refuses-an-unusable-vocabulary)

- `bug/the-check-refuses-an-unusable-vocabulary` — validate the positions argument before building the `Commitment`: fewer than two positions, a `|` inside one, or a position carrying surrounding whitespace, exits 2 naming the separator; unit tests for the pipe form, the single-word form, the **whitespace form asserted as a partial-commit regression**, and the unchanged comma path including a genuine hedge → #984

## Notes

- Found by the issue's reporter and reproduced here in two commands. **It is reachable from this repository**, unlike #968 and #969 — the panel run earlier today used the comma form and passed, which is why eight jurors committed and nothing looked wrong.
- The deeper finding is the notation collision: `commitmentLine` joins with `|` and the CLI splits on `,`. Neither is wrong alone, and together they teach a caller to type what the tool refuses.
- **Panelled 2026-09-24: `unanimous amend`.** Both jurors independently found the whitespace form, which the draft's validation rule missed entirely. The contracts lens separately confirmed the plan breaks no caller (all pass commas), contradicts no documentation, scopes `reconcile` correctly (it takes no positions argument), and picks the right separator — a position can never contain a comma, while a pipe inside one works today.
