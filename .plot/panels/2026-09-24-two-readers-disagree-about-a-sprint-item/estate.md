# Estate lens — two-readers-disagree-about-a-sprint-item

Position: amend

Every load-bearing claim in the plan verified true, including the dedup trap's
exact numbers. The amendment is scope: the plan's own Open Question has an
answer, and the answer is a THIRD reader the single slice does not name.

## What I ran, and what came back

### The defect reproduces exactly as measured

Scratch sprint at `<scratchpad>/sprints/2026-W99-bare.md`, `### Must Have` with
two bare items and a `### Should Have` with one.

```
$ bash skills/plot/scripts/plot-sprint-state.sh bare Committed --dir <scratch>/sprints
plot-sprint-state: sprint 'bare' names no Must — only a Must is a promise, so
committing would record a commitment that does not exist.
exit=1
```

Release reader on the same file (run from a scratch repo whose `## Plot Config`
names the scratch sprint dir, because the script takes `SPRINT_DIR` from config
and has no `--dir`):

```
$ bash skills/plot/scripts/plot-sprint-release.sh bare
{"sprints":[{"sprint":"bare","phase":"Planning","release":"9.9.9",
"must":[{"slug":"","text":"rename the deploy step","checked":false,"delivered":"none","state":"open"},
        {"slug":"","text":"update the runbook","checked":false,"delivered":"none","state":"open"}],
"should":[{"slug":"","text":"tidy the changelog",...,"state":"open"}],"could":[]}],...}
exit=0
```

**2 open Musts against a refusal saying none.** The plan's table is right.

### `MEMBER_LINE`, and the mandatory bracket

`packages/board/src/server/entry/sprint-transition.ts:64`:

```js
const MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]\s*(.*)$/;
```

Confirmed verbatim, and the second `\[([^\]]+)\]` carries no `?` — mandatory.
`itemsFrom` at `:88-106`: tier from `TIER_HEADINGS` (`:51`) set by the heading
(`:93-96`), `if (!m) continue` at `:99`, dedup `const plan = m[2].trim();
if (seen.has(plan)) continue;` at `:100-101`. All as the plan states.

### The release reader accepts a bare item — read AND run

`skills/plot/scripts/plot-sprint-release.sh:234-238` matches the checkbox alone
in a `case`, and `:250` is `if [ -n "$slug" ]; then delivered=$(plan_delivery
"$slug"); else delivered=none; fi`. The run above proves it: both bare items
came back with `"slug":""` and `"state":"open"` rather than being dropped.

### The dedup trap — the plan's numbers are exact

`<scratchpad>/dedup.mjs`, both regexes over the same three lines (two bare, one
linked):

```
as shipped                        : 1 of 3 [{"plan":"some-slug",...}]
bracket optional, dedup unchanged : 2 of 3 [{"plan":""},{"plan":"some-slug"}]
eight bare Musts, optional bracket: 1 of 8
```

**1 of 3, then 2 of 3, and eight bare Musts collapse to one.** Exactly the
plan's table and exactly its "sprint of eight bare Musts becomes one item".
The trap is real and the naive fix does hide it: with 2 of 3 the sprint commits,
so a test asserting only "it commits" passes over a parser still eating items.
The plan's "the all-bare test must assert the count" is the right gate.

### The obvious fix does not break the prose tests

`(?: \[([^\]]+)\])?` over the four shapes:

```
"- **Renaming Endgame.** moved out" -> null        <- still not an item
"- [ ] [p] slice one"               -> [" ","p","slice one"]
"- [ ] bare item"                   -> [" ",null,"bare item"]
"- [x] bare ticked"                 -> ["x",null,"bare ticked"]
```

Both prose-Deferred tests (`sprint-transition.test.ts:161`,
`sprint-members.test.ts:91`) use a bullet with NO checkbox, so they survive.
Note `m[2]` becomes `undefined` rather than `''` — the fix must coalesce, or
`.trim()` throws.

### Existing tests for a bare item: NONE

`packages/board/test/unit/sprint-transition.test.ts` has 8 `itemsFrom` cases
(`:139-163`) and `sprint-members.test.ts` has 7 member cases (`:23-126`).
`grep` for a bare `- [ ] <text>` in either returns nothing; every fixture is
`- [ ] [slug] …`. `sprint-members.test.ts:45` even filters the real W35 file
with `/^- \[[ x]\] \[/` — the bracket baked into the test's own oracle. The
shape is untested on both sides. Corpus dir holds 11 files, none pairing the
item readers; `sprint-score.corpus.test.ts` pairs `scoreItem` vs `item_state`,
one level below this.

## The amendment: the Open Question is answered, and it changes the slice

The plan asks (`:117`) whether the board's sprint membership shares the parser.
**It does not share it — it has a SECOND, INDEPENDENT COPY with the same
defect:**

- `packages/board/src/server/board.ts:1148`
  `const SPRINT_MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]/;`
- `parseSprintMembers` at `:1161-1181` — its own `SPRINT_TIER_HEADINGS`
  (`:1136`), its own `seen` set keyed on `m[2].trim()` (`:1174-1176`), called
  from `:1286`.

So the blast radius is **three readers, not two**, and the two broken ones are
two files with two hand-copied regexes — which is why fixing one leaves the
other. A bare item is invisible on the board today: it is dropped from
`members`, so sprint counts, `sprintMembership` and the sprint chips all omit
it. That is the plan's own predicted consequence, now measured.

The plan's Changelog already says "the board reads sprint membership and its
counts come from the same tier reading; a shape one reader drops is a shape the
board can drop" — correct, but the single slice (`:130`) names only
`entry/sprint-transition.ts:64` and `itemsFrom`'s dedup. **As written, the slice
lands, the commit gate agrees with the shell, and the board still drops the
item** — with the corpus test green, because it pairs the shell against
`itemsFrom` and never asks `parseSprintMembers`.

**Amend the slice to name `board.ts:1148`/`parseSprintMembers` as well**, and
either extract one reader both call or declare the duplication the way
`docs/shell-and-domain.md` requires. Two copies of one regex in one package is
undeclared duplication already; the fix should not leave three.

## Two smaller notes, neither blocking

- `sprintMembers` (`entities/sprint.ts:150-152`) already filters
  `slug !== ''`, so bare items entering `Sprint.items` do not leak empty slugs
  into plan-slug consumers. The fix is safe there; worth saying in the plan,
  since it is the obvious place a reviewer would fear a regression.
- Whatever the new dedup key is, it must not be `text`: two genuinely identical
  bare lines are a duplicate a person wrote, and collapsing them silently
  reproduces this defect in miniature. Line index, or "plan where there is one
  and never dedup otherwise", both avoid it — the plan says "the line's own
  identity" without choosing, and the slice should choose.

## Against the Done-when list

- All-bare sprint commits + a unit test pinning the COUNT — right, and the
  count assertion is load-bearing per the 2-of-3 measurement above.
- Empty `### Must Have` still refused — `transitions/sprint.ts:259-266` gates on
  `sprint.items.some(isPromised)`, unaffected by the regex; a test is cheap.
- Corpus pair that fails rather than being adjusted — correct, and it should
  cover all three readers given the finding above.
- #966's message accuracy — the refusal sentence at `:264` is correct for a
  genuinely empty Must; no change needed once bare items parse.
