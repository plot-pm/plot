# Correctness under replacement

Position: amend

Lens: this plan replaces a function three report sections depend on. I looked for an
input where the proposed replacement answers differently from the current code. I found
one that is not hypothetical, plus two secondary divergences and one set of counts in the
plan that does not match the estate it was measured on.

## The finding: `*.md` is a filter, and `ls -l` is not

`symlinked_from` enumerates `for l in "$1"/*.md`. Every link whose NAME does not end
`.md` is invisible to it, whatever it points at. `ls -l` enumerates the whole directory
and applies no such filter. The plan's replacement section quotes one `ls -l` line and
never states the filter, and the Done-when does not mention it — so the obvious
implementation is wrong in a way the stated acceptance criteria cannot catch.

Fixture: one plan, two links to it, neither named `*.md`.

```
$ ls -l
lrwxr-xr-x@ 1 jwloka  wheel  22 Sep 17 20:19 alpha -> ../2026-01-01-alpha.md
lrwxr-xr-x@ 1 jwloka  wheel  22 Sep 17 20:19 alpha.md.bak -> ../2026-01-01-alpha.md
```

Both implementations asked for `2026-01-01-alpha.md`:

```
CURRENT: ''
ls -l index:
  first-match name='alpha'
  first-match name='alpha.md.bak'
```

The current code answers **not linked**. An `ls -l` index answers **linked, at `alpha`**.
That is a different answer, and it propagates to all three consumers:

- **Section 9** (`index_out`, line 777): current prints `no symlink in .../active/ or
  .../delivered/ (browsing only)` and increments `n_idx`; the replacement prints nothing.
  One `index_drift=` count changes.
- **Section 1** (`drift_out`, 796-819): the guard at 776 is `[ -z "$in_active" ] && [ -z
  "$in_delivered" ]` with a `continue`. Under current code the plan exits the loop body
  there and reaches no drift case at all. Under the replacement it falls through, and if
  the phase is `delivered` while the stray link sits in `active/`, it prints a NEW drift
  finding with `fix: git rm .../active/alpha && ln -s ...`, naming a path that is not a
  plan index entry. A drift row appears that did not exist.
- **Section 5** is not fed by `symlinked_from` at all (see below), so it does not change —
  but the plan asserts it is one of "the three answers this function feeds", which is wrong.

This is reachable on this estate. `docs/plans/active/` already contains a non-`.md` entry:

```
$ ls -A docs/plans/active | grep -v '\.md$'
.omc
```

It is a directory, not a link, so it changes nothing today. It demonstrates that the index
directories are not curated to `*.md`, which is the assumption the replacement silently adopts.

**Amendment:** the replacement must filter to names ending `.md`, and the Done-when must
say so. `ls -l "$dir"/*.md` does that and stays one fork; a bare `ls -l "$dir"` does not.

## Section 5 is not a consumer, and the plan says it is

The plan's "What this must not change" claims `:712-713` decide "section 5's dangling-link
attention finding". It does not. Section 5's dangling finding is an independent loop at
:844-853:

```bash
for _idx_dir in "$ACTIVE_DIR" "$DELIVERED_DIR"; do
  [ -d "$_idx_dir" ] || continue
  for _l in "$_idx_dir"/*.md; do
    [ -L "$_l" ] || continue
    [ -e "$_l" ] && continue   # resolves — not our case
```

It reads the directories directly and never calls `symlinked_from`. It runs after the plan
loop and is unaffected by anything this plan changes. Two consequences:

1. The plan's claim that three sections must be byte-identical overstates the blast radius
   in one direction and understates the work in another — this loop is a **fourth** per-run
   directory walk over the same two directories, forking `readlink` again, and a plan
   titled *the index is read once* leaves it in place. The one-pass index could serve it.
2. The Done-when clause "a dangling link ... is still reported, since `ls -l` shows it and
   `[ -L ]` accepted it" attributes the dangling report to the wrong code. Dangling links
   are reported by :844 regardless of what happens to `symlinked_from`.

I verified `ls -l` does list a dangling link, so the clause's premise is true even though
its attribution is not:

```
$ ls -l dangling.md
lrwxr-xr-x@ 1 jwloka  wheel  28 Sep 17 20:16 dangling.md -> ../2026-01-01-nonexistent.md
$ find . -type l | grep dangling
./dangling.md
```

Both list it. That edge case is safe either way.

## Secondary: a link name containing ` -> ` breaks any positional parse

`ls -l` separates name from target with the literal string ` -> `, which is also legal
inside a filename:

```
$ ls -l 'a -> b.md'
lrwxr-xr-x@ 1 jwloka  wheel  22 Sep 17 20:17 a -> b.md -> ../2026-01-01-alpha.md
```

`${line% -> *}` takes the last separator and `${line#* -> }` takes the first; neither is
right here. A name with a plain space also breaks a whitespace-field parse — measured, my
first harness returned `name.md` for a link called `weird name.md`:

```
DIFF  2026-01-01-eta.md  cur=.../active/weird name.md  new=.../active/name.md
```

Section 1 prints that name into a `git rm` command, so a wrong parse emits a wrong
remediation. No such name exists on this estate today (`ls docs/plans/{active,delivered} |
grep ' '` is empty), so this is a robustness point rather than a live defect. It argues for
`find -print0` + `readlink` batched, or a `%N -> %Y`-style stat, over parsing `ls -l`.

## Secondary: an absent index directory

`ls -l` on a missing directory writes to stderr and exits 1, where the current function is
silent:

```
--- CURRENT against ABSENT dir ---
result='[]' rc=0
--- ls -l against ABSENT dir ---
ls: .../idx/absent: No such file or directory
ls rc=1
--- ls -l stderr suppressed, absent dir ---
out='[]'
```

The Done-when names this case, so it is anticipated. `2>/dev/null` covers it. Noting it
only because `set -uo pipefail` is in force at :229 and a `while ... < <(ls ...)` needs the
redirect on the `ls`, not on the loop.

## Two links to one plan: current returns glob-first, and the estate has three such pairs

`symlinked_from` returns the FIRST glob match and stops. Any index must therefore reproduce
"first in glob order" rather than "last writer wins". This estate has three duplicate-target
pairs:

```
docs/plans/delivered	2026-09-01-a-refused-dispatch-asks-for-a-brief.md	.../2026-09-01-a-refused-dispatch-asks-for-a-brief.md
docs/plans/delivered	2026-09-01-a-refused-dispatch-asks-for-a-brief.md	.../a-refused-dispatch-asks-for-a-brief.md
---
docs/plans/delivered	2026-09-01-an-idle-agent-is-not-a-stalled-one.md	.../2026-09-01-an-idle-agent-is-not-a-stalled-one.md
docs/plans/delivered	2026-09-01-an-idle-agent-is-not-a-stalled-one.md	.../an-idle-agent-is-not-a-stalled-one.md
---
docs/plans/delivered	2026-09-03-the-board-says-slice.md	.../2026-09-03-the-board-says-slice.md
docs/plans/delivered	2026-09-03-the-board-says-slice.md	.../the-board-says-slice.md
```

I checked whether glob order and `ls -l` order agree on them. They do — both are
lexicographic under this locale, and the dated name sorts first in each pair:

```
=== GLOB order ===
docs/plans/delivered/2026-09-03-the-board-says-slice.md
docs/plans/delivered/the-board-says-slice.md
=== ls -l order ===
... 2026-09-03-the-board-says-slice.md -> ../2026-09-03-the-board-says-slice.md
... the-board-says-slice.md -> ../2026-09-03-the-board-says-slice.md
```

So this does not diverge today. It diverges the moment the index is built with "last wins"
instead of "first wins" — `IDX[$target]="$link"` unconditionally, rather than
`[ -n "${IDX[$target]:-}" ] || IDX[$target]="$link"`. Three plans on this estate would then
print a different link path in section 1's `fix:` command. The Done-when's byte-identity
diff would catch it only if those three plans are also in drift; all three are `delivered`
with links in `delivered/`, so they are NOT in drift and the diff would pass while the
index is wrong. **Amendment:** state first-wins explicitly.

## The plan's measured counts do not match the estate

The Done-when pins "**83** plans linked from `active/` and **277** from `delivered/`", and
the cost section states "295 plans, 83 `active/` links, 280 `delivered/` links, of which 83
and 277 respectively resolve". Measured now, same repo, same checkout:

```
actual plan files (dated):      297
actual active links:       86
actual delivered links:      281
active links resolving: 85
delivered links resolving: 281
```

`active/` holds 86 entries of which 85 are links (the 86th is the `.omc` directory), and all
85 resolve. `delivered/` holds 281 links and all 281 resolve. Zero dangling links exist:

```
=== dangling links on the real estate ===
(empty)
```

So the plan's `83`/`277` pins are stale, and the `280 → 277` gap implies three dangling
delivered links that do not exist. A Done-when that requires the sweep to report 83 and 277
will FAIL on a correct implementation. The estate moves — it gained plans between the
measurement and now — which is the deeper problem: a pinned absolute count is not a
regression test, it is a snapshot with an expiry date.

**Amendment:** replace the absolute pins with the equality that actually holds — the
before/after diff of sections 1, 5 and 9 on the same checkout, which the Done-when already
requires and which is load-bearing on its own. Keep the counts as context, not as a gate.

## What I could not refute

- The fork-count argument. 130,128 forks is the right shape of claim and is
  load-independent, as the plan says.
- Dangling links survive: both `ls -l` and `find -type l` list them, and section 5's
  finding does not depend on this function anyway.
- The empty-directory case: bash leaves the glob literal, `[ -L ]` rejects it, result is
  empty — the current behaviour is already correct and `2>/dev/null` reproduces it.
- The regular-file case: `zeta.md` as a plain file in `active/` is skipped by `[ -L ]`
  currently and by a `case "$line" in l*)` test in the replacement. Both skip it.
- Section 1 genuinely needs the link PATH, not a boolean — confirmed at :797/:809/:817,
  `slug=$(basename "$in_active")` and `fix: git rm $in_active`. The plan is right to
  reject `find -exec readlink {} +` on that ground.

## Summary of requested amendments

1. Filter the index to `*.md` names, and say so in the Done-when. Without it, section 1 and
   section 9 change on any non-`.md` link.
2. Correct the claim that section 5's dangling finding is fed by `symlinked_from`; it is
   the independent loop at :844. Consider whether that loop should read the same one-pass
   index, since it is a fourth walk of the same directories.
3. State that the index is first-wins, matching the current early `return 0`.
4. Drop or re-measure the `83`/`277` pins; as written they fail against the current estate
   (85/281, zero dangling).
5. Prefer a `find -print0`-based or stat-based reading over parsing `ls -l`, or state the
   name constraint the `ls -l` parse relies on.
