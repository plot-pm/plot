# Contracts lens — a-broken-caller-is-not-a-hedging-juror

Position: amend

**Evidence: executed.** Every claim below was run against the shipped bundle `skills/plot/scripts/board/plot-panel.mjs`, not read off the source.

## The defect is real and the diagnosis is exact

Reproduced verbatim:

```
printf 'Position: amend\n' | plot-panel.mjs check Position 'proceed|amend|reject' contracts
  → rc=3  uncommitted  'amend' is not one of proceed|amend|reject
printf 'Position: amend\n' | plot-panel.mjs check Position 'proceed,amend,reject' contracts
  → rc=0  committed  amend
```

The cause is `entry/panel.ts:139` (`positions: positions.split(',')`) with the guard at `:133` testing only non-emptiness. The teaching collision at `rules/panel.ts:90-91` (`commitment.positions.join('|')`) is real: the refusal message printed above literally reads `Position: <proceed|amend|reject>`, which is the argument that breaks it.

## Caller survey — no breaking change, confirmed

Every invocation of `check` in the estate, and its separator:

| caller | line | separator |
|---|---|---|
| `/plot-panel` step 3 | `skills/plot-panel/SKILL.md:128` | `"$POSITIONS"` — variable, caller-supplied |
| `/plot-deliver` step 5 | `skills/plot-deliver/SKILL.md:318` | `"supported,refuted"` — **comma** |
| `/plot-deliver` step 5 | `skills/plot-deliver/SKILL.md:319` | `"executed,read"` — **comma** |
| `plot-panel/README.md` testing | `:99`, `:101` | `proceed,amend,reject` — **comma** |
| `entry/panel.ts` docstring | `:19` | `proceed,amend,reject` — **comma** |
| `entry/panel.ts` usage line | `:135` | `<a,b,c>` — **comma** |
| `packages/domain/test/panel.test.ts` | `:24`, `:27` | arrays, no CLI parse |

`/challenge-the-plan` and `/plot-deliver` both display the vocabulary as `proceed | amend | reject` in *prose* (`challenge-the-plan/SKILL.md:225`, `plot-deliver/SKILL.md:267`) but pass **commas** on the command line. **Nothing in the estate passes pipes.** No caller moves from exit 3 to exit 2; the change breaks nobody real. Two of the plan's three "Done when" bullets are therefore free.

## The plan contradicts no documentation

`skills/plot-panel/SKILL.md:132` states exit 2's meaning in the plan's own words:

> Exit `0` is a commitment and prints `committed\t<lens>\t<position>`. Exit `3` is a refusal naming what is wrong. **Exit `2` means the arguments were unusable — a broken caller, not a hedging juror.**

Matched by `entry/panel.ts:44` (*"The arguments were unusable — a broken caller, not a hedging juror"*), `plot-deliver/SKILL.md:322`, `challenge-the-plan/SKILL.md:235`, and both briefs. The plan is correct that the contract already covers this case and is simply not reached — it widens no contract and changes no documented meaning. Nothing needs rewording.

## Scope: `reconcile` is correctly excluded

`reconcile` takes **no positions argument** — `entry/panel.ts:126-130` reads only stdin, and `readingsFrom` (`:71-89`) parses `<read>\t<lens>\t<detail>` tab-separated. Positions never cross that boundary. The plan's exclusion at line 69 is right, and the scope is not too narrow on that axis.

## The comma-is-the-wrong-hill challenge fails — and the plan should say why

I tested whether a legitimate position word could contain a comma. It cannot, and the reason is upstream of the CLI:

`rules/panel.ts:150` — `const [word] = c.split(/\s/)` — takes the **first whitespace-delimited word** of the claimed line. A position is therefore already constrained to a single whitespace-free token. Measured:

```
  $ Position: yes,really   against vocabulary 'yes,really'  → rc=3 (unreachable — split(',') destroys it)
  $ Position: a|b          against vocabulary 'a|b,c'       → rc=0 (a PIPE inside a position works TODAY)
```

So comma is the *only* character a position can never contain, and pipe is a character it demonstrably can. Comma is the correct separator, and the plan picked the right hill — but it argues the point from principle (*"a word may legitimately contain characters a second separator would split"*, line 63) when a one-line measurement settles it. **Add the measurement**: accepting pipes as a second separator would break the currently-working `a|b` case, which is a concrete regression rather than an abstract ambiguity.

## The amendment: the rule as written misses the neighbouring defect

The plan's validation is *"fewer than two positions, or a `|` inside one"* (line 82). I measured a third form that passes both tests and fails identically:

```
printf 'Position: proceed\n' | check Position 'proceed, amend, reject' contracts  → rc=0  committed
printf 'Position: amend\n'   | check Position 'proceed, amend, reject' contracts  → rc=3  uncommitted
```

`'proceed, amend, reject'.split(',')` yields `['proceed', ' amend', ' reject']` — **three** elements, no pipe. It passes the plan's validation untouched. The vocabulary is silently corrupted: the first position works, every other one has a leading space and can never match. The refusal message renders as `Position: <proceed| amend| reject>`.

This is strictly worse than the pipe case the plan fixes. The pipe form fails *every* juror, so the panel is uniformly wrong and a person notices. Comma-space fails only jurors who did not pick the first word — so a panel comes back **partially** committed and reads as a genuine split. That is the plan's own motivation (`a broken caller reported as a hedge`) in its most dangerous form, and the proposed rule lets it through.

`proceed, amend, reject` is exactly how the vocabulary is written in English prose, in `challenge-the-plan/SKILL.md:225` and `plot-deliver/SKILL.md:267`. The same *"the tool teaches the wrong input"* argument the plan makes for pipes applies to spaces with equal force.

**The fix is one line and the plan's own framing supports it:** trim each position after splitting, and refuse an empty one. Better still, state the rule positively — a position must be a non-empty token containing no whitespace and no `|` — which catches the pipe form, the single-word form, the comma-space form, and the space-separated form (`'proceed amend reject'`, also measured at rc=3 today) in one predicate, rather than enumerating two shapes and leaving two more.

## The single-position refusal is safe

Today a one-word vocabulary is accepted:

```
printf 'Position: supported\n' | check Position 'supported' contracts  → rc=0  committed
```

Nothing in the estate does this. Every vocabulary is binary or ternary: `proceed,amend,reject`, `supported,refuted`, `executed,read` (`panel.test.ts:24,27`). A one-option commitment is unfalsifiable — the juror cannot dissent — which is the same reasoning `readPanel` already applies at `rules/panel.ts:205-207`, where a panel of zero jurors is refused rather than reported `unanimous`. The rule is consistent with the mechanism's existing stance and breaks no caller.

## Two small contract notes

- **`commitmentLine` stays as it is, correctly.** The plan's decision at line 67 is right: `<a|b|c>` is conventional choice notation in a human-facing message, and it is also the *rendering* the README and both caller skills use in prose. Changing it would desynchronise four documents to fix a CLI parse. The usage line showing the comma form (`entry/panel.ts:135` already reads `<a,b,c>`) is the correct half to strengthen — note that the usage line is only printed when an argument is **missing**, never when one is malformed, so slice 1 must print it on the new refusal path too or the fix does not reach the caller who needs it.
- **Exit 3 is untouched**, confirmed: the genuine-hedge path (`no 'Position:' line`) still exits 3 under the comma form. The plan's stated regression guard is the right one.

## What would move me to proceed

Widen slice 1's predicate from *"fewer than two, or a `|` inside one"* to *"each position must be a non-empty token with no whitespace and no `|`"*, and add the comma-space case to the slice's unit tests. That is the same slice, one changed condition, and it closes the variant that produces a partially-committed panel — the failure mode the plan exists to prevent.
