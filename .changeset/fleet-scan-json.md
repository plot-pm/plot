---
"plot": minor
---

`plot-fleet-scan.sh --json` emits the pulse as one machine-readable object.

The scan's prose is a **human** interface — mechanical enumeration a person reads, per Principle 3. That is precisely why it is not a contract: anything consuming lines like `  Tracer — eligible` breaks the day someone improves the wording. The board is about to consume exactly this data, so the scan gains a second rendering rather than a second reader.

`--json` serialises the derivation the script already performs. Wave verdicts, per-branch state, claim notes and the summary counters come out as they exist internally: `open` · `wip` · `merged` · `claimed` · `deferred`, and `complete` · `eligible` · `blocked`. Deliberately **not** the prose labels — no consumer should parse `in progress`, a string that exists only to be read. Field names follow `plot-plan-meta.sh` (`branch`, and `""` rather than `null` for an absent claim), because two JSON conventions in one repo is worse than either.

It is an output mode and nothing more: it composes with `--offline`, `--no-fetch` and `--loose` rather than implying any of them, so the data depends on what the caller asked for rather than how. `--next` still wins — a different question with a one-line answer.

The test that matters here is not the one that parses the JSON. It is the one asserting the **human report stays byte-identical**: a machine mode is worth adding only if it leaves the thing people read untouched, and that is verifiable rather than assertable — the prose was diffed against its pre-change output, not merely against itself.
