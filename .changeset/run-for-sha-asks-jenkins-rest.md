---
'plot': patch
---

`run-for-sha` answers on Jenkins. The op exited 4 there because `jen` carries no commit; Jenkins' own REST API answers at `actions[].lastBuiltRevision.SHA1`, using the API token `jen` already stores in the login keychain. A multibranch job is tried first and a plain pipeline is the fallback, so both shapes resolve. Without a credential it still answers `unaskable` — never an empty run, which is the one answer that would cost a merge.

<!--
plan: docs/plans/2026-09-08-the-run-ops-ask-the-ci-backend.md
bumps:
  skills:
    plot: patch
-->
