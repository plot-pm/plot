---
"@plot-pm/board": patch
---

A CI gate refuses a vendor name in domain code outside `adapters/`, and a test drives a connector Plot ships no adapter for end to end through the `Host` port. `HostBackend` was `'github' | 'bitbucket'` until 2026-09-01 — one line, in the domain — so a third connector was not an adapter change however the port documented itself; wave 1 widened the type and this makes the property mechanical. The gate strips comments first: 24 vendor mentions sit outside `adapters/` today, every one in a TSDoc block arguing for the property, while the union it exists to catch carries no vendor word in a comment. The adapter's refusal now names the host it could not drive — the guard threw from the day the union went, but `resultOf` discarded the message and `record` cleared the refusal on the zero exit the script returns, so `lastRefusal()` answered `null` and a caller held `failed` with no way to learn which host.
