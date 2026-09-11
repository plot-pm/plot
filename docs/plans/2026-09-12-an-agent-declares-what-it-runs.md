# An agent declares what it runs

> `start_worker` asks the charter which harness, model and effort to launch, instead of reading one global key for every agent.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** an-agent-is-declared-and-corrected
- **Review:** pr
- **Impl:** own branches

## Changelog

- A charter's `harness`, `model` and `effort` reach the launch: an agent may run a different CLI, model or reasoning effort from its siblings in the same fleet.

<!-- Board impact: the manifest gains no field — the charter is already committed
     under .plot/charters/ and the board reads manifests, not charters. No plan
     format change. -->

## Motivation

**Four fields are declared and nothing reads them.** Measured 2026-09-12:

| field | readers on the estate |
|---|---|
| `harness` | 0 |
| `model` | 0 |
| `effort` | 0 |
| `capabilities` | 0 |

Charters on the estate: 0. This slice wires the first three; `capabilities` is [a-charter-bounds-what-an-agent-may-touch](2026-09-12-a-charter-bounds-what-an-agent-may-touch.md).

**The prompt half is already wired and proves the shape works.** `plot-prompt.mjs` resolves which prompt an agent runs, and `resolve_prompt_file` refuses rather than falling back on a charter it cannot believe — *"A charter that cannot be read is a person's typo, and the repo prompt would run successfully under instructions nobody asked for."* The same argument applies one field over: an agent launched under the wrong model succeeds, and nothing in `.plot-worker.log` says so.

**One global key launches every agent.** `plot-dispatch.sh:749` reads `Worker command` and every dispatched agent gets it. That is correct as a default and wrong as the only answer, because it makes every agent the same kind of worker.

## Design

### Approach

`start_worker()` resolves the charter **before** it resolves `Worker command`, and the config key becomes the fallback rather than the sole source.

The charter names a `harness`; it does not carry a command line. A charter carrying `agent --model gemini-3.1-pro --skill natural-language` would put a vendor CLI into a file the domain parses, and `RUN_FACTS` exists precisely to keep run-shaped things out of charters. **The harness names a prompt file, and the prompt file holds the invocation** — the contract `.plot/worker-prompt.sh` already fulfils: *"Plot exports the variables and cannot write the invocation."*

So the launch resolves in three steps:

1. `PLOT_AGENT` names a charter, or it does not.
2. A charter declares `harness`, `model`, `effort` — exported as `PLOT_HARNESS`, `PLOT_MODEL`, `PLOT_EFFORT`.
3. The prompt file interpolates whichever of those it needs.

An agent with no charter exports none of them and behaves exactly as today. **Nothing on the estate changes until a charter exists**, which is the property `resolve_prompt_file` already holds.

### A missing harness refuses

A charter naming a harness that is not on this machine **ends the worker and names what it looked for**. It does not fall back.

The reason is the one `resolve_prompt_file` already gives: a fallback would RUN, successfully, under an invocation the operator did not ask for. A natural-language agent silently launched on the repo's default harness produces work that looks finished and was done by the wrong worker.

Refuse at launch, before the desk is touched, so the slice stays claimable by an agent that can run it.

### The model string is not parsed

`harness` is `z.string()`, deliberately open. This slice adds no enum and no vendor list.

That is a decision this repo has already paid for once in the other direction: `ports/host.ts` opened `HostBackend = string` while `host-shell.ts:30` kept `DRIVES = ['github', 'bitbucket']` and throws on anything else — so the port is open and adding a third host is still not an adapter-only change. A harness enum here would be the same trap on a newer field.

### Open Questions

- [ ] Does `effort` belong on the charter or the slice? A charter says what an agent *is*; effort is arguably per-task. Charter for now, because nothing reads it either way and moving it later is a schema change with no callers.
- [ ] Should a charter be able to override `Worker bound`? A slower harness may legitimately need longer. Out of scope here; `bounds` already carries a context ceiling and a second bound belongs with it.

## Slices

### An agent declares what it runs (Branch: feature/an-agent-declares-what-it-runs)

Charter resolution in `start_worker` before `Worker command`, the three exports, and the refusal when the declared harness is absent.

## Notes

The charter's own docstrings already argue the multi-vendor case. `contextWindow` is declared *"because nothing measures it"*, and a model-name-to-window lookup table is explicitly refused: *"a guess that is usually right produces a fleet whose wrong answers cannot be explained."* That reasoning was written for a fleet running more than one vendor.
