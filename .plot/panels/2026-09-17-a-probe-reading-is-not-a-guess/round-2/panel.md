# Panel round 2 — a-probe-reading-is-not-a-guess

**Reconciled: `unanimous` — amend (adversary, implementer)**

Round 1 corrected what the defect DOES. Round 2 found what protects it, and what
the plan still left to the person writing the code.

## The regex is defended by three green tests that share its invention

```
351: 'Jenkins auth:  reachable',
444: stubClis({ jen: { stdout: 'Jenkins auth:  reachable' } })
504: stubClis({ jen: { stdout: 'Jenkins auth:  reachable' } })
```

**`Jenkins auth:  reachable` is a string the CLI never emits.** Verified here.
So the probe did not merely read the wrong word — a fixture asserts the wrong
word back, and all three pass.

That is the shape `CLAUDE.md` names: a test that answers *did I build this?*
with yes without it being true. **The defect and its test were written from the
same guess.**

## What the plan handed over unnamed, and now decides

The implementer attempted both changes in a scratch copy and reported what they
had to invent. Two of the three are now the plan's:

- **Replace the word, do not add it.** `ok|reachable` keeps both tests green and
  keeps the fiction alive; a later reader would meet two accepted wordings with
  no way to tell which is real. A gate pins the string's absence from the file.
- **The fixture-directory exclusion is withdrawn.** No naming rule survived
  contact — `fixtures`, `test`, `__fixtures__` are each plausible and each wrong
  somewhere, and a repository keeping a pipeline under `test/` would be told it
  has no CI. The depth bound limits the rest.

## The search bound, corrected twice

Round 1 said the bound was deferred to the implementer. The plan named `depth 4`
by counting directories, and measurement refused it:

```
-maxdepth 4 -> 0 hit(s)
-maxdepth 5 -> 1 hit(s)
```

**`find -maxdepth` counts path components, not directories.** A plan about an
off-by-one in a path test made the same off-by-one in its own Design, and it is
recorded rather than quietly corrected.

## What the lenses had in common

**Both read or ran the probe; neither asked what the probe is FOR.** The two
slices make two readings correct. Whether `/plot-board-setup` then proposes
something better with them is the question that motivated the report, and no
juror in either round followed a corrected reading through `proposeCi` to the
proposal an adopter sees.

The plan's own gates stop at the probe's output, and so does this panel.

## The moderator's reading

**Unanimous, and the amendments are taken.** The fix in each slice is unchanged;
what changed is that the plan now decides two questions it was handing over, and
withdraws a gate nobody could satisfy.

**Nothing here moves the plan's phase.**
