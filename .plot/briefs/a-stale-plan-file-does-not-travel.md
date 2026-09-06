## Implementation brief — a-stale-plan-file-does-not-travel (slice: A commit refuses a checkout that moved under it)

- **Plan (canonical):** `docs/plans/2026-09-06-a-stale-plan-file-does-not-travel.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-stale-plan-file-does-not-travel` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

**READ THE PLAN'S NOTES BEFORE WRITING ANYTHING.** Three explanations of this defect have been proposed and all three disproved. The slice is deliberately NOT a gate.

## What this delivers

A record, written when a commit changes a file to content older than its parent's — so the next occurrence arrives with evidence instead of a fourth reconstruction.

## Why this is not a gate

**A gate needs a condition, and every condition proposed has been disproved:**

| explanation | how it died |
|---|---|
| agents pushing make your files read as modified | sandbox: a remote commit moves neither tree nor HEAD; `git add -A` stages nothing |
| a second Claude session shares the checkout | process sweep: one `claude` here, agents all in their own `plot-wt-*` |
| stage → pull → commit | **git refuses to pull with a dirty index**, in both modes |

**And the drafted mechanism does not exist.** *"Compare the index's recorded HEAD against the current one"* — the index records blobs and paths, no HEAD sha. `strings .git/index` contains it **zero** times.

## What is certain, and it is only this

For `a-changeset-names-its-plan.md` on 2026-09-06:

```
f9c8e151  (session HEAD, 13:34)     7830688e
ac26bf3e  (pull target, 13:43:07)   ac49812f
a18414d5  (parent of the commit)    ac49812f
03303dd0  (what was committed)      7830688e   ← the 13:34 blob, on a moved parent
```

**The file on disk carried the older content**, because that is what `git add -A` staged. And a fast-forward pull **does** update the working tree — verified in a sandbox — so the 13:43 pull should have replaced it. Something restored it between 13:43 and 13:53 and nobody can say what.

## The record

**A `post-commit` hook, and there is none today.** `.git/hooks/` holds one file, `gitshot-pc`, which is not a hook name git runs. So this adds the first, and adoption must decide whether it installs one — a repo-level hook is a change to every contributor's machine.

**WHAT IT WRITES, AND NOTHING MORE:** the commit sha, its parent, and for each file the commit touched, whether that file's new blob differs from `origin/<main>`'s at that moment. **Post-commit, so it can never block a commit** — which is the whole point while the cause is unknown.

**IT IS CHEAP OR IT IS NOT WORTH HAVING.** It runs on every commit in the repository. Read what is already in memory — `git rev-parse HEAD`, the commit's own name-status — and do not fetch, do not shell to the host, do not walk history.

**IT WRITES SOMEWHERE THE ESTATE ALREADY WRITES.** `.plot/state/` holds `fleet-controls.json` and `last-pulse.json`. A growing log needs a bound: keep the last N entries, or one file per day. Say which and why.

**SILENCE IS THE NORMAL CASE.** An ordinary commit records nothing. A record every commit produces is a log nobody reads, and the signal here is rare — twice in one session, and not since.

## Done when

- a commit that sets a file to content older than its parent's is recorded with both shas at the moment it happens
- an ordinary commit records nothing
- the hook cannot block or slow a commit measurably
- the record is enough to name the cause the next time this occurs
- installing the hook is a decision the repo makes, not a side effect of cloning
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not build a pre-commit gate.** Three conditions, three disprovals — a gate on a guessed condition refuses honest work.
- **Do not propose a fourth explanation in the code.** The record exists because the cause is unknown; a comment asserting one would outlive the evidence.
- **Do not read the index for a HEAD sha.** It does not carry one.
- **Do not fetch, and do not ask the host.** This runs on every commit.
- **Do not let the log grow without bound.**
- **Do not run `pnpm run test:e2e`.** CI is its gate.
