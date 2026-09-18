# A merge commit is asked of the host

> The release check reads a field only the GitHub arm of `plot-host.sh` emits, so on Bitbucket every delivered plan reports an unresolvable version — above the marker that gates delivery.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #943
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-18, jwloka, in-session

## Changelog

- `pr-state` answers with a merge commit on Bitbucket as well as GitHub, and the reconcile scan's release check stops reporting every delivered plan as unresolvable on a Bitbucket repository.

<!-- Board impact: none directly. `pr-state` is the board's own PR reading
     through the host port, and this adds a field to one backend's answer
     without changing the shape the board parses. -->

## Design

Reported as #943 by an operator on a repository with `Git host: bitbucket` and
`Integration branch: develop`: `plot-reconcile-scan.sh` section 6 reports **45
delivered plans** — every one in the repository — as `has no merge commit →
cannot resolve`, with `unreleased_delivered=82` in the footer.

Section 6 ends at `:1214`; the `== blocking sections end ==` marker is at
`:1253`. **Section 6 is inside the blocking set**, so `/plot-deliver`'s step 7b
gate can never clear on that repository.

### The reporter's diagnosis is right about the symptom and wrong about the cause

#943 attributes it to `mergeCommit` being "a GitHub-only field". It is not: the
adapter's contract carries `mergeCommit` on every arm, and `plot-host.sh:1308`
already maps a REST `merge_commit_sha` into it.

The actual defect is one `jq` filter. The Bitbucket arm of `pr-state`, at
`plot-host.sh:2496`:

```bash
jq -c '{number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href}' <<<"$out"
```

**No `mergeCommit` key is constructed at all.** Its failure path, at `:2499`,
likewise returns `'{"number":0,"state":"NONE","draft":false,"url":""}'` where
every GitHub path returns the same object *with* `mergeCommit:""`.

So `jq -r '.mergeCommit // empty'` in the scan yields empty for every Bitbucket
PR, the `[ -z "$sha" ]` arm fires, and the finding is printed. The scan is
reading the contract correctly; **one backend does not honour it.**

### The field is available

**`pr-merge-commit` already answers this on both backends.** `plot-host.sh:2619`
is a whole subcommand for it, declared in the usage header at `:49`, behind the
port as `prMergeCommit` (`ports/host.ts:180`) and implemented at
`host-shell.ts:287`. Its own header says why it is separate:

```
# THE MERGE COMMIT OF A BRANCH'S MERGED PR, and nothing else.
#
# A SECOND SUBCOMMAND RATHER THAN A FIELD ON `pr-merged`, because that one
# prints ONE WORD and eleven callers read it as one ...
```

**That alternative is considered and rejected, not overlooked.** The scan holds a
PR **number**; `pr-merge-commit` takes a **branch**. Calling it from `:1192`
would mean deriving a branch from a PR number — a host call the section does not
make today — so it trades a missing field for a missing lookup.

**The argument for fixing `pr-state` is the file's own convention.** Every PR and
issue construction in `plot-host.sh` was compared: `:2476`, `:2496`, `:2538/9`,
`:2900`, `:2927`, `:2957`, `:2999`, `:3025`, `:3034`, `:3427`, `:3497`, `:3546`,
`:3608`. `pr-list`'s Bitbucket arm goes out of its way to emit every key its
GitHub arm emits, filling unavailable ones with `"unknown"` and explaining why at
`:2962` — *"An honest gap beats an invented answer, and absent is not false."*

**`pr-state` is the only op in the file whose Bitbucket arm drops a key its
GitHub arm emits.** Not one instance of a class: the single outlier against a
convention the file states in its own words.

This is why the fix belongs in the adapter rather than in the scan. #943 offers
three directions; **the first is the one that makes the check work**, and the
other two only stop it hurting.

### Supplying the field is not the end of the path

`:1205` runs `git tag --contains "$sha"` next, and `:1207` is
`[ -n "$tag" ] || continue   # genuinely not released yet — nothing to report`.

A sha the local object store does not hold makes `git` print
`error: no such commit` — and **the rc is not even readable**: the pipeline's
exit code is `head`'s, measured 0. So an unresolvable sha takes the `continue`
whose comment says the plan is simply unreleased.

**That would make slice 1's failure quieter than the bug it replaces**, eight
lines above the section's own header: *"SILENCE WOULD BE THE WORSE BUG. An empty
section reads as 'nothing to report', and this section exists precisely because
'cannot tell' and 'nothing wrong'"* must not look the same.

Three populations reach it: `--no-fetch` with PRs on, a merge commit outside the
local refspec or a shallow clone, and a PR merged outside the host's own merge
button. So slice 1 carries the guard.

### The placement question is separate, and it is also real

Even with the field supplied, an unanswerable *release* question would still sit
inside the blocking set. Section 6's heading is *"Delivered but already released
(candidate /plot-release)"* — it asks **which release contains this**, not
**did this delivery land**. A repository on a host that genuinely cannot answer
would still be unable to deliver.

**Both are fixed, and they are separate slices**, because they fail differently:
one is a missing field in one adapter arm, the other is a line number in a
report.

**A SECOND GATE reads the same findings and the marker does not reach it.**
`/plot-release` step 5b (`plot-release/SKILL.md:431`) runs the scan and reads
`tail -1`: *"`unreleased_delivered=0` clears the gate. Any other number is a hard
stop."* That is the FOOTER, so moving section 6 changes nothing about it.

So slice 2 alone lets the reporter deliver and **still leaves them unable to
release**, on the identical 45 findings. **Slice 1 is the load-bearing fix**;
slice 2 is a standalone remedy for nobody.

**Slice 2 ships first, and that is a decision rather than an ordering
accident.** It is unconditional — it unblocks delivery whatever the host answers
— while slice 1 depends on a payload this repository cannot exercise. Slice 1
alone would also leave section 6's OTHER blocking arm untouched (`:1169`, *no PR
annotation*), which writes into the same `unrel_out` above the marker.

### What must not change

**No grep fallback, on any backend.** The comment at `:1195` records why: an
earlier draft matched commit messages for `#N`, which matched any commit
*mentioning* the PR, and reported v2.2.0 for a plan that shipped in v1.7.0.
`git log --grep "pull request #<n>"` — offered in #943 — is that same shape and
is refused for that same reason. The merge commit comes from the host or the
case is reported unanswerable.

**The `inspect:` line must stop naming `gh` unconditionally** (`:1200`). On a
Bitbucket repository it currently prints a command the operator cannot run.

**`plot-pr-merged.sh` is untouched.** It reads `mergedAt` and deliberately never
`mergeCommit`; adding a field to `pr-state` does not license a second reader of
*did this land*.

## Slices

### The Bitbucket arm answers with a merge commit (Branch: bug/the-bitbucket-arm-answers-with-a-merge-commit)

- `bug/the-bitbucket-arm-answers-with-a-merge-commit` — construct `mergeCommit` on all FOUR Bitbucket `pr-state` paths, and make the scan tell an unresolvable sha from an unreleased plan

**Done when** `pr-state` on the Bitbucket backend emits a `mergeCommit` key on
**all four** of its paths — the numeric success `:2496`, the numeric miss `:2499`,
and the **branch-lookup** `NONE` and hit at `:2538`/`:2539`, which
`plot-pr-state.sh:33` reaches by passing `idea/<slug>` rather than a number and
`:47` then reads — so a caller reading `.mergeCommit // empty` can never
distinguish backends; the value is the merged commit hash for a merged PR and the
empty string otherwise; it is taken from the response already fetched and **no
second host call is made**, checked by counting `bb` invocations; a contract test
asserts the GitHub and Bitbucket arms return the **same key set**, since an
absent key is exactly what was not caught; **the scan distinguishes a sha it
cannot resolve locally from a plan that is not released**, by testing
`git cat-file -e "$sha^{commit}"` before the tag lookup and emitting a
`cannot resolve` finding rather than falling through the `continue` at `:1207`;
and `pnpm run test:contracts` passes.

### The release question does not gate a delivery (Branch: bug/the-release-question-does-not-gate-a-delivery)

- `bug/the-release-question-does-not-gate-a-delivery` — move section 6 below the `== blocking sections end ==` marker and make its `inspect:` line name the configured host's CLI

**Done when** section 6 sits **below** the `== blocking sections end ==` marker
and `/plot-deliver`'s step 7b gate no longer reads it, pinned by a test that
runs the gate's own extraction against a fixture carrying a section 6 finding;
`unreleased_delivered=` still reports its count, since the section reports as
before and only its placement changes; the `inspect:` line names the CLI of the
**configured** host rather than `gh`; the scan's header comment and
`CLAUDE.md`'s description of the blocking set are updated to say six sections
became five; and `pnpm run test:contracts` passes.

## Notes

**The report named the line, the field and the repro, and was still wrong about
the cause.** `mergeCommit` appears 14 times in `plot-host.sh`, which reads as a
GitHub-shaped field until the Bitbucket arm at `:2496` is read directly and
found to construct no such key. The reporter had no access to this source; the
verification cost four greps here.

**The strongest evidence was found last.** This plan was drafted claiming the
Bitbucket payload carries `merge_commit.hash` on the authority of the API
documentation. It is better than that: `plot-host.sh:2673` already reads that
field, in this repository, for `pr-merged`. A fix argued from an external spec
became a fix argued from the neighbouring line.

**Amended 2026-09-17 after a three-lens panel** (`.plot/panels/2026-09-17-a-merge-commit-is-asked-of-the-host/`),
unanimous `amend`. The Design's own "strongest evidence" was misattributed:
`:2669`/`:2673` is the `pr-merge-commit` op, not `pr-merged`, and that op is a
complete both-backend answer the plan had not considered. Two further Bitbucket
sites were found, the silent-`continue` was found, and the second gate was found.
Every line number the plan cites was independently confirmed.

**A THIRD representation of the blocking set exists and is out of scope.**
`workflows/reconcile.ts:286` carries `blocking: true` per finding kind, and its
TSDoc says it is a property *because* the scan renumbers. Slice 2 moves the
scan's section and does not touch it, so the two disagree afterwards. That is
worth its own plan: changing a domain rule to follow a report's layout is the
wrong direction, and which of the two is authoritative is a decision, not a fix.
