---
'plot': patch
---

An agent started through a configured command loads no MCP server once that command carries `--strict-mcp-config`. To get this for your own agents, add `--strict-mcp-config` to the `claude -p` command in your `.plot/worker-prompt.sh` and to each `claude -p` agent command key in your `## Plot Config` (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`, `Verify`, `Design command`). The SDK runner (`Agent runner: sdk`) follows the same command: it loads no MCP server only where the run's command carries the flag.

<!--
plan: docs/plans/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use.md
-->
