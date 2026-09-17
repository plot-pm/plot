# Juror: the reporter's problem

Lens: an operator on a Bitbucket repository filed #943 because they could not deliver. Does shipping this plan, exactly as written, let them deliver?

Position: amend

## The short answer

Slice 2 alone lets the reporter deliver, and it is correct. Slice 1 is also correct — the diagnosis is verified below. What the plan does not do is state which slice ships first, and it introduces a **silent wrong answer** on the reporter's repository that the current code does not have.

## What I verified in the source

The plan's central factual claim holds. `plot-host.sh:2496`, the Bitbucket `pr-state` success arm:

```bash
jq -c '{number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href}' <<<"$out"
```

No `mergeCommit` key. The GitHub arm two blocks up constructs `mergeCommit:(.mergeCommit.oid // "")`, and its miss object carries `"mergeCommit":""`. The Bitbucket miss object at `:2499` is `'{"number":0,"state":"NONE","draft":false,"url":""}'` — also absent. The neighbouring `pr-merged` op at `:2673` reads `map(.merge_commit.hash // empty)` from the same payload shape, so the field is in hand. The plan is right and #943's "GitHub-only field" framing is wrong.

Placement is also as described: `echo "== 6. Delivered but already released"` at `:1151`, `echo "== blocking sections end =="` at `:1253`. Section 6 is inside the blocking set. `/plot-deliver` SKILL.md:468 greps `sed -n '/^== blocking sections end ==/q;p'`. The reporter's gate genuinely cannot clear.

## FINDING 1 — the strongest. Slice 1 turns a loud block into a silent wrong answer, and the plan's Done-when does not cover it.

This is the one the plan misses. Supplying `mergeCommit` does not end the code path; the next statement runs:

```bash
tag=$(git tag --contains "$sha" 2>/dev/null \
      | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | head -1)
[ -n "$tag" ] || continue   # genuinely not released yet — nothing to report
```

Measured just now in a scratch repo:

```
$ git tag --contains deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
error: no such commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
rc=129
```

`git tag --contains` on a sha the local object store does not hold **exits 129 and writes to stderr**. The scan sends stderr to `/dev/null` and tests only `[ -n "$tag" ]`. So an unresolvable sha does not report "cannot resolve" — it falls through the `continue` whose comment reads *"genuinely not released yet — nothing to report."*

That comment becomes a lie the moment slice 1 ships. The section's own stated purpose, three times in its comments, is that *"'cannot tell' and 'nothing wrong' must not look the same"* — and slice 1, alone, creates exactly that confusion in the arm below the one it fixes.

Is the sha local on the reporter's repo? Usually yes — their own issue proves it: `git branch -r --contains ac5dbec4f` returned `origin/develop`. And the scan runs `git fetch origin --prune` at `:288`. But "usually" is not the contract, and three real populations break it:

- `--no-fetch` / `--offline` — a documented flag, `:249`. Section 6 skips the host call under `PR_SOURCE=off` but the fetch skip is a separate flag, so `--no-fetch` with PRs on reaches `git tag --contains` against a possibly stale object store.
- A merge commit on a branch the local refspec does not fetch. `git fetch origin --prune` fetches configured refs; a Bitbucket merge into a branch outside `origin/*` coverage, or a shallow/partial clone, leaves the sha absent.
- The plan's own closing note names the population directly: *"the same object is absent for a PR merged outside the host's own merge button."* Slice 1 supplies `""` there, which is fine — but where the host supplies a sha for a commit history the checkout does not hold, rc=129 is swallowed.

**Amendment required:** slice 1's Done-when must include that the scan distinguishes *sha not resolvable locally* from *not released*. Concretely, a `git cat-file -e "$sha^{commit}"` (or reading the rc of the `git tag` call) before the tag lookup, emitting a `cannot resolve` finding rather than `continue`. Without this, the plan ships a fix whose failure mode is quieter and worse than the bug it replaces, in the section whose entire design argument is that silence is the worse bug.

## FINDING 2 — slice order is unstated and it decides whether the reporter is unblocked this week.

The plan says the two slices "fail differently" and are therefore separate. It never says which ships first. For the reporter, the order is the whole answer:

- Slice 2 first: the gate stops reading section 6; they deliver immediately; the release check stays wrong until slice 1 lands. Their filed problem — *"I cannot deliver"* — is solved.
- Slice 1 first: section 6 still sits inside the blocking set. Their 45 findings shrink, but the *other* blocking arm of the same section is untouched — `no PR annotation → cannot resolve a version` at `:1169` writes into the same `unrel_out` and prints above the marker. The reporter's footer reads `unreleased_delivered=82` against 45 "no merge commit" findings; the 37-plan remainder is plausibly that arm, plus docs/infra exemptions. Any plan in it still blocks their delivery. And on the branch names as written, slice 1 also carries the Finding 1 risk with no guard.

The branches are independently dispatchable, so "both ship eventually" is not a schedule. **Amendment:** state that slice 2 ships first, and say why — it is the reporter's remedy and the only one that is unconditional.

## FINDING 3 — the `inspect:` fix is reachable. Confirmed, not an objection.

I checked because the plan asserts it without evidence. `PR_SOURCE` is a script-global, set at `:483` to `"$backend"` (`gh` or `bb`), derived at `:434` from origin's URL. It is in scope at `:1200`. The scan deliberately reads the host from origin rather than `plot-host.sh backend`, and the comment at `:415` says why. So `inspect:` can name the right CLI with a one-line `case "$PR_SOURCE"`. No blocker here.

## What I tried to refute and could not

- **"Does `develop` break section 6?"** No. Section 6 never touches `MAIN`; it reads the plan's PR annotation and asks `git tag --contains`. `Integration branch: develop` is presumably the reporter's `Main branch` config key — the only branch key the scan reads (`:299`). Section 6 is branch-agnostic. Not a defect.
- **"What about a repo with zero tags?"** Benign. `git tag --contains <valid-sha>` with no tags exits **0** and prints nothing, measured. The `continue` then reports nothing, which is the correct answer: no tags means nothing is released. Only the *unknown sha* case (Finding 1) misbehaves.
- **"Is anything in the plan true here and false there?"** The line numbers and the version. The reporter runs 2.17.0 from a marketplace install; this repo is at 2.18.0 and both slices are specified against working-tree line numbers. That is a normal shape for a plan and the fixes are structural, not positional. Their remedy arrives in whatever release follows, not by editing their installed copy — worth saying in the issue reply, not a plan defect.

## Why amend and not reject

The diagnosis is verified, both slices are the right shape, and slice 2 does unblock the filed problem. The plan is one Done-when clause and one sentence of ordering away from being right for the person who filed it. Reject would be wrong; proceed would ship a section that goes quiet on the reporter's own repository in exactly the case the section exists to make loud.
