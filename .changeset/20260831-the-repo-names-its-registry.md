---
'plot': patch
---

The repo names its own npm registry.

Plot depends only on public packages — CI installs with **no registry auth at
all**, and the lockfile carries no private scope. But a contributor whose
`~/.npmrc` points at a company mirror inherits it, and the mirror answers a
public package with an authorization error:

```
An authorization header was used: Bearer eyJ2[hidden]
```

**That reads like a network outage rather than a wrong registry**, which is the
whole cost of not stating it. Measured 2026-08-31: it blocked installing a YAML
parser to validate `.github/workflows/ci.yml`, and a workflow edit — to the file
gating every merge — was nearly pushed unvalidated because the failure was taken
for "no package installs available here". With the parser, the same edit was
proved to add exactly one step and drop none (23 → 24).

`registry=https://registry.npmjs.org/`, verified with
`pnpm install --frozen-lockfile`: resolves clean, lockfile unchanged.

<!--
bumps:
  skills:
    plot: patch
-->
