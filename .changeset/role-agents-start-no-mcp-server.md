---
"plot": patch
---

The fixer, main-repair and unblocker agents start no MCP server: the role command passes `--strict-mcp-config`, and an `Agent runner: sdk` role run sets `strictMcpConfig`.

<!--
plan: docs/plans/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use.md
bumps:
  skills:
    plot: patch
-->
