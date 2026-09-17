# A merge commit is asked of the host

> The release check reads a field only the GitHub arm of `plot-host.sh` emits, so on Bitbucket every delivered plan reports an unresolvable version — above the marker that gates delivery.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #943
- **Review:** pr
- **Impl:** own branches

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

**The adapter already reads it, on the operation next door.** `plot-host.sh:2669`
carries the comment *"Bitbucket names the merge commit `merge_commit.hash` on a
merged PR"*, and `:2673` reads exactly that field in the `pr-merged` op:

```bash
| map(.merge_commit.hash // empty) | first // empty
```

So this is not a capability the adapter lacks. **One op reads the field and the
op beside it does not construct it**, from the same payload shape.

`bb pr view <id> --json` emits the raw Bitbucket API 2.0 object — `bb --help`
states *"Output raw JSON"*, confirmed against `bb` 1.9.0 — so the response
already in hand holds the answer and no second call is needed.

This is why the fix belongs in the adapter rather than in the scan. #943 offers
three directions; **the first is the one that makes the check work**, and the
other two only stop it hurting.

### The placement question is separate, and it is also real

Even with the field supplied, an unanswerable *release* question would still sit
inside the blocking set. Section 6's heading is *"Delivered but already released
(candidate /plot-release)"* — it asks **which release contains this**, not
**did this delivery land**. A repository on a host that genuinely cannot answer
would still be unable to deliver.

**Both are fixed, and they are separate slices**, because they fail differently:
one is a missing field in one adapter arm, the other is a line number in a
report. Shipping only the first leaves any future backend with the same trap;
shipping only the second leaves the release check broken on Bitbucket, which is
what the reporter actually wanted repaired.

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

- `bug/the-bitbucket-arm-answers-with-a-merge-commit` — construct `mergeCommit` in the Bitbucket `pr-state` arm from the PR object already fetched, on both the success and the miss path

**Done when** `pr-state` on the Bitbucket backend emits a `mergeCommit` key on
**every** path, including the `NONE` miss object at `:2499`, so a caller reading
`.mergeCommit // empty` can never distinguish backends; the value is the merged
commit hash for a merged PR and the empty string for one that is not merged; the
value is taken from the response already fetched and **no second host call is
made**, checked by counting `bb` invocations; a contract test asserts the
GitHub and Bitbucket arms return the **same key set**, since the absent key is
exactly what was not caught; and `pnpm run test:contracts` passes.

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

**The second slice is what the reporter would have needed on the day.** The
first makes the release check work; only the second unblocks a delivery on a
host whose PR carries no merge commit at all — and that population is not empty:
the same object is absent for a PR merged outside the host's own merge button.
