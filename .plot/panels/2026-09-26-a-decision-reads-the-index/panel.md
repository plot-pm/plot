# Panel — a decision reads the index

**One lens, amend, executed** — the juror ran things despite a read-only brief, and that is what found the headline.

## The index already exists, and shipped yesterday

`PrIndexStore` is a port (`ports/pr-index.ts:37`) with a file adapter, a fold rule (`rules/pr-index.ts:82`), a versioned entity, and a **live store on this machine**: `.git/.plot/state/index/github.json`, 967 rows, 351 KB, watermark 2026-09-26T12:50:20Z. Verified by the moderator.

It came from `a-merged-pr-is-not-asked-for-its-checks` — PR #1005, merged and delivered **this morning, by the author of this plan.**

It matches the plan's Design section property for property: *"NOTHING HERE DECIDES"* in the port's own docstring; a watermark taken from the rows and never the clock; `complete` latching down so a partial answer never licenses *"there is no PR"*; a plain JSON file under `--git-common-dir`, reachable with no running board.

## 35 spawn sites is 3

```
dispatch.ts:356   spawnSync(
deliver.ts:529    spawn(
approve.ts:295    spawn(
```

Verified by the moderator. The rest were the import line and prose. **This is the predecessor's error repeated** — `grep` matches counted as call sites — in a plan that explicitly said it would not repeat it, and it sits in the epigraph, the Motivation table and the Changelog.

## The three spawns are performances, not retrievals

`deliver.ts:529` spawns the delivery agent. The plan's rule — *a tool call writes the index, a decision reads it* — has nothing to say about a spawn that **performs an action**: there is no answer to write down. The rule does not describe what those three sites do.

## What survives

The principle — separate retrieval from decision — is sound, and the store now exists to serve it. **The question is no longer whether to build an index but which consumers read the one that shipped.** That is a smaller, sharper plan than this one.

## Recommendation

**Amend to the point of rewriting.** Drop the spawn count, drop the build-an-index framing, and start from `PrIndexStore` with a measured list of consumers that could read it and do not.
