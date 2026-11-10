---
'plot': patch
---

The domain package gains `githubApi`, an in-process GitHub HTTPS client that charges the shared budget ledger under the token's login, takes a host slot per request, honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, and ends a request after 30 s. Nothing calls it yet. A new CI gate, `scripts/check-host-https-callers.sh`, refuses an HTTPS request to a host from any file outside `packages/domain/src/adapters/host/`.

<!--
plan: docs/plans/2026-11-09-github-reads-in-process.md
-->
