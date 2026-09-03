---
'plot': minor
'@plot-pm/board': minor
---

An agent declares what it is, and the worker loop resolves its prompt through that declaration. `AgentEntry` (`registry.ts:105`) carries eleven fields and every one describes a run — `session`, `resumeId`, `attempts`, `branch`, `worktree`, `command`, `startedAt`, `pid`, `previousPid`, `relaunches`, `state` — so an agent had a receipt and no identity. The charter carries capability and bounds, refuses all eleven, and `readCharter` refuses a document that names one rather than stripping it: a strict schema means stripping would parse, and the launch would succeed under a document the agent never reads. It lives in `.plot/charters/` rather than `.plot/agents/`, because `.plot/agents/` is gitignored — one machine-local manifest per dispatched worker, each with a pid and an absolute worktree path — while a charter is human-authored, true in every clone, and a committed file cannot sit inside an ignored directory. `prompt_file` was hardcoded at `plot-worker-loop.sh:526`, one prompt per repo; the loop now asks `plot-prompt.mjs`, a sixth bundle that reads one file and spawns nothing, where `plot-ask.mjs` would have run a whole fleet scan on the launch path. Nothing on the estate changes until a charter exists: `PLOT_AGENT` unset is every worker today and reaches exactly the path the hardcoded line named, as does a named agent with no charter on this clone. A charter that exists and cannot be believed ends the worker instead, because the fallback would run successfully under instructions nobody asked for and nothing in the log would say so.

<!--
bumps:
  skills:
    plot: minor
-->
